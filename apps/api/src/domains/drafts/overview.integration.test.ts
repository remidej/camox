import { DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { queryKeys } from "@camox/api-contract/query-keys";
import { call } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  runChecks,
  syncDefinitionSet,
} from "../../../test/fixtures";
import { answerNext, modelCalls, scheduledFor, scheduledOverviews } from "../../../test/generation";
import { forgetSent, refreshes, sentTo } from "../../../test/project-rooms";
import type { Database } from "../../db";
import type { DraftOverview } from "../../lib/ai-model";
import { Journal } from "../../lib/journal";
import { AiCallError } from "../../lib/retry-ai-call";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import { blocks, pages } from "../../schema";
import { runGenerationJob } from "../generated-values/generation";
import { openCatchUpDraft } from "./catch-up";
import { runOverviewJob } from "./overview-job";
import { drafts } from "./schema";

// The Draft Overview: a headline and bullets AI writes about a draft's changes, stored on the
// draft, shown at the top of its review, and never published. Writing it names the draft.

type Headers = Record<string, string>;
const startingDraft = (id: string) => ({ [DRAFT_HEADER]: id, [DRAFT_CREATE_HEADER]: "1" });
const inDraft = (id: string) => ({ [DRAFT_HEADER]: id });

async function fixture() {
  const base = await createProjectFixture(`overview-${crypto.randomUUID()}`);
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
  const projectId = base.project.id;
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
  const preview = (draftId: string) =>
    call(router.drafts.previewPublish, { projectId }, member(inDraft(draftId)));
  const overviewJobs = scheduledOverviews;
  /** Runs a draft's overview job, the model answering `answer` when asked. */
  const runOverview = (draftId: string, answer?: DraftOverview | AiCallError) => {
    if (answer !== undefined) answerNext("draftOverview", answer);
    return runService(runOverviewJob(base.db, { kind: "overview", draftId }));
  };
  return {
    ...base,
    page,
    projectId,
    member,
    createBlock,
    editTitle,
    preview,
    overviewJobs,
    runOverview,
  };
}

/** Names a draft for the request it was started for, as a Live thread's hand-off does. */
const startedFor = (db: Database, draftId: string, name: string, openingRequest: string) =>
  db.update(drafts).set({ name, openingRequest }).where(eq(drafts.id, draftId));

describe("a draft's overview", () => {
  it("is none while the draft is empty, and pending with a job requested once it changes", async () => {
    const { projectId, member, createBlock, editTitle, preview, overviewJobs } = await fixture();
    const block = await createBlock("Live");
    const { id: draft } = await call(router.drafts.create, { projectId }, member());

    expect((await preview(draft)).overview).toEqual({ status: "none" });
    expect(overviewJobs(draft)).toEqual([]);

    await editTitle(block.id, "Mine", inDraft(draft));

    expect((await preview(draft)).overview).toEqual({ status: "pending" });
    expect(overviewJobs(draft)).toHaveLength(1);
  });

  it("is failed once the model gave up, and Retry requests it again right away", async () => {
    const { projectId, member, createBlock, editTitle, preview, overviewJobs, runOverview } =
      await fixture();
    const block = await createBlock("Live");
    const draft = generateUuidv7();
    await editTitle(block.id, "Mine", startingDraft(draft));

    await runOverview(draft, new AiCallError({ cause: "Model unavailable" }));
    expect((await preview(draft)).overview).toEqual({ status: "failed" });

    await call(router.drafts.retryOverview, { projectId }, member(inDraft(draft)));

    expect((await preview(draft)).overview).toEqual({ status: "pending" });
    expect(overviewJobs(draft).at(-1)).toMatchObject({ delayMs: 0 });
  });

  it("waits for more edits longer than the page's SEO does, so summaries settle first", async () => {
    const { db, page, createBlock, editTitle, overviewJobs } = await fixture();
    const block = await createBlock("Live");
    const draft = generateUuidv7();
    await editTitle(block.id, "Mine", startingDraft(draft));
    answerNext("summarize", "Hero");
    await runService(runGenerationJob(db, { entity: "block", entityId: block.id, draftId: draft }));

    const [seo] = scheduledFor(page.id);
    expect(seo).toBeDefined();
    expect(overviewJobs(draft).at(-1)!.delayMs).toBeGreaterThan(seo!.delayMs);
  });

  it("is ready once its job ran, with the model's headline and bullets, written from the draft's name, request and changes", async () => {
    const { db, createBlock, editTitle, preview, runOverview } = await fixture();
    const block = await createBlock("Live");
    const draft = generateUuidv7();
    await editTitle(block.id, "Mine", startingDraft(draft));
    await startedFor(db, draft, "Spring", "Make the hero say it's spring");

    await runOverview(draft, {
      nameVerdict: "fits",
      name: "New hero title",
      headline: "Retitles the homepage hero",
      bullets: ["Home: hero retitled"],
    });

    expect((await preview(draft)).overview).toEqual({
      status: "ready",
      headline: "Retitles the homepage hero",
      bullets: ["Home: hero retitled"],
      stale: false,
    });
    const asked = modelCalls().filter((call) => call.method === "draftOverview");
    expect(asked).toEqual([
      {
        method: "draftOverview",
        request: {
          draftName: "Spring",
          openingRequest: "Make the hero say it's spring",
          changes: [
            {
              place: "Home (/)",
              label: "Hero",
              change: "changed",
              fields: [{ field: "title", before: "Live", after: "Mine" }],
            },
          ],
          localeEdits: [],
        },
      },
    ]);
  });
});

