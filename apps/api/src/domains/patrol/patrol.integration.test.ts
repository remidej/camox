import { DRAFT_CREATE_HEADER, DRAFT_HEADER, LOCALE_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { REPORTS_SHOWN, type PatrollerView } from "@camox/api-contract/patrol";
import { queryKeys } from "@camox/api-contract/query-keys";
import { call } from "@orpc/server";
import { describe, expect, it } from "vite-plus/test";

import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  reviewed,
  runAllChecks,
  seedLive,
  syncDefinitionSet,
} from "../../../test/fixtures";
import { answerEvery, answerNext, forgetScheduled, scheduled } from "../../../test/generation";
import { forgetSent, refreshes, sentTo } from "../../../test/project-rooms";
import { type GenerationJob, isTranslationJob } from "../../lib/ai-job-queue";
import { runAiJob } from "../../lib/ai-jobs";
import { AiCallError } from "../../lib/retry-ai-call";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import { blocks, files, pages } from "../../schema";
import { runOverviewJob } from "../drafts/overview-job";
import { runGenerationJob } from "../generated-values/generation";
import { seoManager as seoManagerPatroller, translator as translatorPatroller } from "./patrollers";
import { writeCheck } from "./reports";

// The Patrol (ADR 0024) as the studio reads it: edits go through the router, Camox's scheduled
// jobs run against the scripted model, and the `PatrolView` says what the patrollers did.

type Headers = Record<string, string>;

const seo = { metaTitle: "Pricing", metaDescription: "What Camox costs" };

