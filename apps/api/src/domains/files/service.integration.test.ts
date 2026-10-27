import { DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  createServiceContext,
  seedLiveThrough,
  inScope,
} from "../../../test/fixtures";
import { forgetScheduled, scheduledFor } from "../../../test/generation";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import { blocks, drafts, files, repeatableItems } from "../../schema";
import type { AppEnv } from "../../types";
import { callTool } from "../agent/service";
import { saveValue } from "../generated-values/service";
import { metadataKey } from "./generated-metadata";
import { fileHonoRoutes, fileProcedures } from "./routes";
import { deleteFile, getProjectFile, listFiles, updateFile } from "./service";

const inDraft = (id: string) => ({ [DRAFT_HEADER]: id });

/** Whether each job scheduled for a file runs in a draft or on Live. */
const jobScopes = (fileId: string) =>
  scheduledFor(fileId).map((job) => (job.draftId ? "draft" : "live"));

// Independent of the shared schema: version nibble 7, RFC 4122 variant.
const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CLIENT_FILE_ID = "019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7b";
const MISSING_FILE_ID = "019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7c";

/** Opens a regular draft in the project and returns its id. */
async function openDraft(
  db: Awaited<ReturnType<typeof createProjectFixture>>["db"],
  projectId: number,
  userId: string,
) {
  const id = generateUuidv7();
  await db
    .insert(drafts)
    .values({ id, projectId, kind: "regular", createdBy: userId, createdAt: Date.now() });
  return id;
}

async function fixture(media?: MediaBinding) {
  const fixture = await createProjectFixture(crypto.randomUUID());
  const baseContext = createServiceContext(fixture.db, fixture.memberUser);
  const bindings = { ...baseContext.env, MEDIA: media };
  const ctx = { ...baseContext, env: bindings };
  const app = new Hono<AppEnv>();
  app.onError(() => new Response("Test request failed", { status: 500 }));
  app.use("*", async (c, next) => {
    c.set("db", fixture.db);
    c.set("user", fixture.memberUser);
    await next();
  });
  app.route("/files", fileHonoRoutes);
  async function upload(
    metadata: Record<string, string> = {},
    type = "image/png",
    filename = "hero.png",
    targetId?: string,
    contents: string | Uint8Array = "image bytes",
  ) {
    const body = new FormData();
    body.set("file", new File([contents], filename, { type }));
    body.set("projectId", String(fixture.project.id));
    for (const [key, value] of Object.entries(metadata)) body.set(key, value);
    // Live is read-only: the upload starts a draft, published once the upload succeeds.
    const draftId = generateUuidv7();
    const execution = createExecutionContext();
    const response = await app.request(
      targetId === undefined
        ? "http://localhost/files/upload"
        : `http://localhost/files/${targetId}/content`,
      {
        method: "POST",
        body,
        headers: { [DRAFT_HEADER]: draftId, [DRAFT_CREATE_HEADER]: "1" },
      },
      bindings,
      execution,
    );
    await waitOnExecutionContext(execution);
    if (!response.ok) return response;
    // Answer with the file as Live has it once the draft is published.
    const { id } = await response.json<typeof files.$inferSelect>();
    await publishDraft(draftId);
    const live = await runService(
      getProjectFile(inScope(baseContext, null), { projectId: fixture.project.id, id }),
    );
    return Response.json(live, { status: response.status });
  }
  async function publishDraft(draftId: string) {
    const options = {
      context: {
        ...createRpcContext(fixture.db, fixture.memberUser, inDraft(draftId)),
        env: bindings,
      },
    };
    const projectId = fixture.project.id;
    const { token } = await call(router.drafts.previewPublish, { projectId }, options);
    await call(router.drafts.publish, { projectId, token }, options);
  }
  return { ...fixture, ctx, app, upload };
}