describe("the overview names its draft", () => {
  async function changedDraft() {
    const f = await fixture();
    const block = await f.createBlock("Live");
    const draft = generateUuidv7();
    await f.editTitle(block.id, "Mine", startingDraft(draft));
    const name = async () =>
      (await f.db.select({ name: drafts.name }).from(drafts).where(eq(drafts.id, draft)).get())!
        .name;
    const listed = async () =>
      (await call(router.drafts.list, { projectId: f.projectId }, f.member())).drafts.map(
        (listed) => listed.name,
      );
    const overview = (nameVerdict: DraftOverview["nameVerdict"], name: string) =>
      f.runOverview(draft, { nameVerdict, name, headline: "Retitles the hero", bullets: [] });
    return { ...f, draft, name, listed, overview };
  }

  it("names a draft started without a name, whatever the model's verdict", async () => {
    const { name, listed, overview } = await changedDraft();

    await overview("fits", " Hero title ");

    expect(await name()).toBe("Hero title");
    expect(await listed()).toEqual(["Hero title"]);
  });

  it("keeps a name the model finds still fits", async () => {
    const { db, draft, name, overview } = await changedDraft();
    await startedFor(db, draft, "Spring", "Make the hero say it's spring");

    await overview("fits", "Spring hero");

    expect(await name()).toBe("Spring");
  });

  it("renames the draft once the model finds its name obsolete, for every member", async () => {
    const { db, projectId, draft, name, listed, overview } = await changedDraft();
    await startedFor(db, draft, "Spring", "Make the hero say it's spring");
    forgetSent(projectId);

    await overview("obsolete", "Hero title");

    expect(await name()).toBe("Hero title");
    expect(await listed()).toEqual(["Hero title"]);
    expect(refreshes(sentTo(projectId), null, [...queryKeys.drafts.list, projectId])).toBe(true);
  });

  it("keeps the name of a draft Camox opened", async () => {
    const { db, draft, name, overview } = await changedDraft();
    await db.update(drafts).set({ name: "Patrol", purpose: "patrol" }).where(eq(drafts.id, draft));

    await overview("obsolete", "Hero title");

    expect(await name()).toBe("Patrol");
  });
});