async function fixture() {
  const base = await createProjectFixture(`patrol-${crypto.randomUUID()}`);
  const { db, project, memberUser } = base;
  const projectId = project.id;
  await syncDefinitionSet(db, project, {
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
  const member = (headers: Headers = {}) => ({
    context: createRpcContext(db, memberUser, headers),
  });
  const createPage = async (nickname: string, headers: Headers = {}) =>
    (
      await callSeedingLive(
        router.pages.create,
        {
          projectId,
          nickname,
          pathSegment: nickname.toLowerCase().replaceAll(" ", "-"),
          layoutId: base.layout.layoutId,
        },
        member(headers),
      )
    ).page;
  const page = await createPage("Pricing");
  const now = Date.now();
  const file = await db
    .insert(files)
    .values({
      projectId,
      url: "http://localhost/files/serve/team.png",
      alt: null,
      filename: null,
      mimeType: "image/png",
      size: 68,
      blobId: crypto.randomUUID(),
      path: "/",
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  const draft = generateUuidv7();
  const inDraft: Headers = { [DRAFT_HEADER]: draft };
  // The draft starts with an edit, as an editor's draft does.
  await call(
    router.pages.update,
    { id: page.id, nickname: "Pricing" },
    member({ ...inDraft, [DRAFT_CREATE_HEADER]: "1" }),
  );

  /** Runs a scheduled job, in the draft unless it names another scope. */
  const run = (job: Omit<GenerationJob, "draftId"> & { draftId?: string | null }) =>
    runService(runGenerationJob(db, { draftId: draft, ...job }));
  /** Runs a page's SEO job, the model answering `answer`. */
  const writeSeo = (
    pageId: string,
    options: { draftId?: string | null; locale?: string; answer?: typeof seo | AiCallError } = {},
  ) => {
    answerNext("pageSeo", options.answer ?? seo);
    return run({
      entity: "page",
      entityId: pageId,
      ...(options.draftId !== undefined ? { draftId: options.draftId } : {}),
      ...(options.locale ? { locale: options.locale } : {}),
    });
  };
  const describeFile = (filename = "team.png") => {
    answerNext("imageMetadata", { alt: "The team", filename });
    return run({ entity: "file", entityId: file.id });
  };
  const patrol = async (headers: Headers = inDraft) =>
    (await call(router.patrol.get, { projectId }, member(headers))).patrollers;
  const seoManager = async (headers?: Headers) =>
    (await patrol(headers)).find((patroller) => patroller.id === "seoManager")!;
  const sentences = (patroller: PatrollerView) =>
    patroller.reports.map(({ summary, outcome, live }) =>
      summary.kind === "text"
        ? summary.text
        : [
            outcome,
            summary.verb,
            summary.subject?.name ?? "-",
            summary.locale ?? "-",
            ...(live ? ["live"] : []),
          ].join(" "),
    );

  return {
    ...base,
    projectId,
    page,
    file,
    draft,
    inDraft,
    member,
    createPage,
    run,
    writeSeo,
    describeFile,
    patrol,
    seoManager,
    sentences,
  };
}

describe("the Patrol", () => {
  it("lists every patroller, with no time and no reports before any worked", async () => {
    const { patrol } = await fixture();

    const patrollers = await patrol();

    expect(patrollers.map(({ id, role }) => ({ id, role }))).toEqual(
      expect.arrayContaining([
        { id: "translator", role: "Translator" },
        { id: "seoManager", role: "SEO manager" },
        { id: "linkChecker", role: "Link checker" },
        { id: "proofreader", role: "Proofreader" },
      ]),
    );
    expect(patrollers).toHaveLength(4);
    for (const patroller of patrollers) {
      expect(patroller.lastActivityAt).toBeNull();
      expect(patroller.reports).toEqual([]);
      expect(patroller.more).toEqual([]);
    }
  });
});

describe("the SEO manager", () => {
  it("reports the SEO it wrote for a page, and moves ahead of patrollers that didn't work", async () => {
    const { page, writeSeo, patrol, sentences } = await fixture();
    const before = Date.now();

    await writeSeo(page.id);

    const [first, second] = await patrol();
    expect(first!.id).toBe("seoManager");
    expect(sentences(first!)).toEqual(["done wroteSeo Pricing en"]);
    expect(first!.reports[0]!.summary).toMatchObject({ subject: { entity: "page", id: page.id } });
    expect(first!.lastActivityAt).toBeGreaterThanOrEqual(before);
    expect(first!.lastActivityAt).toBe(first!.reports[0]!.at);
    expect(second!.id).toBe("translator");
    expect(second!.lastActivityAt).toBeNull();
  });

  it("updates its one report when it writes the same page's SEO again", async () => {
    const { page, writeSeo, seoManager } = await fixture();
    await writeSeo(page.id);
    const first = (await seoManager()).reports[0]!;
    await new Promise((resolve) => setTimeout(resolve, 5));

    await writeSeo(page.id, { answer: { metaTitle: "Plans", metaDescription: "Our plans" } });

    const { reports } = await seoManager();
    expect(reports).toHaveLength(1);
    expect(reports[0]!.at).toBeGreaterThan(first.at);
  });

  it("reports SEO per locale", async () => {
    const { projectId, page, inDraft, member, writeSeo, seoManager, sentences } = await fixture();
    await call(router.locales.add, { projectId, tag: "de" }, member(inDraft));

    await writeSeo(page.id);
    await writeSeo(page.id, { locale: "de" });

    expect(sentences(await seoManager())).toEqual([
      "done wroteSeo Pricing de",
      "done wroteSeo Pricing en",
    ]);
  });

  it("reports a failure when the model gave up, as its report only", async () => {
    const { page, inDraft, member, writeSeo, seoManager, sentences } = await fixture();
    // Asking for generated SEO again requests the page's SEO job.
    await call(router.pages.setSeo, { id: page.id, aiSeo: true }, member(inDraft));

    await writeSeo(page.id, { answer: new AiCallError({ cause: "OpenRouter 503" }) });

    const patroller = await seoManager();
    expect(sentences(patroller)).toEqual(["failed wroteSeo Pricing en"]);
  });

  it("leaves no report, and no time, for a page whose SEO is manual", async () => {
    const { page, inDraft, member, run, seoManager } = await fixture();
    // Requested while generated, then written by hand before its job ran.
    await call(router.pages.setSeo, { id: page.id, aiSeo: true }, member(inDraft));
    await call(router.pages.setSeo, { id: page.id, metaTitle: "Our pricing" }, member(inDraft));

    await run({ entity: "page", entityId: page.id });

    const patroller = await seoManager();
    expect(patroller.reports).toEqual([]);
    expect(patroller.lastActivityAt).toBeNull();
  });

  it("reports the file it described, by the filename it gave it", async () => {
    const { file, describeFile, seoManager, sentences } = await fixture();

    await describeFile("our-team.png");

    const patroller = await seoManager();
    expect(sentences(patroller)).toEqual(["done describedFile our-team.png en"]);
    expect(patroller.reports[0]!.summary).toMatchObject({
      subject: { entity: "file", id: file.id },
    });
  });

  it("says where its reports' subjects show: a page on the Canvas, a file as itself", async () => {
    const { page, file, writeSeo, describeFile, seoManager } = await fixture();

    await writeSeo(page.id);
    await describeFile();

    const places = (await seoManager()).reports.map((report) => report.place);
    expect(places).toEqual(
      expect.arrayContaining([
        { kind: "page", pageId: page.id, blockId: null, itemId: null },
        { kind: "file", fileId: file.id },
      ]),
    );
    expect(places).toHaveLength(2);
  });

  it("leaves summaries out of the Patrol", async () => {
    const { page, inDraft, member, run, patrol } = await fixture();
    const block = await call(
      router.blocks.create,
      { pageId: page.id, type: "hero", content: { title: "Plans" } },
      member(inDraft),
    );

    answerNext("summarize", "Plans hero");
    await run({ entity: "block", entityId: block.id });

    for (const patroller of await patrol()) expect(patroller.reports).toEqual([]);
  });

  // A Draft Overview is the draft's review, not a patroller's work (ADR 0024).
  it("leaves Draft Overviews out of the Patrol, written or failed", async () => {
    const { db, draft, patrol } = await fixture();
    const overview = (answer: { headline: string; bullets: string[] } | AiCallError) => {
      answerNext("draftOverview", answer);
      return runService(runOverviewJob(db, { kind: "overview", draftId: draft }));
    };

    await overview({ headline: "Renames Pricing", bullets: ["Pricing: renamed"] });
    await overview(new AiCallError({ cause: "Model unavailable" }));

    for (const patroller of await patrol()) {
      expect(patroller.reports).toEqual([]);
      expect(patroller.lastActivityAt).toBeNull();
    }
  });

  it("refreshes the Patrol of the scope it reported in", async () => {
    const { projectId, page, draft, writeSeo } = await fixture();
    forgetSent(projectId);

    await writeSeo(page.id);

    expect(refreshes(sentTo(projectId), draft, [...queryKeys.patrol.get, projectId])).toBe(true);
  });
});

describe("drafts and Live", () => {
  it("shows a draft its own reports and Live's, Live's marked, and Live its own only", async () => {
    const { page, writeSeo, describeFile, seoManager, sentences } = await fixture();
    await writeSeo(page.id, { draftId: null });
    await describeFile();

    expect(sentences(await seoManager())).toEqual([
      "done describedFile team.png en",
      "done wroteSeo Pricing en live",
    ]);
    expect(sentences(await seoManager({}))).toEqual(["done wroteSeo Pricing en live"]);
  });

  it("doesn't hand a draft's reports to Live when it's published", async () => {
    const { db, projectId, member, createPage, writeSeo, seoManager } = await fixture();
    const draftId = generateUuidv7();
    const inDraft = { [DRAFT_HEADER]: draftId, [DRAFT_CREATE_HEADER]: "1" };
    const about = await createPage("About", inDraft);
    await writeSeo(about.id, { draftId });
    expect((await seoManager(inDraft)).reports).toHaveLength(1);

    const { token } = await reviewed(
      db,
      draftId,
      call(router.drafts.previewPublish, { projectId }, member(inDraft)),
    );
    await call(router.drafts.publish, { projectId, token }, member(inDraft));

    expect((await seoManager({})).reports).toEqual([]);
  });
});

describe("where each patroller is on duty", () => {
  const duties = (patrollers: PatrollerView[]) =>
    Object.fromEntries(patrollers.map(({ id, duty }) => [id, duty]));

  it("has the Translator and the SEO manager work as you go in a draft, and the Link checker and the Proofreader check at publish", async () => {
    const { patrol } = await fixture();

    expect(duties(await patrol())).toEqual({
      translator: "asYouGo",
      seoManager: "asYouGo",
      linkChecker: "atPublish",
      proofreader: "atPublish",
    });
  });

  it("has the Translator, the SEO manager and the Proofreader off on Live, and the Link checker patrol it", async () => {
    const { patrol } = await fixture();

    expect(duties(await patrol({}))).toEqual({
      translator: "off",
      seoManager: "off",
      linkChecker: "asYouGo",
      proofreader: "off",
    });
  });
});

describe("when a patroller last checked", () => {
  /** A short wait, so that times written after it are later. */
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

  it("keeps the time a patroller last finished a check in each scope, found anything or not", async () => {
    const { db, projectId, draft, patrol } = await fixture();
    const before = Date.now();

    await runService(writeCheck(db, translatorPatroller, { projectId, draftId: draft }));

    const [first, second] = await patrol();
    expect(first!.id).toBe("translator");
    expect(first!.lastCheckedAt).toBeGreaterThanOrEqual(before);
    expect(first!.lastActivityAt).toBe(first!.lastCheckedAt);
    expect(first!.reports).toEqual([]);
    expect(second!.lastCheckedAt).toBeNull();
    // Live wasn't checked.
    for (const patroller of await patrol({})) expect(patroller.lastCheckedAt).toBeNull();
  });

  it("says a patroller last worked when it last checked or reported, whichever is later", async () => {
    const { db, projectId, draft, page, writeSeo, seoManager } = await fixture();
    await writeSeo(page.id);
    const reported = (await seoManager()).reports[0]!.at;
    await tick();

    await runService(writeCheck(db, seoManagerPatroller, { projectId, draftId: draft }));

    const checked = await seoManager();
    expect(checked.lastCheckedAt).toBeGreaterThan(reported);
    expect(checked.lastActivityAt).toBe(checked.lastCheckedAt);
    await tick();

    await writeSeo(page.id, { answer: { metaTitle: "Plans", metaDescription: "Our plans" } });

    const after = await seoManager();
    expect(after.reports[0]!.at).toBeGreaterThan(checked.lastCheckedAt!);
    expect(after.lastActivityAt).toBe(after.reports[0]!.at);
  });

  it("keeps a new time when a patroller checks the same scope again", async () => {
    const { db, projectId, draft, seoManager } = await fixture();
    await runService(writeCheck(db, seoManagerPatroller, { projectId, draftId: draft }));
    const first = (await seoManager()).lastCheckedAt!;
    await tick();

    await runService(writeCheck(db, seoManagerPatroller, { projectId, draftId: draft }));

    expect((await seoManager()).lastCheckedAt).toBeGreaterThan(first);
  });

  it("refreshes the Patrol of the scope checked", async () => {
    const { db, projectId, draft } = await fixture();
    forgetSent(projectId);

    await runService(writeCheck(db, seoManagerPatroller, { projectId, draftId: draft }));

    expect(refreshes(sentTo(projectId), draft, [...queryKeys.patrol.get, projectId])).toBe(true);
  });
});

describe("report subjects", () => {
  it("names a page as it's named now, and leaves out reports about a page that's gone", async () => {
    const { page, inDraft, member, createPage, writeSeo, seoManager, sentences } = await fixture();
    const about = await createPage("About", inDraft);
    await writeSeo(page.id);
    await writeSeo(about.id);

    await call(router.pages.update, { id: page.id, nickname: "Plans" }, member(inDraft));
    await call(router.pages.delete, { id: about.id }, member(inDraft));

    expect(sentences(await seoManager())).toEqual(["done wroteSeo Plans en"]);
  });

  it("leaves out a report about a page removed from the report's locale", async () => {
    const { projectId, page, inDraft, member, writeSeo, seoManager, sentences } = await fixture();
    const de = { ...inDraft, [LOCALE_HEADER]: "de" };
    await call(router.locales.add, { projectId, tag: "de" }, member(inDraft));
    await writeSeo(page.id);
    await writeSeo(page.id, { locale: "de" });

    await call(router.pages.delete, { id: page.id }, member(de));

    expect(sentences(await seoManager())).toEqual(["done wroteSeo Pricing en"]);
  });
});

describe("a burst", () => {
  it(`shows the newest reports, and counts the rest by locale`, async () => {
    const { projectId, inDraft, member, createPage, writeSeo, seoManager } = await fixture();
    const pages = [];
    for (let index = 0; index <= REPORTS_SHOWN; index++) {
      pages.push(await createPage(`Page ${index}`, inDraft));
    }
    // Adding a locale copies the pages into it.
    await call(router.locales.add, { projectId, tag: "de" }, member(inDraft));
    // Two in German first, then one more in English than the Patrol shows.
    for (const page of pages.slice(0, 2)) await writeSeo(page.id, { locale: "de" });
    for (const page of pages) await writeSeo(page.id);

    const patroller = await seoManager();

    expect(patroller.reports.map(({ summary }) => summary)).toEqual(
      pages
        .slice(1)
        .reverse()
        .map((page) =>
          expect.objectContaining({ subject: expect.objectContaining({ id: page.id }) }),
        ),
    );
    expect(patroller.more).toEqual([
      { locale: "de", count: 2 },
      { locale: "en", count: 1 },
    ]);
  });
});

// A patroller is working from the moment an edit requests its work until the work settles, as
// its own pending records say (ADR 0024).
describe("a patroller at work", () => {
  type Fixture = Awaited<ReturnType<typeof fixture>>;

  /** The model translates by keeping every text as it is. */
  const translateAsIs = () =>
    answerEvery("translate", ({ texts }) =>
      Object.fromEntries(texts.map(({ key, text }) => [key, text])),
    );
  /** The translation jobs scheduled so far, each key once. */
  const translationJobs = () => {
    const jobs = scheduled().filter(isTranslationJob);
    return [...new Map(jobs.map((job) => [JSON.stringify({ ...job, delayMs: 0 }), job])).values()];
  };
  /** Runs every translation job scheduled so far, as their alarms would, and forgets them. */
  const runTranslations = async (f: Fixture) => {
    const jobs = translationJobs();
    forgetScheduled(...jobs.map((job) => job.entityId));
    for (const job of jobs) await runService(runAiJob(f.db, job));
  };
  const translator = async (f: Fixture, headers?: Headers) =>
    (await f.patrol(headers)).find((patroller) => patroller.id === "translator")!;
  /** `f` with German added in its draft and translated. */
  const withGerman = async (f: Fixture) => {
    translateAsIs();
    await call(router.locales.add, { projectId: f.projectId, tag: "de" }, f.member(f.inDraft));
    await runTranslations(f);
  };
  const publish = async (f: Fixture, headers: Headers) => {
    const { token } = await reviewed(
      f.db,
      headers[DRAFT_HEADER]!,
      call(router.drafts.previewPublish, { projectId: f.projectId }, f.member(headers)),
    );
    await call(router.drafts.publish, { projectId: f.projectId, token }, f.member(headers));
  };
  /** A page a release adds to Live, which the catch-up draft translates. */
  const releasePage = (f: Fixture, nickname: string) =>
    seedLive(f.db, pages, {
      projectId: f.projectId,
      layoutId: f.layout.layoutId,
      pathSegment: nickname.toLowerCase(),
      fullPath: `/${nickname.toLowerCase()}`,
      nickname,
      contentUpdatedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  /** `f` with German on Live, and a page a release added, translating in the catch-up draft. */
  const catchingUp = async (f: Fixture) => {
    await withGerman(f);
    await publish(f, f.inDraft);
    return releasePage(f, "Plans");
  };
  const patrolKey = (f: Fixture) => [...queryKeys.patrol.get, f.projectId];

  it("shows the SEO manager working on a page from when an edit requests its SEO, and moves it first", async () => {
    const f = await fixture();
    const before = Date.now();

    await call(router.pages.setSeo, { id: f.page.id, aiSeo: true }, f.member(f.inDraft));

    const [first] = await f.patrol();
    expect(first!.id).toBe("seoManager");
    expect(first!.working).toEqual({
      subject: { entity: "page", id: f.page.id, name: "Pricing" },
      locales: [{ locale: "en", count: 1 }],
    });
    expect(first!.lastActivityAt).toBeGreaterThanOrEqual(before);
    expect(first!.reports).toEqual([]);
  });

  it("shows the SEO manager idle again once its job settled, done or failed", async () => {
    const f = await fixture();
    await call(router.pages.setSeo, { id: f.page.id, aiSeo: true }, f.member(f.inDraft));
    await f.writeSeo(f.page.id);
    expect((await f.seoManager()).working).toBeNull();

    await call(router.pages.setSeo, { id: f.page.id, aiSeo: true }, f.member(f.inDraft));
    await f.writeSeo(f.page.id, { answer: new AiCallError({ cause: "OpenRouter 503" }) });
    expect((await f.seoManager()).working).toBeNull();
  });

  it("shows the SEO manager's work in the draft it was requested in only", async () => {
    const f = await fixture();
    // Live's own SEO, written.
    await f.writeSeo(f.page.id, { draftId: null });
    expect((await f.seoManager({})).working).toBeNull();

    await call(router.pages.setSeo, { id: f.page.id, aiSeo: true }, f.member(f.inDraft));

    expect((await f.seoManager()).working).toEqual({
      subject: { entity: "page", id: f.page.id, name: "Pricing" },
      locales: [{ locale: "en", count: 1 }],
    });
    expect((await f.seoManager({})).working).toBeNull();
  });

  it("counts a burst of translations into a locale, before the Translator reported anything", async () => {
    const f = await fixture();
    translateAsIs();
    await call(
      router.blocks.create,
      { pageId: f.page.id, type: "hero", content: { title: "Plans" } },
      f.member(f.inDraft),
    );

    await call(router.locales.add, { projectId: f.projectId, tag: "de" }, f.member(f.inDraft));

    const patroller = await translator(f);
    const subjects = new Set(translationJobs().map((job) => `${job.entity}:${job.entityId}`));
    expect(subjects.size).toBeGreaterThan(1);
    expect(patroller.working).toEqual({
      subject: null,
      locales: [{ locale: "de", count: subjects.size }],
    });
    expect(patroller.reports).toEqual([]);
    expect(patroller.lastActivityAt).not.toBeNull();

    await runTranslations(f);
    expect((await translator(f)).working).toBeNull();
  });

  it("counts a burst spanning locales in each locale, the most first", async () => {
    const f = await fixture();
    translateAsIs();
    await call(
      router.blocks.create,
      { pageId: f.page.id, type: "hero", content: { title: "Plans" } },
      f.member(f.inDraft),
    );
    await call(router.locales.add, { projectId: f.projectId, tag: "de" }, f.member(f.inDraft));
    await runTranslations(f);

    await call(router.locales.add, { projectId: f.projectId, tag: "fr" }, f.member(f.inDraft));
    // German has one subject left to translate, French every one.
    await call(router.pages.update, { id: f.page.id, nickname: "Plans" }, f.member(f.inDraft));

    const frenchSubjects = new Set(
      translationJobs()
        .filter((job) => job.locale === "fr")
        .map((job) => `${job.entity}:${job.entityId}`),
    );
    expect(frenchSubjects.size).toBeGreaterThan(1);
    expect((await translator(f)).working).toEqual({
      subject: null,
      locales: [
        { locale: "fr", count: frenchSubjects.size },
        { locale: "de", count: 1 },
      ],
    });
  });

  it("names the one subject the Translator is on, and the locale it translates into", async () => {
    const f = await fixture();
    await withGerman(f);

    await call(router.pages.update, { id: f.page.id, nickname: "Plans" }, f.member(f.inDraft));

    expect((await translator(f)).working).toEqual({
      subject: { entity: "page", id: f.page.id, name: "Plans" },
      locales: [{ locale: "de", count: 1 }],
    });
  });

  it("moves a patroller that starts working ahead of one that reported since its last work", async () => {
    const f = await fixture();
    await withGerman(f);
    const block = await call(
      router.blocks.create,
      { pageId: f.page.id, type: "hero", content: { title: "Plans" } },
      f.member(f.inDraft),
    );
    await runTranslations(f);
    // Everything the SEO manager has to do, done.
    answerEvery("pageSeo", () => seo);
    answerEvery("summarize", () => "Plans hero");
    answerEvery("imageMetadata", () => ({ alt: "The team", filename: "team.png" }));
    for (const job of scheduled().filter((job) => !isTranslationJob(job))) {
      await runService(runAiJob(f.db, job));
    }
    await f.writeSeo(f.page.id);
    expect((await f.patrol()).map(({ id, working }) => ({ id, working }))).toEqual([
      { id: "seoManager", working: null },
      { id: "translator", working: null },
      { id: "linkChecker", working: null },
      { id: "proofreader", working: null },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 5));

    await call(
      router.blocks.updateContent,
      { id: block.id, content: { title: "Our plans" } },
      f.member(f.inDraft),
    );

    const [first, second] = await f.patrol();
    expect(first!.id).toBe("translator");
    expect(first!.working!.locales).toEqual([{ locale: "de", count: 1 }]);
    expect(first!.lastActivityAt).toBeGreaterThan(second!.lastActivityAt!);
  });

  it("shows the Translator working on Live while the catch-up draft translates", async () => {
    const f = await fixture();

    const released = await catchingUp(f);

    expect((await translator(f, {})).working).toEqual({
      subject: { entity: "page", id: released.id, name: "Plans" },
      locales: [{ locale: "de", count: 1 }],
    });
    await runTranslations(f);
    expect((await translator(f, {})).working).toBeNull();
  });

  it("puts the Translator and the SEO manager on duty on Live while the catch-up draft translates", async () => {
    const f = await fixture();
    const onLive = async () =>
      Object.fromEntries((await f.patrol({})).map(({ id, duty }) => [id, duty]));

    await catchingUp(f);

    expect(await onLive()).toMatchObject({ translator: "asYouGo", seoManager: "asYouGo" });
    // Once its translations settle and its checks ran, the catch-up draft is published, and
    // they're off again.
    await runTranslations(f);
    await runAllChecks(f.db);
    expect(await onLive()).toMatchObject({ translator: "off", seoManager: "off" });
  });

  it("refreshes the Patrol of the draft whose SEO is requested", async () => {
    const f = await fixture();
    forgetSent(f.projectId);

    await call(router.pages.setSeo, { id: f.page.id, aiSeo: true }, f.member(f.inDraft));

    expect(refreshes(sentTo(f.projectId), f.draft, patrolKey(f))).toBe(true);
  });

  it("refreshes the Patrol of the draft whose translations are requested", async () => {
    const f = await fixture();
    await withGerman(f);
    const block = await call(
      router.blocks.create,
      { pageId: f.page.id, type: "hero", content: { title: "Plans" } },
      f.member(f.inDraft),
    );
    await runTranslations(f);
    forgetSent(f.projectId);

    await call(
      router.blocks.updateContent,
      { id: block.id, content: { title: "Our plans" } },
      f.member(f.inDraft),
    );

    expect(refreshes(sentTo(f.projectId), f.draft, patrolKey(f))).toBe(true);
  });

  it("leaves the Patrol alone when only a summary is requested", async () => {
    const f = await fixture();
    const block = await call(
      router.blocks.create,
      { pageId: f.page.id, type: "hero", content: { title: "Plans" } },
      f.member(f.inDraft),
    );
    forgetSent(f.projectId);

    await call(
      router.blocks.updateContent,
      { id: block.id, content: { title: "Our plans" } },
      f.member(f.inDraft),
    );

    expect(refreshes(sentTo(f.projectId), f.draft, patrolKey(f))).toBe(false);
  });

  it("refreshes Live's Patrol when one of the catch-up draft's translations settles", async () => {
    const f = await fixture();
    await withGerman(f);
    await publish(f, f.inDraft);
    // A release adds a page with a block, which the catch-up draft translates.
    const page = await releasePage(f, "Plans");
    const block = await seedLive(f.db, blocks, {
      projectId: f.projectId,
      pageId: page.id,
      type: "hero",
      content: { title: "Our plans" },
      position: "a0",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    expect((await translator(f, {})).working!.locales).toEqual([{ locale: "de", count: 2 }]);
    forgetSent(f.projectId);

    const job = translationJobs().find((job) => job.entityId === block.id)!;
    forgetScheduled(block.id);
    await runService(runAiJob(f.db, job));

    expect((await translator(f, {})).working!.locales).toEqual([{ locale: "de", count: 1 }]);
    expect(refreshes(sentTo(f.projectId), null, patrolKey(f))).toBe(true);
  });
});
