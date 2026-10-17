import { DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { queryKeys, type ProjectRoomMessage, type QueryKey } from "@camox/api-contract/query-keys";
import { call } from "@orpc/server";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  createServiceContext,
  openDevelopmentDraft,
  seedLive,
} from "../../test/fixtures";
import { forgetSent, refreshes, sentTo } from "../../test/project-rooms";
import { upsertBlockDefinition } from "../domains/block-definitions/service";
import * as overlay from "../domains/drafts/overlay";
import { router } from "../router";
import { blocks, drafts, files, pages } from "../schema";
import { ConflictError } from "./errors";
import { runService } from "./run-service";

const now = 1_700_000_000_000;

async function fixture() {
  const base = await createProjectFixture(`invalidation-${crypto.randomUUID()}`);
  const projectId = base.project.id;
  const file = await seedLive(base.db, files, {
    projectId,
    url: "https://example.com/a.png",
    mimeType: "image/png",
    size: 1,
    blobId: "blob",
    path: "blob",
    createdAt: now,
    updatedAt: now,
  });
  await runService(
    upsertBlockDefinition(createServiceContext(base.db, null), {
      projectSlug: base.project.slug,
      deployToken: base.project.deployToken,
      blockId: "hero",
      title: "Hero",
      description: "Hero",
      contentSchema: {
        type: "object",
        properties: { title: { fieldType: "String", type: "string" } },
        toMarkdown: ["# {{title}}"],
      },
    }),
  );
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
  /** What the project's room was sent by `run` alone. */
  const sentBy = async (run: () => Promise<unknown>): Promise<ProjectRoomMessage[]> => {
    forgetSent(projectId);
    await run();
    return sentTo(projectId);
  };
  return { ...base, projectId, file, page, block, inDraft, sentBy };
}

/** Whether every key is refreshed from a scope: a draft's id, or null for Live. */
const refreshesAll = (
  messages: ProjectRoomMessage[],
  draftId: string | null,
  keys: readonly QueryKey[],
) => keys.every((key) => refreshes(messages, draftId, key));

describe("a file edit in a draft", () => {
  it("refreshes the file's reads and the draft's change count", async () => {
    const { file, inDraft, projectId, sentBy } = await fixture();
    const draftId = generateUuidv7();

    const sent = await sentBy(() =>
      call(router.files.setAlt, { id: file.id, alt: "A hero" }, inDraft(draftId)),
    );

    expect(
      refreshesAll(sent, draftId, [
        queryKeys.files.list,
        queryKeys.files.get(file.id),
        [...queryKeys.drafts.get, draftId],
      ]),
    ).toBe(true);
    expect(refreshes(sent, null, [...queryKeys.drafts.list, projectId])).toBe(true);
  });
});

describe("a block edit in a draft", () => {
  it("refreshes the block, its page and the draft's change count, but not every page", async () => {
    const { block, page, inDraft, sentBy } = await fixture();
    const draftId = generateUuidv7();

    const sent = await sentBy(() =>
      call(
        router.blocks.updateContent,
        { id: block.id, content: { title: "Draft" } },
        inDraft(draftId),
      ),
    );

    expect(
      refreshesAll(sent, draftId, [
        queryKeys.blocks.get(block.id),
        queryKeys.pages.getByPath("/about"),
        queryKeys.blocks.getPageMarkdown(page.id),
        [...queryKeys.drafts.get, draftId],
      ]),
    ).toBe(true);
    // Every Canvas frame reads under a page path: refreshing them all redraws every frame.
    expect(refreshes(sent, draftId, [...queryKeys.pages.getByPath("/home"), "canvas"])).toBe(false);
    // Live's readers see nothing new.
    expect(refreshes(sent, null, queryKeys.blocks.get(block.id))).toBe(false);
    expect(refreshes(sent, null, queryKeys.pages.getByPath("/about"))).toBe(false);
  });
});

