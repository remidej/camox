import { DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  createServiceContext,
} from "../../../test/fixtures";
import {
  answerNext,
  failNextSchedule,
  forgetScheduled,
  modelCalls,
  scheduledFor,
} from "../../../test/generation";
import type { GenerationJob } from "../../lib/generation-scheduler";
import { AiCallError } from "../../lib/retry-ai-call";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import { generatedValues, pages } from "../../schema";
import { upsertBlockDefinition } from "../block-definitions/service";
import { runGenerationJob } from "./generation";

type Headers = Record<string, string>;
const startingDraft = (id: string) => ({ [DRAFT_HEADER]: id, [DRAFT_CREATE_HEADER]: "1" });
const inDraft = (id: string) => ({ [DRAFT_HEADER]: id });

async function fixture() {
  const base = await createProjectFixture(`generation-${crypto.randomUUID()}`);
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
          links: {
            fieldType: "Repeater",
            type: "array",
            items: {
              type: "object",
              properties: { label: { fieldType: "String", type: "string" } },
            },
          },
        },
        toMarkdown: ["# {{title}}"],
      },
    }),
  );
  const now = Date.now();
  const page = await base.db
    .insert(pages)
    .values({
      projectId: base.project.id,
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
  const member = (headers: Headers = {}) => ({
    context: createRpcContext(base.db, base.memberUser, headers),
  });
  const createBlock = (title: string, headers: Headers = {}) =>
    callSeedingLive(
      router.blocks.create,
      { pageId: page.id, type: "hero", content: { title } },
      member(headers),
    );
  const editTitle = (id: string, title: string, headers: Headers = {}) =>
    callSeedingLive(router.blocks.updateContent, { id, content: { title } }, member(headers));
  const addItem = (blockId: string, label: string, headers: Headers = {}) =>
    callSeedingLive(
      router.repeatableItems.create,
      { blockId, fieldName: "links", content: { label } },
      member(headers),
    );
  const setSeo = (input: { id: string; metaTitle?: string }, headers: Headers = {}) =>
    callSeedingLive(router.pages.setSeo, input, member(headers));
  const summaryIn = async (id: string, headers: Headers = {}) =>
    (await call(router.blocks.get, { id }, member(headers))).block.summary;
  /** Runs a scheduled job, the model answering `answer` when asked. */
  const run = (job: GenerationJob, answer?: string | AiCallError) => {
    if (answer !== undefined) answerNext("summarize", answer);
    return runService(runGenerationJob(base.db, job));
  };
  /** Whether an entity's value is pending in a draft. */
  const pending = async (entityId: string, draftId: string) => {
    const row = await base.db
      .select({ requestedAt: generatedValues.requestedAt })
      .from(generatedValues)
      .where(and(eq(generatedValues.entityId, entityId), eq(generatedValues.draftId, draftId)))
      .get();
    return row?.requestedAt != null;
  };
  return { ...base, page, createBlock, editTitle, addItem, setSeo, summaryIn, run, pending };
}

describe("a new value makes its parent's stale", () => {
  it("an item's summary requests its block's, whose summary requests its page's SEO, in the item's draft", async () => {
    const { page, createBlock, addItem, run } = await fixture();
    const block = await createBlock("Hero");
    const draft = generateUuidv7();
    const item = await addItem(block.id, "Docs", startingDraft(draft));
    forgetScheduled(block.id, page.id);

    await run({ entity: "repeatableItem", entityId: item.id, draftId: draft }, "Docs link");
    expect(scheduledFor(block.id, page.id)).toEqual([
      expect.objectContaining({ entity: "block", entityId: block.id, draftId: draft }),
    ]);

    await run({ entity: "block", entityId: block.id, draftId: draft }, "Hero with docs");
    expect(scheduledFor(page.id)).toEqual([
      expect.objectContaining({ entity: "page", entityId: page.id, draftId: draft }),
    ]);
  });

  it("an unchanged summary requests nothing above it", async () => {
    const { page, createBlock, run } = await fixture();
    const block = await createBlock("Hero");
    await run({ entity: "block", entityId: block.id, draftId: null }, "Hero");
    forgetScheduled(page.id);

    await run({ entity: "block", entityId: block.id, draftId: null }, "Hero");

    expect(scheduledFor(page.id)).toEqual([]);
  });

  it("a page whose SEO is manual isn't requested when its block's summary changes", async () => {
    const { page, createBlock, setSeo, run } = await fixture();
    await setSeo({ id: page.id, metaTitle: "Home" });
    const block = await createBlock("Hero");
    forgetScheduled(page.id);

    await run({ entity: "block", entityId: block.id, draftId: null }, "Hero");

    expect(scheduledFor(page.id)).toEqual([]);
  });
});

describe("requesting a value", () => {
  it("generates new content right away, and waits for more edits after an edit", async () => {
    const { createBlock, editTitle } = await fixture();
    const draft = generateUuidv7();
    const block = await createBlock("Hero", startingDraft(draft));
    await editTitle(block.id, "Hero, edited", inDraft(draft));

    const [created, edited] = scheduledFor(block.id);
    expect(created!.delayMs).toBe(0);
    expect(edited!.delayMs).toBeGreaterThan(0);
  });

  it("leaves nothing pending when the job can't be scheduled, and the write still succeeds", async () => {
    const { createBlock, editTitle, pending, summaryIn } = await fixture();
    const block = await createBlock("Hero");
    const draft = generateUuidv7();
    forgetScheduled(block.id);
    failNextSchedule();

    await editTitle(block.id, "Hero, edited", startingDraft(draft));

    expect(scheduledFor(block.id)).toEqual([]);
    expect(await pending(block.id, draft)).toBe(false);
    expect(await summaryIn(block.id, inDraft(draft))).toBe("");
  });
});

describe("a job whose model gives up", () => {
  it("stops showing as pending and keeps the value it had, without failing", async () => {
    const { createBlock, editTitle, run, pending, summaryIn } = await fixture();
    const block = await createBlock("Hero");
    const draft = generateUuidv7();
    await editTitle(block.id, "Hero, edited", startingDraft(draft));
    await run({ entity: "block", entityId: block.id, draftId: draft }, "Edited hero");
    await editTitle(block.id, "Hero, edited again", inDraft(draft));
    expect(await pending(block.id, draft)).toBe(true);

    await run(
      { entity: "block", entityId: block.id, draftId: draft },
      new AiCallError({ cause: "OpenRouter 503" }),
    );

    expect(modelCalls().map(({ method }) => method)).toEqual(["summarize", "summarize"]);
    expect(await pending(block.id, draft)).toBe(false);
    expect(await summaryIn(block.id, inDraft(draft))).toBe("Edited hero");
  });
});
