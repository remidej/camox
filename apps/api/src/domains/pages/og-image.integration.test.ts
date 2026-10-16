import {
  DRAFT_CREATE_HEADER,
  DRAFT_HEADER,
  LIVE_READ_ONLY_ERROR,
} from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createProjectFixture, createRpcContext } from "../../../test/fixtures";
import { router } from "../../router";
import { drafts, pages } from "../../schema";
import type { AppEnv } from "../../types";
import { pageHonoRoutes } from "./og-image-routes";

const { broadcastInvalidation, broadcastDraftEnded } = vi.hoisted(() => {
  // Modules loaded by earlier test files would keep the real broadcaster.
  vi.resetModules();
  return { broadcastInvalidation: vi.fn(), broadcastDraftEnded: vi.fn() };
});
vi.mock("../../lib/broadcast-invalidation", () => ({ broadcastInvalidation, broadcastDraftEnded }));

type Headers = Record<string, string>;

/** Headers naming a draft, creating it when missing. */
const startingDraft = (id: string) => ({ [DRAFT_HEADER]: id, [DRAFT_CREATE_HEADER]: "1" });
/** Headers naming an existing draft. */
const inDraft = (id: string) => ({ [DRAFT_HEADER]: id });

async function fixture() {
  const base = await createProjectFixture(`og-image-${crypto.randomUUID()}`);
  const env = createRpcContext(base.db, base.memberUser).env;

  // Live's page already has a custom OG image.
  const liveBlobId = `${base.project.id}/page-og/live.png`;
  await env.FILES_BUCKET.put(liveBlobId, "live bytes");
  const now = 1_700_000_000_000;
  const page = await base.db
    .insert(pages)
    .values({
      projectId: base.project.id,
      layoutId: base.layout.layoutId,
      pathSegment: "",
      fullPath: "/",
      nickname: "Home",
      metaTitle: "Home",
      customOgImageBlobId: liveBlobId,
      customOgImageUrl: `http://localhost/files/serve/${liveBlobId}`,
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
    await next();
  });
  app.route("/pages", pageHonoRoutes);

  async function send(method: "POST" | "DELETE", headers: Headers, bytes = "new bytes") {
    const body = method === "POST" ? new FormData() : undefined;
    body?.set("file", new File([bytes], "og.png", { type: "image/png" }));
    const execution = createExecutionContext();
    const response = await app.request(
      `http://localhost/pages/${page.id}/og-image`,
      { method, body, headers },
      env,
      execution,
    );
    await waitOnExecutionContext(execution);
    return response;
  }

  const getPage = (headers: Headers = {}) =>
    call(
      router.pages.get,
      { id: page.id },
      { context: createRpcContext(base.db, base.memberUser, headers) },
    );
  const blobExists = async (blobId: string) => (await env.FILES_BUCKET.head(blobId)) !== null;
  const bytesAt = async (url: string) => {
    const blobId = url.replace(/^.*\/files\/serve\//, "");
    return (await env.FILES_BUCKET.get(blobId))?.text();
  };

  const rpc = (headers: Headers) => ({
    context: createRpcContext(base.db, base.memberUser, headers),
  });
  async function publish(draftId: string) {
    const projectId = base.project.id;
    const preview = await call(router.drafts.previewPublish, { projectId }, rpc(inDraft(draftId)));
    expect(preview.blockers).toEqual([]);
    await call(router.drafts.publish, { projectId, token: preview.token }, rpc(inDraft(draftId)));
  }
  const discard = (draftId: string) =>
    call(router.drafts.discard, { projectId: base.project.id }, rpc(inDraft(draftId)));

  return {
    ...base,
    page,
    publish,
    discard,
    liveBlobId,
    upload: (headers: Headers, bytes?: string) => send("POST", headers, bytes),
    remove: (headers: Headers) => send("DELETE", headers),
    getPage,
    blobExists,
    bytesAt,
  };
}

describe("page custom OG image in drafts", () => {
  it("uploading or removing naming no draft is rejected and leaves Live alone", async () => {
    const f = await fixture();

    for (const response of [await f.upload({}), await f.remove({})]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: LIVE_READ_ONLY_ERROR });
    }

    const live = await f.getPage();
    expect(live.customOgImageBlobId).toBe(f.liveBlobId);
    expect(await f.blobExists(f.liveBlobId)).toBe(true);
  });

  it("uploading on Live with the create header starts a draft holding the image, and Live keeps its own", async () => {
    const f = await fixture();
    const draftId = generateUuidv7();

    const response = await f.upload(startingDraft(draftId), "draft bytes");
    expect(response.status).toBe(200);

    expect(await f.db.select().from(drafts).where(eq(drafts.id, draftId)).get()).toBeDefined();
    const drafted = await f.getPage(inDraft(draftId));
    expect(await f.bytesAt(drafted.customOgImageUrl!)).toBe("draft bytes");
    const live = await f.getPage();
    expect(live.customOgImageBlobId).toBe(f.liveBlobId);
    expect(await f.blobExists(f.liveBlobId)).toBe(true);
  });

  it("replacing the image twice in a draft deletes the first replacement's blob only", async () => {
    const f = await fixture();
    const draftId = generateUuidv7();

    await f.upload(startingDraft(draftId), "first");
    const first = (await f.getPage(inDraft(draftId))).customOgImageBlobId!;
    await f.upload(inDraft(draftId), "second");

    expect(await f.bytesAt((await f.getPage(inDraft(draftId))).customOgImageUrl!)).toBe("second");
    expect(await f.blobExists(first)).toBe(false);
    expect(await f.blobExists(f.liveBlobId)).toBe(true);
  });

  it("removing the image in a draft clears it there only and keeps Live's blob", async () => {
    const f = await fixture();
    const draftId = generateUuidv7();

    const response = await f.remove(startingDraft(draftId));
    expect(response.status).toBe(200);

    const drafted = await f.getPage(inDraft(draftId));
    expect(drafted.customOgImageBlobId).toBeNull();
    expect(drafted.customOgImageUrl).toBeNull();
    expect((await f.getPage()).customOgImageBlobId).toBe(f.liveBlobId);
    expect(await f.blobExists(f.liveBlobId)).toBe(true);
  });

  it("publishing a replaced image deletes Live's old blob and keeps the draft's", async () => {
    const f = await fixture();
    const draftId = generateUuidv7();
    await f.upload(startingDraft(draftId), "draft bytes");
    const drafted = (await f.getPage(inDraft(draftId))).customOgImageBlobId!;

    await f.publish(draftId);

    expect((await f.getPage()).customOgImageBlobId).toBe(drafted);
    expect(await f.blobExists(drafted)).toBe(true);
    expect(await f.blobExists(f.liveBlobId)).toBe(false);
  });

  it("discarding a replaced image deletes the draft's blob and keeps Live's", async () => {
    const f = await fixture();
    const draftId = generateUuidv7();
    await f.upload(startingDraft(draftId), "draft bytes");
    const drafted = (await f.getPage(inDraft(draftId))).customOgImageBlobId!;

    await f.discard(draftId);

    expect((await f.getPage()).customOgImageBlobId).toBe(f.liveBlobId);
    expect(await f.blobExists(f.liveBlobId)).toBe(true);
    expect(await f.blobExists(drafted)).toBe(false);
  });
});