describe("publishing a draft", () => {
  it("refreshes Live's readers of what it changed and every draft's conflicts, then sends its viewers to Live", async () => {
    const { block, inDraft, projectId, sentBy } = await fixture();
    const draftId = generateUuidv7();
    const otherDraft = generateUuidv7();
    await call(
      router.blocks.updateContent,
      { id: block.id, content: { title: "Published" } },
      inDraft(draftId),
    );
    const { token } = await call(router.drafts.previewPublish, { projectId }, inDraft(draftId));

    const sent = await sentBy(() =>
      call(router.drafts.publish, { projectId, token }, inDraft(draftId)),
    );

    expect(
      refreshesAll(sent, null, [
        queryKeys.blocks.get(block.id),
        queryKeys.pages.getByPath("/about"),
        [...queryKeys.drafts.all, "previewPublish", otherDraft],
      ]),
    ).toBe(true);
    expect(sent.at(-1)).toMatchObject({ type: "draftEnded", draftId, outcome: "published" });
  });
});

describe("publishing a renamed page", () => {
  it("refreshes Live's readers of the path it had", async () => {
    const { page, inDraft, projectId, sentBy } = await fixture();
    const draftId = generateUuidv7();
    await call(router.pages.update, { id: page.id, pathSegment: "team" }, inDraft(draftId));
    const { token } = await call(router.drafts.previewPublish, { projectId }, inDraft(draftId));

    const sent = await sentBy(() =>
      call(router.drafts.publish, { projectId, token }, inDraft(draftId)),
    );

    expect(refreshes(sent, null, queryKeys.pages.getByPath("/about"))).toBe(true);
    expect(refreshes(sent, null, queryKeys.pages.getByPath("/team"))).toBe(true);
  });
});

describe("discarding a development draft", () => {
  it("refreshes what its readers saw, since it stays open, emptied", async () => {
    const { db, block, memberUser, projectId, sentBy } = await fixture();
    const development = await openDevelopmentDraft(db, projectId, memberUser.id);
    const inDevelopment = {
      context: createRpcContext(db, memberUser, { [DRAFT_HEADER]: "development" }),
    };
    await call(
      router.blocks.updateContent,
      { id: block.id, content: { title: "Local" } },
      inDevelopment,
    );

    const sent = await sentBy(() => call(router.drafts.discard, { projectId }, inDevelopment));

    expect(
      refreshesAll(sent, development, [
        queryKeys.blocks.get(block.id),
        [...queryKeys.drafts.get, development],
      ]),
    ).toBe(true);
  });
});

describe("a definitions sync in a development draft", () => {
  it("refreshes everything the draft reads", async () => {
    const { db, memberUser, project, projectId, sentBy } = await fixture();
    const development = await openDevelopmentDraft(db, projectId, memberUser.id);
    const context = createRpcContext(db, memberUser, { [DRAFT_HEADER]: "development" });

    const sent = await sentBy(() =>
      call(
        router.blockDefinitions.sync,
        {
          projectSlug: project.slug,
          autoCreate: false,
          definitions: [
            {
              blockId: "hero",
              title: "Hero",
              description: "A new description",
              contentSchema: { type: "object", properties: {} },
            },
          ],
        },
        { context },
      ),
    );

    expect(refreshes(sent, development, queryKeys.layouts.all)).toBe(true);
    expect(refreshes(sent, development, queryKeys.blocks.getUsageCounts)).toBe(true);
  });
});

describe("a unit of work that fails", () => {
  it("sends nothing, even for what it wrote before failing", async () => {
    const { db, block, memberUser, projectId, sentBy } = await fixture();
    const draft = await db
      .insert(drafts)
      .values({ projectId, kind: "regular", createdBy: memberUser.id, createdAt: now })
      .returning()
      .get();

    const sent = await sentBy(() =>
      runService(
        Effect.gen(function* () {
          yield* overlay.update(db, draft, blocks, block.id, { content: { title: "Lost" } });
          return yield* new ConflictError({ message: "Failed after writing" });
        }),
      ).catch(() => undefined),
    );

    expect(sent).toEqual([]);
  });
});
