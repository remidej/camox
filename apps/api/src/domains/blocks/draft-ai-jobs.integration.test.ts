import { DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createProjectFixture,
  createRpcContext,
  createServiceContext,
  callSeedingLive,
} from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import { drafts, pages } from "../../schema";
import { upsertBlockDefinition } from "../block-definitions/service";
import { runBlockSummaryJob } from "./service";

const { chat, scheduleAiJob, broadcastInvalidation } = vi.hoisted(() => {
  vi.resetModules();
  return {
    chat: vi.fn(),
    scheduleAiJob: vi.fn().mockResolvedValue(undefined),
    broadcastInvalidation: vi.fn(),
  };
});
vi.mock("@tanstack/ai", () => ({ chat }));
vi.mock("../../lib/schedule-ai-job", () => ({ scheduleAiJob }));
vi.mock("../../lib/broadcast-invalidation", () => ({ broadcastInvalidation }));

afterEach(() => vi.clearAllMocks());

const startingDraft = (id: string) => ({ [DRAFT_HEADER]: id, [DRAFT_CREATE_HEADER]: "1" });
const inDraft = (id: string) => ({ [DRAFT_HEADER]: id });

async function fixture() {
  const base = await createProjectFixture(`draft-ai-jobs-${crypto.randomUUID()}`);
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
  const member = (headers: Record<string, string> = {}) => ({
    context: createRpcContext(base.db, base.memberUser, headers),
  });
  const createBlock = (title: string) =>
    callSeedingLive(
      router.blocks.create,
      { pageId: page.id, type: "hero", content: { title } },
      member(),
    );
  const editTitle = (id: string, title: string, headers: Record<string, string> = {}) =>
    callSeedingLive(router.blocks.updateContent, { id, content: { title } }, member(headers));
  const summaryIn = async (id: string, headers: Record<string, string> = {}) =>
    (await call(router.blocks.get, { id }, member(headers))).block.summary;
  const titleIn = async (id: string, headers: Record<string, string> = {}) =>
    (await call(router.blocks.get, { id }, member(headers))).block.content.title;
  const runJob = (entityId: string, draftId: string | null) =>
    runService(runBlockSummaryJob(base.db, "key", { entityId, draftId }));

  return { ...base, createBlock, editTitle, summaryIn, titleIn, runJob };
}

describe("block summary jobs in drafts", () => {
  it("carries the draft a block was edited in", async () => {
    const { createBlock, editTitle } = await fixture();
    const block = await createBlock("Live");
    const draft = generateUuidv7();
    scheduleAiJob.mockClear();

    await editTitle(block.id, "Draft", startingDraft(draft));
    await editTitle(block.id, "Live again");

    const scheduled = scheduleAiJob.mock.calls.map(([, job]) => job);
    expect(scheduled).toEqual([
      expect.objectContaining({ entityTable: "blocks", entityId: block.id, draftId: draft }),
      expect.objectContaining({ entityTable: "blocks", entityId: block.id, draftId: null }),
    ]);
  });

  it("writes a draft job's summary onto the draft's block only", async () => {
    const { createBlock, editTitle, summaryIn, runJob } = await fixture();
    const block = await createBlock("Live");
    const draft = generateUuidv7();
    await editTitle(block.id, "Draft", startingDraft(draft));

    chat.mockResolvedValueOnce("Draft summary");
    await runJob(block.id, draft);

    expect(await summaryIn(block.id, inDraft(draft))).toBe("Draft summary");
    expect(await summaryIn(block.id)).toBe("");
  });

  it("doesn't copy a block the draft hasn't changed", async () => {
    const { createBlock, editTitle, titleIn, summaryIn, runJob } = await fixture();
    const changed = await createBlock("Changed");
    const untouched = await createBlock("Untouched");
    const draft = generateUuidv7();
    await editTitle(changed.id, "Draft", startingDraft(draft));

    chat.mockResolvedValue("Summary");
    await runJob(untouched.id, draft);
    await editTitle(untouched.id, "Live later");

    // A copy would have frozen the draft's view of the block at its old content.
    expect(await titleIn(untouched.id, inDraft(draft))).toBe("Live later");
    expect(await summaryIn(untouched.id)).toBe("");
  });

  it("does nothing once its draft is gone", async () => {
    const { db, createBlock, editTitle, summaryIn, runJob } = await fixture();
    const block = await createBlock("Live");
    const draft = generateUuidv7();
    await editTitle(block.id, "Draft", startingDraft(draft));
    await db.delete(drafts).where(eq(drafts.id, draft));

    await runJob(block.id, draft);

    expect(chat).not.toHaveBeenCalled();
    expect(await summaryIn(block.id)).toBe("");
  });
});
