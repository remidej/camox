import { DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vite-plus/test";

import { forgetPurged, purged } from "../../test/edge-cache-purges";
import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  createSessionFixture,
  seedLive,
  syncDefinitionSet,
} from "../../test/fixtures";
import app from "../index";
import { router } from "../router";
import { files, pages } from "../schema";

const now = 1_700_000_000_000;

async function fixture() {
  const base = await createProjectFixture(`edge-purges-${crypto.randomUUID()}`);
  const projectId = base.project.id;
  await syncDefinitionSet(base.db, base.project, {
    blocks: [
      {
        blockId: "hero",
        title: "Hero",
        description: "Hero",
        contentSchema: {
          type: "object",
          properties: { title: { fieldType: "String", type: "string" } },
          toMarkdown: ["# {{title}}"],
        },
      },
    ],
  });
  const page = await seedLive(base.db, pages, {
    projectId,
    layoutId: base.layout.layoutId,
    pathSegment: "about",
    fullPath: "/about",
    nickname: "About",
    contentUpdatedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const block = await callSeedingLive(
    router.blocks.create,
    { pageId: page.id, type: "hero", content: { title: "Live" } },
    { context: createRpcContext(base.db, base.memberUser) },
  );
  /** Calls as the member, in a draft created by the call when missing. */
  const inDraft = (draftId: string) => ({
    context: createRpcContext(base.db, base.memberUser, {
      [DRAFT_HEADER]: draftId,
      [DRAFT_CREATE_HEADER]: "1",
    }),
  });
  const liveTag = `live:${projectId}`;
  /** Whether `run` alone purged the project's Live cache key. */
  const purgesLive = async (run: () => Promise<unknown>) => {
    forgetPurged(liveTag);
    await run();
    return purged(liveTag);
  };
  return { ...base, projectId, block, inDraft, purgesLive };
}

describe("the Live cache key", () => {
  it("is purged when a draft is published", async () => {
    const { block, inDraft, projectId, purgesLive } = await fixture();
    const draftId = generateUuidv7();
    await call(
      router.blocks.updateContent,
      { id: block.id, content: { title: "Published" } },
      inDraft(draftId),
    );
    const { token } = await call(router.drafts.previewPublish, { projectId }, inDraft(draftId));

    expect(
      await purgesLive(() => call(router.drafts.publish, { projectId, token }, inDraft(draftId))),
    ).toBe(true);
  });

  it("is kept while a draft is edited, since visitors don't see drafts", async () => {
    const { block, inDraft, purgesLive } = await fixture();

    expect(
      await purgesLive(() =>
        call(
          router.blocks.updateContent,
          { id: block.id, content: { title: "Draft" } },
          inDraft(generateUuidv7()),
        ),
      ),
    ).toBe(false);
  });

  it("is kept when a draft is discarded", async () => {
    const { block, inDraft, projectId, purgesLive } = await fixture();
    const draftId = generateUuidv7();
    await call(
      router.blocks.updateContent,
      { id: block.id, content: { title: "Discarded" } },
      inDraft(draftId),
    );

    expect(
      await purgesLive(() => call(router.drafts.discard, { projectId }, inDraft(draftId))),
    ).toBe(false);
  });

  it("is purged when a project setting changes, as those apply without publishing", async () => {
    const { db, memberUser, projectId, purgesLive } = await fixture();

    expect(
      await purgesLive(() =>
        call(
          router.projects.update,
          { id: projectId, name: "Renamed" },
          { context: createRpcContext(db, memberUser) },
        ),
      ),
    ).toBe(true);
  });

  it("is purged when a release syncs new definitions to Live", async () => {
    const { db, project, purgesLive } = await fixture();

    expect(
      await purgesLive(() =>
        syncDefinitionSet(db, project, {
          blocks: [
            {
              blockId: "footer",
              title: "Footer",
              description: "Footer",
              contentSchema: { type: "object", properties: {} },
            },
          ],
        }),
      ),
    ).toBe(true);
  });
});

describe("a deleted file", () => {
  it("is purged from the edge once no row names its blob any more", async () => {
    const { db, inDraft, projectId } = await fixture();
    const blobId = `${projectId}/${crypto.randomUUID()}`;
    const file = await seedLive(db, files, {
      projectId,
      url: `https://api.camox.ai/files/serve/${blobId}`,
      mimeType: "image/png",
      size: 1,
      blobId,
      path: blobId,
      createdAt: now,
      updatedAt: now,
    });
    const draftId = generateUuidv7();
    await call(router.files.delete, { id: file.id }, inDraft(draftId));
    const { token } = await call(router.drafts.previewPublish, { projectId }, inDraft(draftId));
    forgetPurged(`file:${blobId}`);

    await call(router.drafts.publish, { projectId, token }, inDraft(draftId));

    expect(purged(`file:${blobId}`)).toBe(true);
  });
});

describe("a favicon", () => {
  it("is purged from the edge when a new one is uploaded", async () => {
    const { memberUser, projectId } = await fixture();
    const sessionToken = await createSessionFixture(memberUser.id);
    const body = new FormData();
    body.set("projectId", String(projectId));
    body.set("file", new File(["png-bytes"], "favicon.png", { type: "image/png" }));
    forgetPurged(`favicon:${projectId}`);

    const response = await app.request(
      "/favicons/upload",
      { method: "POST", body, headers: { authorization: `Bearer ${sessionToken}` } },
      env,
    );

    expect(response.status).toBe(200);
    expect(purged(`favicon:${projectId}`)).toBe(true);
  });
});