describe("media persistence", () => {
  it("persists supplied and empty alt text before scheduling, and serves the stored bytes", async () => {
    const { upload, db, app } = await fixture();
    for (const alt of ["Product screenshot", ""]) {
      const response = await upload({ alt }, "image/png", "hero café #1.png");
      expect(response.status).toBe(201);
      const record = await response.json<typeof files.$inferSelect>();
      expect(record).toMatchObject({ alt, aiMetadata: false, mimeType: "image/png" });
      expect(await db.select().from(files).where(eq(files.id, record.id)).get()).toMatchObject({
        alt,
      });
      expect(scheduledFor(record.id)).toEqual([]);
      const served = await app.request(record.url, {}, env);
      expect(new TextDecoder().decode(await served.arrayBuffer())).toBe("image bytes");
    }
  });

  it("supports byte ranges and HEAD for video playback on the same file URL", async () => {
    const { upload, app, ctx } = await fixture();
    const file = await (
      await upload({}, "video/mp4", "clip.mp4", undefined, "0123456789")
    ).json<typeof files.$inferSelect>();
    const partial = await app.request(file.url, { headers: { Range: "bytes=2-5" } }, ctx.env);
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(partial.headers.get("accept-ranges")).toBe("bytes");
    expect(new TextDecoder().decode(await partial.arrayBuffer())).toBe("2345");
    const suffix = await app.request(file.url, { headers: { Range: "bytes=-3" } }, ctx.env);
    expect(new TextDecoder().decode(await suffix.arrayBuffer())).toBe("789");
    const head = await app.request(file.url, { method: "HEAD" }, ctx.env);
    expect(head.headers.get("content-length")).toBe("10");
    expect(await head.text()).toBe("");
    const invalid = await app.request(file.url, { headers: { Range: "bytes=10-" } }, ctx.env);
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get("content-range")).toBe("bytes */10");
  });

  it("reads an uploaded image's dimensions from its bytes, and none for other files", async () => {
    const { upload } = await fixture();
    const bytes = (...parts: (number[] | string)[]) =>
      new Uint8Array(
        parts.flatMap((part) =>
          typeof part === "string" ? [...new TextEncoder().encode(part)] : part,
        ),
      );
    const be16 = (n: number) => [n >> 8, n & 0xff];
    const be32 = (n: number) => [0, 0, ...be16(n)];
    const le16 = (n: number) => [n & 0xff, n >> 8];
    const le24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, n >> 16];
    const images = {
      "image/png": bytes(
        [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
        be32(13),
        "IHDR",
        be32(640),
        be32(480),
        [8, 6, 0, 0, 0, 0, 0, 0, 0],
      ),
      "image/jpeg": bytes(
        [0xff, 0xd8],
        [0xff, 0xe0, ...be16(16)],
        "JFIF",
        Array.from({ length: 10 }, () => 0),
        [0xff, 0xc2, ...be16(17), 8, ...be16(480), ...be16(640)],
        Array.from({ length: 12 }, () => 0),
      ),
      "image/gif": bytes("GIF89a", le16(640), le16(480), [0, 0, 0]),
      "image/webp": bytes(
        "RIFF",
        [0, 0, 0, 0],
        "WEBPVP8X",
        [10, 0, 0, 0],
        [0, 0, 0, 0],
        le24(639),
        le24(479),
      ),
    };
    for (const [type, contents] of Object.entries(images)) {
      const file = await (
        await upload({ alt: "" }, type, "picture", undefined, contents)
      ).json<typeof files.$inferSelect>();
      expect([type, file.width, file.height]).toEqual([type, 640, 480]);
    }

    const pdf = await (
      await upload({ alt: "" }, "application/pdf", "manual.pdf")
    ).json<typeof files.$inferSelect>();
    expect(pdf).toMatchObject({ width: null, height: null });
    const unreadable = await (await upload({ alt: "" })).json<typeof files.$inferSelect>();
    expect(unreadable).toMatchObject({ width: null, height: null });
  });

  it("publishes a smaller video rendition before returning the file and deletes both blobs", async () => {
    const frame = (type: string, payload: Uint8Array) => {
      const bytes = new Uint8Array(payload.length + 8);
      new DataView(bytes.buffer).setUint32(0, bytes.length);
      bytes.set(new TextEncoder().encode(type), 4);
      bytes.set(payload, 8);
      return bytes;
    };
    const movie = new Uint8Array(20);
    new DataView(movie.buffer).setUint32(12, 1000);
    new DataView(movie.buffer).setUint32(16, 30_000);
    const track = new Uint8Array(8);
    new DataView(track.buffer).setUint32(0, 1280 * 65536);
    new DataView(track.buffer).setUint32(4, 720 * 65536);
    const video = (size: number) =>
      new Uint8Array([
        ...frame("ftyp", new Uint8Array(4)),
        ...frame("mdat", new Uint8Array(size)),
        ...frame(
          "moov",
          new Uint8Array([...frame("mvhd", movie), ...frame("trak", frame("tkhd", track))]),
        ),
      ]);
    const original = video(1024 * 1024);
    const rendition = video(100_000);
    const transform = vi.fn().mockReturnValue({
      output: vi.fn().mockReturnValue({
        response: vi.fn().mockResolvedValue(new Response(rendition)),
      }),
    });
    const input = vi.fn().mockReturnValue({
      transform,
    });
    const { upload, app, ctx, project } = await fixture({ input } as unknown as MediaBinding);
    const response = await upload({}, "video/mp4", "clip.mp4", undefined, original);
    expect(response.status).toBe(201);
    const file = await response.json<typeof files.$inferSelect>();
    expect(file).toMatchObject({ size: original.length, optimizedSize: rendition.length });
    expect(file.url).toContain(`${file.blobId}.optimized.mp4`);
    expect(input).toHaveBeenCalledOnce();
    expect(transform).toHaveBeenCalledWith({ width: 1280, height: 720, fit: "scale-down" });
    expect((await app.request(file.url, {}, ctx.env)).headers.get("content-type")).toBe(
      "video/mp4",
    );
    expect((await app.request(file.url, {}, ctx.env)).headers.get("content-length")).toBe(
      String(rendition.length),
    );
    expect((await ctx.env.FILES_BUCKET.head(file.blobId))?.size).toBe(original.length);
    // Publishing the deletion deletes the blobs no row names any more.
    await seedLiveThrough(ctx, project.id, (draft) =>
      deleteFile(inScope(ctx, draft), { id: file.id }),
    );
    expect((await ctx.env.FILES_BUCKET.list({ prefix: `${project.id}/` })).objects).toEqual([]);
  });

  it("preserves AI defaults, accepts explicit settings, and rejects conflicts and unsupported media", async () => {
    const { upload } = await fixture();
    const uploaded = await (await upload()).json<typeof files.$inferSelect>();
    expect(uploaded).toMatchObject({ aiMetadata: true, alt: "", filename: "hero.png" });
    // Generated in the upload's draft, then on Live once the draft is published.
    expect(jobScopes(uploaded.id)).toEqual(["draft", "live"]);
    expect(await (await upload({ aiMetadata: "true" })).json()).toMatchObject({
      aiMetadata: true,
    });
    expect(await (await upload({ aiMetadata: "false" })).json()).toMatchObject({
      aiMetadata: false,
    });
    expect((await upload({ alt: "", aiMetadata: "true" })).status).toBe(400);
    expect((await upload({ aiMetadata: "on" })).status).toBe(400);
    expect((await upload({ aiMetadata: "true" }, "application/pdf")).status).toBe(400);
    expect(await (await upload({}, "application/pdf")).json()).toMatchObject({
      aiMetadata: false,
    });
  });

  it("updates metadata atomically and enforces project and membership boundaries", async () => {
    const { upload, ctx, db, project, outsiderUser } = await fixture();
    const record = await (await upload()).json<typeof files.$inferSelect>();
    const target = { projectId: project.id, id: record.id };
    expect(
      await seedLiveThrough(ctx, project.id, (draft) =>
        updateFile(inScope(ctx, draft), { ...target, alt: "Manual" }),
      ),
    ).toMatchObject({
      alt: "Manual",
      aiMetadata: false,
    });
    /** A rejection of the input for the reason `message` gives. */
    const invalid = (message: string) => ({
      code: "BAD_REQUEST",
      data: { issues: expect.arrayContaining([expect.objectContaining({ message })]) },
    });
    await expect(
      seedLiveThrough(ctx, project.id, (draft) =>
        updateFile(inScope(ctx, draft), { ...target, alt: "Conflict", aiMetadata: true }),
      ),
    ).rejects.toMatchObject(
      invalid("Alt text cannot be combined with automatic metadata enabled."),
    );
    await expect(
      seedLiveThrough(ctx, project.id, (draft) => updateFile(inScope(ctx, draft), target)),
    ).rejects.toMatchObject(
      invalid("Provide a filename, alt text or an automatic metadata setting."),
    );
    expect(await runService(getProjectFile(inScope(ctx, null), target))).toMatchObject({
      alt: "Manual",
      aiMetadata: false,
    });
    expect(await runService(listFiles(inScope(ctx, null), { projectId: project.id }))).toHaveLength(
      1,
    );
    await expect(
      runService(getProjectFile(inScope(createServiceContext(db, outsiderUser), null), target)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const other = await fixture();
    await expect(
      runService(
        getProjectFile(inScope(other.ctx, null), { ...target, projectId: other.project.id }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    forgetScheduled(record.id);
    // Generated again, it shows what was generated: the upload's starting value so far.
    expect(
      await seedLiveThrough(ctx, project.id, (draft) =>
        updateFile(inScope(ctx, draft), { ...target, aiMetadata: true }),
      ),
    ).toMatchObject({
      aiMetadata: true,
      alt: "",
      filename: "hero.png",
    });
    expect(jobScopes(record.id)).toEqual(["draft", "live"]);
    expect(
      await seedLiveThrough(ctx, project.id, (draft) =>
        updateFile(inScope(ctx, draft), { ...target, alt: "" }),
      ),
    ).toMatchObject({
      alt: "",
      aiMetadata: false,
    });
  });

  it("exposes file operations through the shared agent tool dispatcher", async () => {
    const { upload, ctx, project } = await fixture();
    const file = await (await upload({ alt: "Original" })).json<typeof files.$inferSelect>();
    // AI tools write content, so they run in a draft: Live is read-only.
    const drafted = { ...ctx, draft: { id: generateUuidv7(), create: true } };
    const invoke = (name: string, args: unknown) =>
      runService(callTool(drafted, { projectId: project.id, name, arguments: args }));
    expect(await invoke("listFiles", {})).toMatchObject({ ok: true, result: [{ id: file.id }] });
    expect(await invoke("getFile", { id: file.id })).toMatchObject({
      ok: true,
      result: { id: file.id, alt: "Original" },
    });
    expect(await invoke("updateFile", { id: file.id, alt: "" })).toMatchObject({
      ok: true,
      result: { alt: "", aiMetadata: false },
    });
    expect(await invoke("updateFile", { id: file.id, filename: "dummy-hero.png" })).toMatchObject({
      ok: true,
      result: {
        id: file.id,
        filename: "dummy-hero.png",
        alt: "",
        aiMetadata: false,
        url: file.url,
        blobId: file.blobId,
      },
    });
    for (const filename of ["", " ", "../hero.png", ".", "..", "bad\u0000name"]) {
      expect(await invoke("updateFile", { id: file.id, filename })).toMatchObject({ ok: false });
    }
    expect(
      await invoke("updateFile", { id: file.id, alt: "Manual", aiMetadata: true }),
    ).toMatchObject({ ok: false });
  });

  it("replaces bytes and metadata together, keeping references and bytes another draft names", async () => {
    const { upload, ctx, db, project, layout, memberUser, app } = await fixture();
    const original = await (
      await upload({ alt: "Original alt" })
    ).json<typeof files.$inferSelect>();
    const now = Date.now();
    const block = await db
      .insert(blocks)
      .values({
        projectId: layout.projectId,
        layoutId: layout.layoutId,
        type: "hero",
        content: { image: { _fileId: original.id }, html: `<img src="${original.url}">` },
        position: "a0",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    const item = await db
      .insert(repeatableItems)
      .values({
        blockId: block.id,
        fieldName: "images",
        content: { image: { _fileId: original.id }, url: original.url },
        position: "a0",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    // Another draft still holds the file as it was, naming the same R2 object.
    const otherDraftId = await openDraft(db, project.id, memberUser.id);
    await db.insert(files).values({ ...original, rowId: undefined, draftId: otherDraftId });
    forgetScheduled(original.id);
    const response = await upload(
      { alt: "New alt" },
      "image/webp",
      "replacement.webp",
      original.id,
      "new bytes",
    );
    expect(response.status).toBe(200);
    const replaced = await response.json<typeof files.$inferSelect>();
    expect(replaced).toMatchObject({
      id: original.id,
      filename: "replacement.webp",
      alt: "New alt",
      aiMetadata: false,
      mimeType: "image/webp",
      size: 9,
      createdAt: original.createdAt,
    });
    expect(replaced.url).not.toBe(original.url);
    expect(scheduledFor(original.id)).toEqual([]);
    expect(await runService(listFiles(inScope(ctx, null), { projectId: project.id }))).toHaveLength(
      1,
    );
    // Content names files by id, so replacing one rewrites no content.
    expect(await db.select().from(blocks).where(eq(blocks.id, block.id)).get()).toMatchObject({
      content: { image: { _fileId: original.id }, html: `<img src="${original.url}">` },
    });
    expect(
      await db.select().from(repeatableItems).where(eq(repeatableItems.id, item.id)).get(),
    ).toMatchObject({
      content: { image: { _fileId: original.id }, url: original.url },
    });
    // The other draft still names the old bytes, so they stay stored.
    expect(await ctx.env.FILES_BUCKET.head(original.blobId)).not.toBeNull();
    const served = await app.request(replaced.url, {}, env);
    expect(new TextDecoder().decode(await served.arrayBuffer())).toBe("new bytes");
    // Generated metadata doesn't apply to the replacement's explicit metadata.
    await runService(
      saveValue(
        db,
        { projectId: project.id, draftId: null },
        metadataKey(original.id),
        { alt: "Stale", filename: "stale" },
        Date.now(),
      ),
    );
    expect(
      await runService(
        getProjectFile(inScope(ctx, null), { projectId: project.id, id: original.id }),
      ),
    ).toMatchObject({
      alt: "New alt",
      filename: "replacement.webp",
    });
  });

  it("preserves omitted metadata, schedules only the target, and removes unshared old blobs", async () => {
    const { upload, ctx, project } = await fixture();
    const original = await (await upload({ alt: "Keep this" })).json<typeof files.$inferSelect>();
    const target = { id: original.id, projectId: project.id };
    await seedLiveThrough(ctx, project.id, (draft) =>
      updateFile(inScope(ctx, draft), { ...target, aiMetadata: true }),
    );
    forgetScheduled(original.id);
    const replacement = await (
      await upload({}, "image/webp", "new.webp", original.id)
    ).json<typeof files.$inferSelect>();
    expect(replacement).toMatchObject({
      id: original.id,
      alt: "Keep this",
      aiMetadata: true,
      filename: "new.webp",
    });
    expect(jobScopes(original.id)).toEqual(["draft", "live"]);
    expect(scheduledFor(original.id)[0]).toMatchObject({ entity: "file" });
    expect(await ctx.env.FILES_BUCKET.head(original.blobId)).toBeNull();
    forgetScheduled(original.id);
    // A file that can't have generated metadata gets manual metadata.
    expect(
      await (await upload({}, "application/pdf", "new.pdf", original.id)).json(),
    ).toMatchObject({ alt: "Keep this", filename: "new.pdf", aiMetadata: false });
    expect(scheduledFor(original.id)).toEqual([]);
    expect(
      await (await upload({ alt: "" }, "image/png", "empty-alt.png", original.id)).json(),
    ).toMatchObject({ alt: "", aiMetadata: false });
  });

  it("rejects invalid replacement metadata and out-of-scope targets without storing uploads", async () => {
    const { upload, ctx, db, project, memberUser } = await fixture();
    const original = await (await upload({ alt: "Original" })).json<typeof files.$inferSelect>();
    const before = await ctx.env.FILES_BUCKET.list({ prefix: `${project.id}/` });
    expect(
      (await upload({ alt: "Manual", aiMetadata: "true" }, "image/png", "bad.png", original.id))
        .status,
    ).toBe(400);
    expect(
      (await upload({ aiMetadata: "true" }, "application/pdf", "bad.pdf", original.id)).status,
    ).toBe(400);
    expect((await upload({}, "image/png", "missing.png", MISSING_FILE_ID)).status).toBe(404);
    const other = await fixture();
    const otherFile = await (await other.upload()).json<typeof files.$inferSelect>();
    expect((await upload({}, "image/png", "other.png", otherFile.id)).status).toBe(404);
    expect(
      (
        await upload(
          { projectId: String(other.project.id) },
          "image/png",
          "other.png",
          otherFile.id,
        )
      ).status,
    ).toBe(403);
    // A file only another draft holds is out of reach of an upload in a new draft.
    const { id: _id, rowId: _rowId, ...copy } = original;
    const draftFile = await db
      .insert(files)
      .values({ ...copy, draftId: await openDraft(db, project.id, memberUser.id) })
      .returning()
      .get();
    expect((await upload({}, "image/png", "draft.png", draftFile.id)).status).toBe(404);
    expect((await ctx.env.FILES_BUCKET.list({ prefix: `${project.id}/` })).objects).toEqual(
      before.objects,
    );
    expect(
      await runService(
        getProjectFile(inScope(ctx, null), { projectId: project.id, id: original.id }),
      ),
    ).toEqual(original);
  });

  it("rolls back replacement and metadata on database failure and cleans up the new binary", async () => {
    const { upload, ctx, db, project } = await fixture();
    const original = await (await upload({ alt: "Original" })).json<typeof files.$inferSelect>();
    const triggerName = `fail_replace_${original.id.replaceAll("-", "_")}`;
    await db.run(
      sql.raw(
        `CREATE TRIGGER ${triggerName} BEFORE INSERT ON files WHEN NEW.id = '${original.id}' BEGIN SELECT RAISE(ABORT, 'test rollback'); END`,
      ),
    );
    const before = await ctx.env.FILES_BUCKET.list({ prefix: `${project.id}/` });
    try {
      expect(
        (await upload({ alt: "Should roll back" }, "image/webp", "failed.webp", original.id))
          .status,
      ).toBe(500);
      expect(
        await runService(
          getProjectFile(inScope(ctx, null), { projectId: project.id, id: original.id }),
        ),
      ).toEqual(original);
      expect((await ctx.env.FILES_BUCKET.list({ prefix: `${project.id}/` })).objects).toEqual(
        before.objects,
      );
    } finally {
      await db.run(sql.raw(`DROP TRIGGER ${triggerName}`));
    }
  });

  it("shows generated metadata only while the group is generated, never over a manual edit", async () => {
    const { upload, ctx, db, project } = await fixture();
    const record = await (await upload()).json<typeof files.$inferSelect>();
    const target = { projectId: project.id, id: record.id };
    const generate = (metadata: { alt: string; filename: string }) =>
      runService(
        saveValue(
          db,
          { projectId: project.id, draftId: null },
          metadataKey(record.id),
          metadata,
          Date.now(),
        ),
      );
    await seedLiveThrough(ctx, project.id, (draft) =>
      updateFile(inScope(ctx, draft), { ...target, alt: "Keep this" }),
    );

    await generate({ filename: "ai-name", alt: "AI description" });
    expect(await runService(getProjectFile(inScope(ctx, null), target))).toMatchObject({
      alt: "Keep this",
      filename: "hero.png",
      aiMetadata: false,
    });

    await seedLiveThrough(ctx, project.id, (draft) =>
      updateFile(inScope(ctx, draft), { ...target, aiMetadata: true }),
    );
    expect(await runService(getProjectFile(inScope(ctx, null), target))).toMatchObject({
      alt: "AI description",
      filename: "ai-name",
      aiMetadata: true,
    });
  });

  it("makes the whole group manual when only the filename is written", async () => {
    const { upload, ctx, db, project } = await fixture();
    const record = await (await upload()).json<typeof files.$inferSelect>();
    const target = { projectId: project.id, id: record.id };
    await runService(
      saveValue(
        db,
        { projectId: project.id, draftId: null },
        metadataKey(record.id),
        { alt: "AI description", filename: "ai-name" },
        Date.now(),
      ),
    );

    await seedLiveThrough(ctx, project.id, (draft) =>
      updateFile(inScope(ctx, draft), { ...target, filename: "mine.png" }),
    );

    expect(await runService(getProjectFile(inScope(ctx, null), target))).toMatchObject({
      alt: "AI description",
      filename: "mine.png",
      aiMetadata: false,
    });
  });
});

describe("stable file identity", () => {
  it("an upload returns a UUIDv7 file id, or keeps a client-minted UUIDv7", async () => {
    const { upload, ctx, project } = await fixture();
    const minted = await (await upload()).json<typeof files.$inferSelect>();
    expect(minted.id).toMatch(UUIDV7);

    const optimistic = await upload({ id: CLIENT_FILE_ID });
    expect(optimistic.status).toBe(201);
    expect(await optimistic.json()).toMatchObject({ id: CLIENT_FILE_ID });
    expect(
      await runService(
        getProjectFile(inScope(ctx, null), { projectId: project.id, id: CLIENT_FILE_ID }),
      ),
    ).toMatchObject({ id: CLIENT_FILE_ID });
  });

  it("procedures, the upload route and AI tools reject a file id that isn't a UUIDv7", async () => {
    const { upload, ctx, project, db, memberUser } = await fixture();
    const file = await (await upload()).json<typeof files.$inferSelect>();
    const context = {
      ...ctx,
      headers: new Headers(),
      session: {
        id: "session",
        token: "test",
        userId: memberUser.id,
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };
    const notUuidv7 = [1, "1", crypto.randomUUID()];
    for (const id of notUuidv7) {
      for (const [procedure, input] of [
        [fileProcedures.get, { id }],
        [fileProcedures.getUsageCount, { id }],
        [fileProcedures.setAlt, { id, alt: "Alt" }],
        [fileProcedures.setFilename, { id, filename: "hero.png" }],
        [fileProcedures.delete, { id }],
        [fileProcedures.deleteMany, { ids: [file.id, id] }],
        [fileProcedures.setAiMetadata, { id, enabled: false }],
        [fileProcedures.generateMetadata, { id }],
      ] as const) {
        await expect(
          callSeedingLive(procedure as never, input as never, { context }),
        ).rejects.toMatchObject({
          code: "BAD_REQUEST",
        });
      }
      for (const name of ["getFile", "updateFile"]) {
        expect(
          await runService(
            callTool(
              { ...ctx, draft: { id: generateUuidv7(), create: true } },
              { projectId: project.id, name, arguments: { id, alt: "Alt" } },
            ),
          ),
        ).toMatchObject({ ok: false });
      }
      expect((await upload({ id: String(id) })).status).toBe(400);
      expect((await upload({}, "image/png", "hero.png", String(id))).status).toBe(400);
    }
    expect(await db.select().from(files).where(eq(files.projectId, project.id))).toHaveLength(1);
    expect((await ctx.env.FILES_BUCKET.list({ prefix: `${project.id}/` })).objects).toHaveLength(1);
  });

  it("deleting a file leaves the content using it alone, and changes no block", async () => {
    const { upload, ctx, db, layout, memberUser } = await fixture();
    const deleted = await (await upload()).json<typeof files.$inferSelect>();
    const kept = await (await upload()).json<typeof files.$inferSelect>();
    const now = Date.now();
    const block = await db
      .insert(blocks)
      .values({
        projectId: layout.projectId,
        layoutId: layout.layoutId,
        type: "hero",
        content: {
          image: { _fileId: deleted.id },
          logo: { _fileId: kept.id },
          gallery: [{ _fileId: deleted.id }, { _fileId: kept.id }],
        },
        position: "a0",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    const draftId = await openDraft(db, layout.projectId, memberUser.id);
    const draft = { id: draftId, kind: "regular" as const, projectId: layout.projectId };
    await runService(deleteFile(inScope(ctx, draft), { id: deleted.id }));

    // Publishing catches what now points at nothing, where it can be fixed (ADR 0009).
    expect(await db.select().from(blocks).where(eq(blocks.id, block.id)).get()).toEqual(block);
    expect(await db.select().from(blocks).where(eq(blocks.draftId, draftId))).toEqual([]);
  });
});