describe("the overview stays current", () => {
  async function readyOverview() {
    const f = await fixture();
    const block = await f.createBlock("Live");
    const draft = generateUuidv7();
    await f.editTitle(block.id, "Mine", startingDraft(draft));
    await f.runOverview(draft, {
      nameVerdict: "fits",
      name: "Hero title",
      headline: "Retitles the hero",
      bullets: ["Home: hero retitled"],
    });
    return { ...f, block, draft };
  }

  it("is stale after a further change, still carrying the previous headline and bullets", async () => {
    const { block, draft, editTitle, preview } = await readyOverview();

    await editTitle(block.id, "Mine again", inDraft(draft));

    expect((await preview(draft)).overview).toEqual({
      status: "ready",
      headline: "Retitles the hero",
      bullets: ["Home: hero retitled"],
      stale: true,
    });
  });

  it("is requested right away when a stale preview is read, once", async () => {
    const { block, draft, editTitle, preview, overviewJobs } = await readyOverview();
    await editTitle(block.id, "Mine again", inDraft(draft));
    expect(overviewJobs(draft).at(-1)!.delayMs).toBeGreaterThan(0);

    await preview(draft);

    expect(overviewJobs(draft).at(-1)).toMatchObject({ delayMs: 0 });
    const requested = overviewJobs(draft).length;
    await preview(draft);
    expect(overviewJobs(draft)).toHaveLength(requested);
  });

  it("is requested right away when the preview of a draft whose overview was never requested is read", async () => {
    const { db, createBlock, editTitle, preview, overviewJobs } = await fixture();
    const block = await createBlock("Live");
    const draft = generateUuidv7();
    await editTitle(block.id, "Mine", startingDraft(draft));
    // As for a draft changed before overviews existed.
    await db
      .update(drafts)
      .set({ overviewRequestedAt: null, overviewDueAt: null })
      .where(eq(drafts.id, draft));
    const requested = overviewJobs(draft).length;

    expect((await preview(draft)).overview).toEqual({ status: "pending" });

    expect(overviewJobs(draft)).toHaveLength(requested + 1);
    expect(overviewJobs(draft).at(-1)).toMatchObject({ delayMs: 0 });
  });

  it("is requested again when read stale after its due job ran, once", async () => {
    const { db, block, draft, editTitle, preview, runOverview, overviewJobs } =
      await readyOverview();
    await editTitle(block.id, "Mine again", inDraft(draft));
    await preview(draft);
    await runOverview(draft, {
      nameVerdict: "fits",
      name: "Hero title",
      headline: "Retitles the hero twice",
      bullets: ["Home: hero"],
    });
    // A write that requests no overview, as a translation job merging into the draft's
    // hand-edited localizations does.
    await db
      .update(blocks)
      .set({ updatedAt: Date.now() + 1 })
      .where(and(eq(blocks.id, block.id), eq(blocks.draftId, draft)));
    const requested = overviewJobs(draft).length;

    expect((await preview(draft)).overview).toMatchObject({ status: "ready", stale: true });

    expect(overviewJobs(draft)).toHaveLength(requested + 1);
    expect(overviewJobs(draft).at(-1)).toMatchObject({ delayMs: 0 });
    await preview(draft);
    expect(overviewJobs(draft)).toHaveLength(requested + 1);
  });

  it("is ready and current again once the new job ran", async () => {
    const { block, draft, editTitle, preview, runOverview } = await readyOverview();
    await editTitle(block.id, "Mine again", inDraft(draft));
    await preview(draft);

    await runOverview(draft, {
      nameVerdict: "fits",
      name: "Hero title, again",
      headline: "Retitles the hero twice",
      bullets: ["Home: hero"],
    });

    expect((await preview(draft)).overview).toEqual({
      status: "ready",
      headline: "Retitles the hero twice",
      bullets: ["Home: hero"],
      stale: false,
    });
  });
});

describe("drafts no one reviews get no overview", () => {
  it("requests none for a catch-up draft, whose preview has none", async () => {
    const { db, projectId, createBlock, editTitle, preview, overviewJobs } = await fixture();
    const block = await createBlock("Live");
    const catchUp = await Effect.runPromise(
      openCatchUpDraft(db, projectId).pipe(Effect.provideService(Journal, { changes: [] })),
    );

    await editTitle(block.id, "Translated", inDraft(catchUp.id));

    expect(overviewJobs(catchUp.id)).toEqual([]);
    expect((await preview(catchUp.id)).overview).toEqual({ status: "none" });
  });

  it("does nothing in a job whose draft ended", async () => {
    const { projectId, member, createBlock, editTitle, runOverview } = await fixture();
    const block = await createBlock("Live");
    const draft = generateUuidv7();
    await editTitle(block.id, "Mine", startingDraft(draft));
    await call(router.drafts.delete, { projectId }, member(inDraft(draft)));

    await runOverview(draft, {
      nameVerdict: "fits",
      name: "Too late",
      headline: "Too late",
      bullets: [],
    });

    expect(modelCalls().filter((call) => call.method === "draftOverview")).toEqual([]);
  });
});

describe("the overview isn't content", () => {
  it("is never listed as a change or a conflict, and publishing leaves Live as the draft's content", async () => {
    const { db, projectId, member, createBlock, editTitle, preview, runOverview } = await fixture();
    const block = await createBlock("Live");
    const draft = generateUuidv7();
    await editTitle(block.id, "Mine", startingDraft(draft));
    const before = await preview(draft);

    await runOverview(draft, {
      nameVerdict: "fits",
      name: "Hero title",
      headline: "Retitles the hero",
      bullets: ["Home: hero retitled"],
    });

    const after = await preview(draft);
    expect(after.changes).toEqual(before.changes);
    expect(after.conflicts).toEqual([]);
    expect(after.token).toEqual(before.token);
    await runChecks(db, draft);
    await call(router.drafts.publish, { projectId, token: after.token }, member(inDraft(draft)));
    const live = await call(router.blocks.get, { id: block.id }, member());
    expect(live.block.content).toEqual({ title: "Mine" });
  });
});
