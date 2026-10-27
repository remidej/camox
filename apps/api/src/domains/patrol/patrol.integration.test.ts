import {
  DEVELOPMENT_DRAFT,
  DRAFT_CREATE_HEADER,
  DRAFT_HEADER,
  LOCALE_HEADER,
} from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { REPORTS_SHOWN, type PatrollerView } from "@camox/api-contract/patrol";
import { queryKeys } from "@camox/api-contract/query-keys";
import { call } from "@orpc/server";
import { describe, expect, it } from "vite-plus/test";

import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  openDevelopmentDraft,
  syncDefinitionSet,
} from "../../../test/fixtures";
import { answerNext } from "../../../test/generation";
import { forgetSent, refreshes, sentTo } from "../../../test/project-rooms";
import type { GenerationJob } from "../../lib/ai-job-queue";
import { AiCallError } from "../../lib/retry-ai-call";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import { files } from "../../schema";
import { runGenerationJob } from "../generated-values/generation";

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
      ]),
    );
    expect(patrollers).toHaveLength(2);
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
    expect(patroller.reports[0]!.attention).toBe("none");
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

  // A development draft stays when it's published or deleted, so it shows what ended with it.
  it("ends a draft's reports when it's published", async () => {
    const { db, projectId, memberUser, member, createPage, writeSeo, seoManager } = await fixture();
    const development = await openDevelopmentDraft(db, projectId, memberUser.id);
    const inDevelopment = { [DRAFT_HEADER]: DEVELOPMENT_DRAFT };
    const about = await createPage("About", inDevelopment);
    await writeSeo(about.id, { draftId: development });
    expect((await seoManager(inDevelopment)).reports).toHaveLength(1);

    const { token } = await call(
      router.drafts.previewPublish,
      { projectId },
      member(inDevelopment),
    );
    await call(
      router.drafts.publish,
      { projectId, token, publishAnyway: true },
      member(inDevelopment),
    );

    expect((await seoManager(inDevelopment)).reports).toEqual([]);
    expect((await seoManager({})).reports).toEqual([]);
  });

  it("ends a draft's reports when it's deleted", async () => {
    const { db, projectId, memberUser, page, member, writeSeo, seoManager } = await fixture();
    const development = await openDevelopmentDraft(db, projectId, memberUser.id);
    const inDevelopment = { [DRAFT_HEADER]: DEVELOPMENT_DRAFT };
    await call(router.pages.update, { id: page.id, nickname: "Plans" }, member(inDevelopment));
    await writeSeo(page.id, { draftId: development });
    expect((await seoManager(inDevelopment)).reports).toHaveLength(1);

    await call(router.drafts.delete, { projectId }, member(inDevelopment));

    expect((await seoManager(inDevelopment)).reports).toEqual([]);
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
