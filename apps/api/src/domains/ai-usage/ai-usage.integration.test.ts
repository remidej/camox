import { DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  syncDefinitionSet,
} from "../../../test/fixtures";
import { answerNext, modelAttributions } from "../../../test/generation";
import { writeUsageRecord } from "../../lib/ai-usage";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import { runOverviewJob } from "../drafts/overview-job";
import { runGenerationJob } from "../generated-values/generation";
import { type AiUsageRecord, aiUsageRecords } from "./schema";

// AI usage records: what every AI call cost, and who it was for (ADR 0031). The model records a
// call's cost (`metered-chat.test.ts`); here, what the code asking for the work tells it.

type Headers = Record<string, string>;
const startingDraft = (id: string) => ({ [DRAFT_HEADER]: id, [DRAFT_CREATE_HEADER]: "1" });
const inDraft = (id: string) => ({ [DRAFT_HEADER]: id });

/** A project with a page holding a block on Live. */
async function fixture() {
  const base = await createProjectFixture(`ai-usage-${crypto.randomUUID()}`);
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
  const projectId = base.project.id;
  const member = (headers: Headers = {}) => ({
    context: createRpcContext(base.db, base.memberUser, headers),
  });
  const { page } = await callSeedingLive(
    router.pages.create,
    { projectId, pathSegment: "pricing", layoutId: base.layout.layoutId },
    member(),
  );
  const block = await callSeedingLive(
    router.blocks.create,
    { pageId: page.id, type: "hero", content: { title: "Live" } },
    member(),
  );
  /** Starts a draft by editing the block in it. */
  const startDraft = async () => {
    const draft = generateUuidv7();
    await callSeedingLive(
      router.blocks.updateContent,
      { id: block.id, content: { title: "Mine" } },
      member(startingDraft(draft)),
    );
    return draft;
  };
  /** Who the calls to the model's `method` were attributed to. */
  const attributed = (method: string) =>
    modelAttributions()
      .filter((call) => call.method === method)
      .map(({ attribution }) => attribution);
  const camox = {
    organizationId: base.project.organizationId,
    projectId,
    initiator: "camox",
  };
  return { ...base, projectId, member, page, block, startDraft, attributed, camox };
}

describe("an AI call's attribution", () => {
  it("names the SEO manager writing a page's SEO in a draft", async () => {
    const { db, page, startDraft, attributed, camox } = await fixture();
    const draft = await startDraft();

    answerNext("pageSeo", { metaTitle: "Pricing", metaDescription: "Our plans" });
    await runService(runGenerationJob(db, { entity: "page", entityId: page.id, draftId: draft }));

    expect(attributed("pageSeo")).toEqual([{ ...camox, draftId: draft, patroller: "seoManager" }]);
  });

  it("names Camox alone summarizing a block on Live, found from the block", async () => {
    const { db, block, attributed, camox } = await fixture();

    answerNext("summarize", "Hero");
    await runService(runGenerationJob(db, { entity: "block", entityId: block.id, draftId: null }));

    expect(attributed("summarize")).toEqual([{ ...camox, draftId: null, patroller: null }]);
  });

  it("names Camox alone writing a draft's overview", async () => {
    const { db, startDraft, attributed, camox } = await fixture();
    const draft = await startDraft();

    answerNext("draftOverview", { headline: "Retitles the hero", bullets: ["Hero retitled"] });
    await runService(runOverviewJob(db, { kind: "overview", draftId: draft }));

    expect(attributed("draftOverview")).toEqual([{ ...camox, draftId: draft, patroller: null }]);
  });

  it("names the member asking for a page's SEO now", async () => {
    const { page, member, memberUser, startDraft, attributed, camox } = await fixture();
    const draft = await startDraft();

    answerNext("pageSeo", { metaTitle: "Pricing", metaDescription: "Our plans" });
    await call(router.pages.generateSeo, { id: page.id }, member(inDraft(draft)));

    expect(attributed("pageSeo")).toEqual([
      { ...camox, draftId: draft, initiator: "member", memberId: memberUser.id },
    ]);
  });
});

describe("recording a call", () => {
  const record = (key: string): AiUsageRecord => ({
    key,
    organizationId: null,
    projectId: null,
    draftId: null,
    initiator: "camox",
    purpose: "summary",
    model: "google/gemini-3.1-flash-lite",
    costMicroUsd: 42,
    costSource: "billed",
    status: "ok",
    createdAt: Date.now(),
  });

  it("stores a call recorded again once, as when a replay records it twice", async () => {
    const { db } = await fixture();
    const key = `gen-${crypto.randomUUID()}`;

    await Effect.runPromise(writeUsageRecord(db, record(key)));
    await Effect.runPromise(writeUsageRecord(db, { ...record(key), costMicroUsd: 99 }));

    const stored = await db.select().from(aiUsageRecords).where(eq(aiUsageRecords.key, key));
    expect(stored).toEqual([expect.objectContaining({ key, costMicroUsd: 42 })]);
  });
});
