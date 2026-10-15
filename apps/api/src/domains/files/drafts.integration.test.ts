import { DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import {
  createProjectFixture,
  createRpcContext,
  createServiceContext,
} from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import { drafts, files, pages } from "../../schema";
import type { AppEnv } from "../../types";
import { upsertBlockDefinition } from "../block-definitions/service";
import { fileHonoRoutes } from "./routes";

const { broadcastInvalidation, broadcastDraftEnded } = vi.hoisted(() => {
  // Modules loaded by earlier test files would keep the real broadcaster.
  vi.resetModules();
  return { broadcastInvalidation: vi.fn(), broadcastDraftEnded: vi.fn() };
});
vi.mock("../../lib/broadcast-invalidation", () => ({ broadcastInvalidation, broadcastDraftEnded }));

type FileRow = typeof files.$inferSelect;
type Headers = Record<string, string>;

/** Headers naming a draft, creating it when missing. */
const startingDraft = (id: string) => ({ [DRAFT_HEADER]: id, [DRAFT_CREATE_HEADER]: "1" });
/** Headers naming an existing draft. */
const inDraft = (id: string) => ({ [DRAFT_HEADER]: id });

const imageField = (required: boolean) => ({
  fieldType: "Image",
  type: "object",
  properties: { url: { type: "string" } },
  accept: ["image/*"],
  required,
});

async function fixture() {
  const base = await createProjectFixture(`files-drafts-${crypto.randomUUID()}`);
  const ctx = createServiceContext(base.db, base.memberUser);
  await runService(
    upsertBlockDefinition(createServiceContext(base.db, null), {
      projectSlug: base.project.slug,
      deployToken: base.project.deployToken,
      blockId: "hero",
      title: "Hero",
      description: "Hero",
      contentSchema: {
        type: "object",
        properties: {
          title: { fieldType: "String", type: "string" },
          image: imageField(true),
          datasheet: {
            fieldType: "File",
            type: "object",
            properties: { url: { type: "string" } },
            accept: ["application/pdf"],
          },
        },
        toMarkdown: ["# {{title}}"],
      },
    }),
  );
  const now = 1_700_000_000_000;
  const page = await base.db
    .insert(pages)
    .values({
      projectId: base.project.id,
      environmentId: base.environment.id,
      layoutId: base.layout.layoutId,
      pathSegment: "",
      fullPath: "/",
      nickname: "Home",
      contentUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("db", base.db);
    c.set("user", base.memberUser);
    c.set("environmentName", "production");
    await next();
  });
  app.route("/files", fileHonoRoutes);

  const projectId = base.project.id;
  const member = (headers: Headers = {}) => ({
    context: createRpcContext(base.db, base.memberUser, headers),
  });

  /** Posts an upload, or a replacement of `target`'s content, with the given headers. */
  async function send(
    headers: Headers,
    { target, id, type = "image/png", name = "hero.png", bytes = "image bytes" } = {} as {
      target?: string;
      id?: string;
      type?: string;
      name?: string;
      bytes?: string;
    },
  ) {
    const body = new FormData();
    body.set("file", new File([bytes], name, { type }));
    body.set("projectId", String(projectId));
    body.set("alt", "");
    if (id) body.set("id", id);
    const execution = createExecutionContext();
    const response = await app.request(
      target === undefined
        ? "http://localhost/files/upload"
        : `http://localhost/files/${target}/content`,
      { method: "POST", body, headers },
      ctx.env,
      execution,
    );
    await waitOnExecutionContext(execution);
    return response;
  }
  const upload = async (headers: Headers = {}, options: Parameters<typeof send>[1] = {}) => {
    const response = await send(headers, options);
    expect(response.status).toBe(201);
    return response.json<FileRow>();
  };
  const replace = async (
    target: string,
    headers: Headers,
    options: Parameters<typeof send>[1] = {},
  ) => {
    const response = await send(headers, { ...options, target });
    expect(response.status).toBe(200);
    return response.json<FileRow>();
  };

  const listed = async (headers: Headers = {}) =>
    (await call(router.files.list, { projectId }, member(headers))).map((file) => file.id);
  const getFile = (id: string, headers: Headers = {}) =>
    call(router.files.get, { id }, member(headers));
  const bytesAt = async (url: string) => {
    const response = await app.request(url, {}, ctx.env);
    if (response.status !== 200) return null;
    return new TextDecoder().decode(await response.arrayBuffer());
  };
  const blobExists = async (blobId: string) => (await ctx.env.FILES_BUCKET.head(blobId)) !== null;

  const createBlock = (content: Record<string, unknown>, headers: Headers = {}) =>
    call(router.blocks.create, { pageId: page.id, type: "hero", content }, member(headers));
  const editBlock = (id: string, content: Record<string, unknown>, headers: Headers) =>
    call(router.blocks.updateContent, { id, content }, member(headers));

  const preview = (draftId: string) =>
    call(router.drafts.previewPublish, { projectId }, member(inDraft(draftId)));
  const publish = async (draftId: string) =>
    call(
      router.drafts.publish,
      { projectId, token: (await preview(draftId)).token },
      member(inDraft(draftId)),
    );
  const discard = (draftId: string) =>
    call(router.drafts.discard, { projectId }, member(inDraft(draftId)));
  const codes = (problems: { code: string; id: string }[]) =>
    problems.map(({ code, id }) => [code, id]);

  return {
    ...base,
    ctx,
    member,
    send,
    upload,
    replace,
    listed,
    getFile,
    bytesAt,
    blobExists,
    createBlock,
    editBlock,
    preview,
    publish,
    discard,
    codes,
  };
}

describe("files in drafts", () => {
  it("a file uploaded in a draft stays out of Live's file list until published, and uploading on Live starts a draft", async () => {
    const f = await fixture();
    const draftId = generateUuidv7();
    const uploaded = await f.upload(startingDraft(draftId));

    expect(await f.db.select().from(drafts).where(eq(drafts.id, draftId)).get()).toBeDefined();
    expect(await f.listed()).toEqual([]);
    expect(await f.listed(inDraft(draftId))).toEqual([uploaded.id]);
    await expect(f.getFile(uploaded.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    await f.publish(draftId);
    expect(await f.listed()).toEqual([uploaded.id]);
  });

  it("replacing a file's content in a draft keeps its id, and Live serves the old bytes until publish", async () => {
    const f = await fixture();
    const live = await f.upload({}, { bytes: "old bytes" });
    const draftId = generateUuidv7();
    const replaced = await f.replace(live.id, startingDraft(draftId), {
      name: "new.png",
      bytes: "new bytes",
    });

    expect(replaced.id).toBe(live.id);
    expect(await f.bytesAt((await f.getFile(live.id)).url)).toBe("old bytes");
    expect(await f.bytesAt((await f.getFile(live.id, inDraft(draftId))).url)).toBe("new bytes");

    await f.publish(draftId);
    const published = await f.getFile(live.id);
    expect(published).toMatchObject({ id: live.id, filename: "new.png" });
    expect(await f.bytesAt(published.url)).toBe("new bytes");
    // Nothing names the old blob any more.
    expect(await f.blobExists(live.blobId)).toBe(false);
  });

  it("changing alt text in a draft copies the file there and leaves Live's alone", async () => {
    const f = await fixture();
    const live = await f.upload();
    const draftId = generateUuidv7();
    await call(
      router.files.setAlt,
      { id: live.id, alt: "A mountain" },
      f.member(startingDraft(draftId)),
    );

    expect((await f.getFile(live.id)).alt).toBe("");
    expect((await f.getFile(live.id, inDraft(draftId))).alt).toBe("A mountain");
    expect((await f.preview(draftId)).changes).toMatchObject([
      { entity: "file", id: live.id, change: "changed" },
    ]);
  });

  it("discarding deletes the blobs only the draft named, and keeps Live's", async () => {
    const f = await fixture();
    const live = await f.upload({}, { bytes: "live bytes" });
    const draftId = generateUuidv7();
    const added = await f.upload(startingDraft(draftId));
    const replaced = await f.replace(live.id, inDraft(draftId), { bytes: "draft bytes" });

    await f.discard(draftId);

    expect(await f.blobExists(added.blobId)).toBe(false);
    expect(await f.blobExists(replaced.blobId)).toBe(false);
    expect(await f.blobExists(live.blobId)).toBe(true);
    expect(await f.bytesAt((await f.getFile(live.id)).url)).toBe("live bytes");
  });

  it("replacing twice in a draft deletes the first replacement's blob, and keeps a blob another draft still names", async () => {
    const f = await fixture();
    const live = await f.upload();
    const first = generateUuidv7();
    const second = generateUuidv7();
    const once = await f.replace(live.id, startingDraft(first));
    const twice = await f.replace(live.id, inDraft(first));
    // Another draft names the Live blob through its own copy of the file.
    await call(router.files.setAlt, { id: live.id, alt: "Kept" }, f.member(startingDraft(second)));

    expect(await f.blobExists(once.blobId)).toBe(false);
    expect(await f.blobExists(twice.blobId)).toBe(true);

    await f.publish(first);
    // Live now serves the second replacement; the other draft's copy still names the old blob.
    expect(await f.blobExists(live.blobId)).toBe(true);
    await f.discard(second);
    expect(await f.blobExists(live.blobId)).toBe(false);
    expect(await f.blobExists(twice.blobId)).toBe(true);
  });

  it("a failed upload in a draft deletes its blob and drops the draft it started", async () => {
    const f = await fixture();
    const live = await f.upload();
    const stored = async () =>
      (await f.ctx.env.FILES_BUCKET.list({ prefix: `${f.project.id}/` })).objects.map(
        (object) => object.key,
      );
    const before = await stored();
    const draftId = generateUuidv7();

    // The id is taken by a Live file, so the row can't be written once the blob is stored.
    const taken = await f.send(startingDraft(draftId), { id: live.id });
    expect(taken.status).toBe(400);
    const missing = await f.send(startingDraft(draftId), { target: generateUuidv7() });
    expect(missing.status).toBe(404);

    expect(await f.db.select().from(drafts).where(eq(drafts.id, draftId)).get()).toBeUndefined();
    expect(await stored()).toEqual(before);
  });

  it("deleting a file in a draft leaves references in place, and publishing waits until they're fixed", async () => {
    const f = await fixture();
    const used = await f.upload();
    const other = await f.upload();
    const block = await f.createBlock({ title: "Hero", image: { _fileId: used.id } });
    const draftId = generateUuidv7();
    await call(router.files.delete, { id: used.id }, f.member(startingDraft(draftId)));

    const content = async (headers: Headers) =>
      (await call(router.blocks.get, { id: block.id }, f.member(headers))).block.content;
    expect((await content(inDraft(draftId))).image).toMatchObject({ _fileId: used.id });
    expect(await f.listed(inDraft(draftId))).toEqual([other.id]);
    expect(f.codes((await f.preview(draftId)).blockers)).toEqual([["missingFile", block.id]]);
    await expect(f.publish(draftId)).rejects.toMatchObject({ code: "PUBLISH_BLOCKED" });

    await f.editBlock(block.id, { image: { _fileId: other.id } }, inDraft(draftId));
    expect((await f.preview(draftId)).blockers).toEqual([]);
    await f.publish(draftId);
    expect(await f.listed()).toEqual([other.id]);
    expect(await f.blobExists(used.blobId)).toBe(false);
  });

  it("a reference to a missing file blocks publishing in changed content, and is a warning on Live", async () => {
    const f = await fixture();
    const image = await f.upload();
    const missing = generateUuidv7();
    const onLive = await f.createBlock({ title: "Live", image: { _fileId: image.id } });
    await f.createBlock({
      title: "Broken on Live",
      image: { _fileId: image.id },
      datasheet: { _fileId: missing },
    });
    const draftId = generateUuidv7();
    const changed = await f.createBlock(
      { title: "Draft", image: { _fileId: image.id }, datasheet: { _fileId: missing } },
      startingDraft(draftId),
    );

    const { blockers, warnings } = await f.preview(draftId);
    expect(f.codes(blockers)).toEqual([["missingFile", changed.id]]);
    expect(f.codes(warnings).map(([code]) => code)).toEqual(["missingFile"]);
    expect(f.codes(warnings)).not.toContainEqual(["missingFile", onLive.id]);
  });

  it("a file the draft adds whose bytes are missing blocks publishing", async () => {
    const f = await fixture();
    const draftId = generateUuidv7();
    const added = await f.upload(startingDraft(draftId));
    expect((await f.preview(draftId)).blockers).toEqual([]);

    await f.ctx.env.FILES_BUCKET.delete(added.blobId);

    const { blockers } = await f.preview(draftId);
    expect(blockers).toMatchObject([
      { code: "missingFileBytes", entity: "file", id: added.id, label: "hero.png" },
    ]);
  });

  it("replacing a file with a type a field using it doesn't accept blocks publishing, even in untouched Live content", async () => {
    const f = await fixture();
    const image = await f.upload();
    const pdf = await f.upload({}, { type: "application/pdf", name: "spec.pdf" });
    const block = await f.createBlock({
      title: "Hero",
      image: { _fileId: image.id },
      datasheet: { _fileId: pdf.id },
    });
    const draftId = generateUuidv7();
    await f.replace(pdf.id, startingDraft(draftId), { type: "image/png", name: "spec.png" });

    expect(f.codes((await f.preview(draftId)).blockers)).toEqual([
      ["unacceptedFileType", block.id],
    ]);

    // The same mismatch already on Live is a warning.
    const other = generateUuidv7();
    await f.createBlock({ title: "Wrong on Live", image: { _fileId: pdf.id } }, {});
    await f.upload(startingDraft(other));
    const { blockers, warnings } = await f.preview(other);
    expect(blockers).toEqual([]);
    expect(f.codes(warnings).map(([code]) => code)).toEqual(["unacceptedFileType"]);
  });

  it("an empty required image blocks publishing in changed content, and is a warning on Live", async () => {
    const f = await fixture();
    const image = await f.upload();
    const emptyOnLive = await f.createBlock({ title: "Empty on Live", image: null });
    const draftId = generateUuidv7();
    const empty = await f.createBlock({ title: "Empty", image: null }, startingDraft(draftId));
    await f.createBlock({ title: "Filled", image: { _fileId: image.id } }, inDraft(draftId));

    const { blockers, warnings } = await f.preview(draftId);
    expect(f.codes(blockers)).toEqual([["emptyRequiredFile", empty.id]]);
    expect(f.codes(warnings)).toEqual([["emptyRequiredFile", emptyOnLive.id]]);
  });

  it("counts a file's uses as the current draft sees them", async () => {
    const f = await fixture();
    const image = await f.upload();
    const block = await f.createBlock({ title: "Hero", image: { _fileId: image.id } });
    const draftId = generateUuidv7();
    await call(router.blocks.delete, { id: block.id }, f.member(startingDraft(draftId)));

    const count = async (headers: Headers) =>
      (await call(router.files.getUsageCount, { id: image.id }, f.member(headers))).count;
    expect(await count({})).toBe(1);
    expect(await count(inDraft(draftId))).toBe(0);
  });
});
