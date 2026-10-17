import { DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { inArray, isNull, and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createProjectFixture,
  createRpcContext,
  createServiceContext,
  callSeedingLive,
} from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import { drafts, generatedValues, pages } from "../../schema";
import { upsertBlockDefinition } from "../block-definitions/service";
import { runBlockSummaryJob } from "../blocks/service";
import { runPageSeoJob } from "../pages/ai";

const { chat, scheduleAiJob, broadcastInvalidation, broadcastDraftEnded } = vi.hoisted(() => {
  vi.resetModules();
  return {
    chat: vi.fn(),
    scheduleAiJob: vi.fn().mockResolvedValue(undefined),
    broadcastInvalidation: vi.fn(),
    broadcastDraftEnded: vi.fn(),
  };
});
vi.mock("@tanstack/ai", () => ({ chat }));
vi.mock("../../lib/schedule-ai-job", () => ({ scheduleAiJob }));
vi.mock("../../lib/broadcast-invalidation", () => ({ broadcastInvalidation, broadcastDraftEnded }));

afterEach(() => {
  vi.clearAllMocks();
  chat.mockReset();
});

const startingDraft = (id: string) => ({ [DRAFT_HEADER]: id, [DRAFT_CREATE_HEADER]: "1" });
const inDraft = (id: string) => ({ [DRAFT_HEADER]: id });

async function fixture() {
  const base = await createProjectFixture(`generated-values-${crypto.randomUUID()}`);
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
  const projectId = base.project.id;
  const member = (headers: Record<string, string> = {}) => ({
    context: createRpcContext(base.db, base.memberUser, headers),
  });
  const createBlock = (title: string, headers: Record<string, string> = {}) =>
    callSeedingLive(
      router.blocks.create,
      { pageId: page.id, type: "hero", content: { title } },
      member(headers),
    );
  const editTitle = (id: string, title: string, headers: Record<string, string> = {}) =>
    callSeedingLive(router.blocks.updateContent, { id, content: { title } }, member(headers));
  const summaryIn = async (id: string, headers: Record<string, string> = {}) =>
    (await call(router.blocks.get, { id }, member(headers))).block.summary;
  const titleIn = async (id: string, headers: Record<string, string> = {}) =>
    (await call(router.blocks.get, { id }, member(headers))).block.content.title;
  const summarize = (entityId: string, draftId: string | null, summary: string) => {
    chat.mockResolvedValueOnce(summary);
    return runService(runBlockSummaryJob(base.db, "key", { entityId, draftId }));
  };
  const generateSeo = (
    entityId: string,
    draftId: string | null,
    seo: { metaTitle: string; metaDescription: string },
  ) => {
    chat.mockResolvedValueOnce(seo);
    return runService(runPageSeoJob(base.db, "key", { entityId, draftId }));
  };
  const pageIn = (id: string, headers: Record<string, string> = {}) =>
    call(router.pages.get, { id }, member(headers));
  const setSeo = (
    input: { id: string; metaTitle?: string; metaDescription?: string; aiSeo?: boolean },
    headers: Record<string, string> = {},
  ) => callSeedingLive(router.pages.setSeo, input, member(headers));
  const createPage = (pathSegment: string, headers: Record<string, string>) =>
    callSeedingLive(
      router.pages.create,
      { projectId, pathSegment, layoutId: base.layout.layoutId },
      member(headers),
    );
  const changeCount = async (draftId: string) =>
    (await call(router.drafts.get, { projectId }, member(inDraft(draftId)))).changeCount;
  const preview = (draftId: string) =>
    call(router.drafts.previewPublish, { projectId }, member(inDraft(draftId)));
  const publish = async (draftId: string) =>
    call(
      router.drafts.publish,
      { projectId, token: (await preview(draftId)).token },
      member(inDraft(draftId)),
    );
  const scheduled = () => scheduleAiJob.mock.calls.map(([, job]) => job);

  return {
    ...base,
    page,
    member,
    createBlock,
    editTitle,
    summaryIn,
    titleIn,
    summarize,
    generateSeo,
    pageIn,
    setSeo,
    createPage,
    changeCount,
    preview,
    publish,
    scheduled,
  };
}

describe("summaries in drafts", () => {
  it("are requested in the draft a block was edited in, and on Live once it's published", async () => {
    const { createBlock, editTitle, publish, scheduled } = await fixture();
    const block = await createBlock("Live");
    const draft = generateUuidv7();
    const published = generateUuidv7();
    scheduleAiJob.mockClear();

    await editTitle(block.id, "Draft", startingDraft(draft));
    await editTitle(block.id, "Live again", startingDraft(published));
    await publish(published);

    expect(scheduled().filter((job) => job.entityTable === "blocks")).toEqual([
      expect.objectContaining({ entityId: block.id, draftId: draft }),
      expect.objectContaining({ entityId: block.id, draftId: published }),
      expect.objectContaining({ entityId: block.id, draftId: null }),
    ]);
  });

  it("are the draft's own: Live keeps its summary, and nothing is copied, counted or conflicting", async () => {
    const { createBlock, editTitle, summaryIn, titleIn, summarize, changeCount, preview } =
      await fixture();
    const changed = await createBlock("Changed");
    const untouched = await createBlock("Untouched");
    await summarize(untouched.id, null, "Live summary");
    const draft = generateUuidv7();
    await editTitle(changed.id, "Draft", startingDraft(draft));

    await summarize(untouched.id, draft, "Draft summary");
    await editTitle(untouched.id, "Live later");

    expect(await summaryIn(untouched.id, inDraft(draft))).toBe("Draft summary");
    expect(await summaryIn(untouched.id)).toBe("Live summary");
    // A copy would have frozen the draft's view of the block at its old content.
    expect(await titleIn(untouched.id, inDraft(draft))).toBe("Live later");
    expect(await changeCount(draft)).toBe(1);
    expect((await preview(draft)).conflicts).toEqual([]);
  });

  it("fall back to Live's where the draft generated none", async () => {
    const { createBlock, editTitle, summaryIn, summarize } = await fixture();
    const block = await createBlock("Live");
    await summarize(block.id, null, "Live summary");
    const draft = generateUuidv7();

    await editTitle(block.id, "Draft", startingDraft(draft));

    expect(await summaryIn(block.id, inDraft(draft))).toBe("Live summary");
  });

  it("aren't generated once their draft is gone", async () => {
    const { db, createBlock, editTitle, summaryIn, summarize } = await fixture();
    const block = await createBlock("Live");
    const draft = generateUuidv7();
    await editTitle(block.id, "Draft", startingDraft(draft));
    await db.delete(drafts).where(eq(drafts.id, draft));

    await summarize(block.id, draft, "Too late");

    expect(chat).not.toHaveBeenCalled();
    expect(await summaryIn(block.id)).toBe("");
  });
});

describe("publishing generated values", () => {
  it("copies the draft's values over Live's and requests Live's for what changed and its page", async () => {
    const { page, createBlock, editTitle, summaryIn, summarize, setSeo, publish, scheduled } =
      await fixture();
    await setSeo({ id: page.id, metaTitle: "Home", metaDescription: "Welcome" });
    const block = await createBlock("Live");
    await summarize(block.id, null, "Live summary");
    const draft = generateUuidv7();
    await editTitle(block.id, "Draft", startingDraft(draft));
    await summarize(block.id, draft, "Draft summary");
    scheduleAiJob.mockClear();

    await publish(draft);

    expect(await summaryIn(block.id)).toBe("Draft summary");
    expect(scheduled()).toEqual([
      expect.objectContaining({ entityTable: "blocks", entityId: block.id, draftId: null }),
    ]);
  });

  it("requests a changed block's page SEO on Live when it's generated", async () => {
    const { page, createBlock, editTitle, generateSeo, publish, scheduled } = await fixture();
    const block = await createBlock("Live");
    await generateSeo(page.id, null, { metaTitle: "Home", metaDescription: "Welcome" });
    const draft = generateUuidv7();
    await editTitle(block.id, "Draft", startingDraft(draft));
    scheduleAiJob.mockClear();

    await publish(draft);

    expect(scheduled()).toEqual([
      expect.objectContaining({ entityTable: "blocks", entityId: block.id, draftId: null }),
      expect.objectContaining({ entityTable: "pages", entityId: page.id, draftId: null }),
    ]);
  });
  it("drops Live's values of what the draft deletes and of the descendants deleted with it", async () => {
    const { db, member, createPage, summarize, generateSeo, publish } = await fixture();
    const { page: about } = await createPage("about", {});
    const block = await callSeedingLive(
      router.blocks.create,
      { pageId: about.id, type: "hero", content: { title: "On about" } },
      member(),
    );
    await summarize(block.id, null, "Live summary");
    await generateSeo(about.id, null, { metaTitle: "About", metaDescription: "About us" });
    const draft = generateUuidv7();
    await call(router.pages.delete, { id: about.id }, member(startingDraft(draft)));

    await publish(draft);

    expect(await liveValuesOf(db, [about.id, block.id])).toEqual([]);
  });

  it("copies no value of a change dropped as lost", async () => {
    const { db, member, createPage, editTitle, summarize, publish } = await fixture();
    const { page: about } = await createPage("about", {});
    const block = await callSeedingLive(
      router.blocks.create,
      { pageId: about.id, type: "hero", content: { title: "On about" } },
      member(),
    );
    const draft = generateUuidv7();
    await editTitle(block.id, "Mine", startingDraft(draft));
    await summarize(block.id, draft, "Draft summary");
    const other = generateUuidv7();
    await call(router.pages.delete, { id: about.id }, member(startingDraft(other)));
    await publish(other);
    expect((await publish(draft)).ended).toMatchObject({ outcome: "published" });

    expect(await liveValuesOf(db, [block.id])).toEqual([]);
  });
});

/** Live's generated values of entities, whatever entity they describe. */
const liveValuesOf = (db: Awaited<ReturnType<typeof fixture>>["db"], ids: string[]) =>
  db
    .select({ entity: generatedValues.entity, entityId: generatedValues.entityId })
    .from(generatedValues)
    .where(and(isNull(generatedValues.draftId), inArray(generatedValues.entityId, ids)));

describe("a page's SEO group", () => {
  it("becomes manual when one field is written, keeping the generated value of the other", async () => {
    const { page, generateSeo, pageIn, setSeo } = await fixture();
    await generateSeo(page.id, null, { metaTitle: "Generated", metaDescription: "Generated text" });
    const draft = generateUuidv7();

    await setSeo({ id: page.id, metaDescription: "Manual text" }, startingDraft(draft));
    await generateSeo(page.id, draft, { metaTitle: "Regenerated", metaDescription: "Ignored" });

    expect(await pageIn(page.id, inDraft(draft))).toMatchObject({
      metaTitle: "Generated",
      metaDescription: "Manual text",
      aiSeo: false,
    });
    expect(chat).toHaveBeenCalledOnce();
  });

  it("shows the generated values again once made generated", async () => {
    const { page, generateSeo, pageIn, setSeo, scheduled } = await fixture();
    await generateSeo(page.id, null, { metaTitle: "Generated", metaDescription: "Generated text" });
    const draft = generateUuidv7();
    await setSeo({ id: page.id, metaTitle: "Manual" }, startingDraft(draft));

    await setSeo({ id: page.id, aiSeo: true }, inDraft(draft));

    expect(await pageIn(page.id, inDraft(draft))).toMatchObject({
      metaTitle: "Generated",
      metaDescription: "Generated text",
      aiSeo: true,
    });
    expect(scheduled()).toEqual([
      expect.objectContaining({ entityTable: "pages", entityId: page.id, draftId: draft }),
    ]);
  });
});

describe("the meta title blocker", () => {
  it("warns while a new page's SEO is being generated", async () => {
    const { createPage, preview } = await fixture();
    const draft = generateUuidv7();

    const { page } = await createPage("about", startingDraft(draft));

    const { blockers, warnings } = await preview(draft);
    expect(blockers).toEqual([]);
    expect(warnings).toEqual([
      expect.objectContaining({ entity: "page", id: page.id, code: "metaTitlePending" }),
    ]);
  });

  it("blocks a page whose generation produced no meta title", async () => {
    const { createPage, generateSeo, preview } = await fixture();
    const draft = generateUuidv7();
    const { page } = await createPage("about", startingDraft(draft));

    await generateSeo(page.id, draft, { metaTitle: "", metaDescription: "" });

    expect((await preview(draft)).blockers).toEqual([
      expect.objectContaining({ entity: "page", id: page.id, code: "missingMetaTitle" }),
    ]);
  });

  it("blocks a page with an empty manual meta title, until one is written", async () => {
    const { createPage, setSeo, preview } = await fixture();
    const draft = generateUuidv7();
    const { page } = await createPage("about", startingDraft(draft));

    await setSeo({ id: page.id, metaTitle: " " }, inDraft(draft));
    expect((await preview(draft)).blockers).toEqual([
      expect.objectContaining({ entity: "page", id: page.id, code: "missingMetaTitle" }),
    ]);

    await setSeo({ id: page.id, metaTitle: "About us" }, inDraft(draft));
    expect(await preview(draft)).toMatchObject({ blockers: [], warnings: [] });
  });
});
