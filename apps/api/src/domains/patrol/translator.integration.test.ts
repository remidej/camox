import {
  CAMOX_ACTOR,
  DRAFT_CREATE_HEADER,
  DRAFT_HEADER,
  LOCALE_HEADER,
} from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import type { PatrollerView } from "@camox/api-contract/patrol";
import { queryKeys } from "@camox/api-contract/query-keys";
import { call } from "@orpc/server";
import { describe, expect, it } from "vite-plus/test";

import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  syncDefinitionSet,
} from "../../../test/fixtures";
import { answerEvery, answerNext, forgetScheduled, scheduled } from "../../../test/generation";
import { forgetSent, refreshes, sentTo } from "../../../test/project-rooms";
import { isTranslationJob } from "../../lib/ai-job-queue";
import { runAiJob } from "../../lib/ai-jobs";
import { AiCallError } from "../../lib/retry-ai-call";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import { runGenerationJob } from "../generated-values/generation";

// The Translator in the Patrol (ADR 0024): edits go through the router, translation jobs run
// against the scripted model, which translates with dictionaries, and the `PatrolView` says what
// the Translator did.

type Headers = Record<string, string>;
type ToolResponse =
  | { ok: true; result: any }
  | { ok: false; error: { code: string; message: string } };

const DICTIONARIES: Record<string, Record<string, string>> = {
  de: { Hello: "Hallo", Welcome: "Willkommen", One: "Eins", First: "Erster", pricing: "preise" },
  fr: { Hello: "Bonjour", Welcome: "Bienvenue", One: "Un", First: "Premier", pricing: "prix" },
};

/**
 * The model translates with the dictionaries, keeping words it doesn't know, and into Spanish by
 * marking every text, so that each one changes.
 */
const translateWithDictionaries = () =>
  answerEvery("translate", ({ to, texts }) =>
    Object.fromEntries(
      texts.map(({ key, text }) => [
        key,
        to === "es" ? `${text}-es` : (DICTIONARIES[to]?.[text] ?? text),
      ]),
    ),
  );

/**
 * A project whose Live holds, in English, German and French: a page with a hero block holding a
 * repeatable item and an article. Each test then works in a draft of its own.
 */
async function fixture() {
  const base = await createProjectFixture(`translator-${crypto.randomUUID()}`);
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
          properties: {
            title: { type: "string", fieldType: "String" },
            items: {
              type: "array",
              fieldType: "Repeater",
              toTitle: "{{label}}",
              items: {
                type: "object",
                properties: { label: { type: "string", fieldType: "String" } },
              },
            },
          },
          toTitle: "{{title}}",
          toMarkdown: ["# {{title}}"],
        },
      },
      {
        blockId: "notice",
        title: "Notice",
        description: "Notice",
        synced: true,
        contentSchema: {
          type: "object",
          properties: { title: { type: "string", fieldType: "String", default: "Hello" } },
          toMarkdown: ["# {{title}}"],
        },
      },
    ],
    collections: [
      {
        collectionId: "articles",
        title: "Articles",
        description: "",
        toTitle: "{{title}}",
        toDescription: null,
        contentSchema: {
          type: "object",
          properties: { title: { type: "string", fieldType: "String" } },
          required: ["title"],
          additionalProperties: false as const,
        },
      },
    ],
  });
  translateWithDictionaries();

  const member = (headers: Headers = {}) => ({
    context: createRpcContext(db, memberUser, headers),
  });
  const { page } = await callSeedingLive(
    router.pages.create,
    { projectId, nickname: "Pricing", pathSegment: "pricing", layoutId: base.layout.layoutId },
    member(),
  );
  const block = await callSeedingLive(
    router.blocks.create,
    { pageId: page.id, type: "hero", content: { title: "Hello", items: [{ label: "One" }] } },
    member(),
  );
  const record = await callSeedingLive(
    router.collectionDefinitions.createRecord,
    { projectUuid: project.uuid, collectionId: "articles", content: { title: "First" } },
    member(),
  );

  const tool = async (name: string, args: object, headers: Headers) => {
    const response = (await call(
      router.agent.callTool,
      { projectId, name, arguments: args },
      member(headers),
    )) as ToolResponse;
    if (!response.ok) throw new Error(`${name} failed: ${JSON.stringify(response.error)}`);
    return response.result;
  };
  /** The translation jobs scheduled so far, each key once. */
  const translationJobs = () => {
    const jobs = scheduled().filter(isTranslationJob);
    return [...new Map(jobs.map((job) => [JSON.stringify({ ...job, delayMs: 0 }), job])).values()];
  };
  /** Runs every translation job scheduled so far, as their alarms would, and forgets them. */
  const runTranslations = async () => {
    const jobs = translationJobs();
    forgetScheduled(...jobs.map((job) => job.entityId));
    for (const job of jobs) await runService(runAiJob(db, job));
  };
  /** Runs the translation jobs scheduled so far into one locale, leaving the others pending. */
  const runTranslationsInto = async (locale: string) => {
    for (const job of translationJobs().filter((job) => job.locale === locale)) {
      await runService(runAiJob(db, job));
    }
  };
  /** Opens a draft, which `run` writes in, and returns its headers. */
  const draft = async (run: (starting: Headers) => Promise<unknown>) => {
    const id = generateUuidv7();
    await run({ [DRAFT_HEADER]: id, [DRAFT_CREATE_HEADER]: "1" });
    return { id, headers: { [DRAFT_HEADER]: id } };
  };
  const publish = async (headers: Headers, options: { publishAnyway?: boolean } = {}) => {
    const { token } = await tool("previewPublish", {}, headers);
    return tool("publishDraft", { token, ...options }, headers);
  };

  // German and French go live, translated.
  const locales = await draft(async (starting) => {
    await tool("addLocale", { tag: "de" }, starting);
    await tool("addLocale", { tag: "fr" }, { [DRAFT_HEADER]: starting[DRAFT_HEADER]! });
  });
  await runTranslations();
  await publish(locales.headers);

  const translator = async (headers: Headers) =>
    (await call(router.patrol.get, { projectId }, member(headers))).patrollers.find(
      (patroller) => patroller.id === "translator",
    )!;
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
    member,
    page,
    block,
    record,
    tool,
    runTranslations,
    runTranslationsInto,
    draft,
    publish,
    translator,
    sentences,
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

/** A draft retitling the hero in the default locale, its translations not run yet. */
const retitled = (f: Fixture, title = "Welcome") =>
  f.draft((starting) => f.tool("editBlock", { id: f.block.id, content: { title } }, starting));

describe("the Translator", () => {
  it("reports a default-locale edit translated into each of the draft's other locales", async () => {
    const f = await fixture();
    const edited = await retitled(f);
    expect((await f.translator(edited.headers)).reports).toEqual([]);

    await f.runTranslations();

    expect(f.sentences(await f.translator(edited.headers)).sort()).toEqual([
      "done translated Welcome de",
      "done translated Welcome fr",
    ]);
  });
});

describe("what the Translator reports", () => {
  it("updates its one report when it translates the same subject into the same locale again", async () => {
    const f = await fixture();
    const edited = await retitled(f);
    await f.runTranslations();
    const before = (await f.translator(edited.headers)).reports;
    await new Promise((resolve) => setTimeout(resolve, 5));

    await f.tool("editBlock", { id: f.block.id, content: { title: "Hello" } }, edited.headers);
    await f.runTranslations();

    const after = await f.translator(edited.headers);
    expect(f.sentences(after).sort()).toEqual([
      "done translated Hello de",
      "done translated Hello fr",
    ]);
    expect(Math.min(...after.reports.map(({ at }) => at))).toBeGreaterThan(
      Math.max(...before.map(({ at }) => at)),
    );
  });

  it("leaves no report, and no time, when the localization was already up to date", async () => {
    const f = await fixture();
    // Edited, then edited back before its translations ran.
    const edited = await retitled(f);
    await f.tool("editBlock", { id: f.block.id, content: { title: "Hello" } }, edited.headers);

    await f.runTranslations();

    const translator = await f.translator(edited.headers);
    expect(translator.reports).toEqual([]);
    expect(translator.lastActivityAt).toBeNull();
  });

  it("reports a failed translation", async () => {
    const f = await fixture();
    const edited = await retitled(f);
    answerEvery("translate", () => new AiCallError({ cause: "OpenRouter 503" }));

    await f.runTranslations();

    expect(f.sentences(await f.translator(edited.headers)).sort()).toEqual([
      "failed translated Welcome de",
      "failed translated Welcome fr",
    ]);
  });

  it("reports the code-owned defaults it translated, as a translation", async () => {
    const f = await fixture();
    const placed = await f.draft((starting) =>
      call(
        router.blocks.create,
        { pageId: f.page.id, type: "notice", content: {} },
        f.member({ ...starting, [LOCALE_HEADER]: "de" }),
      ),
    );

    await f.runTranslations();

    expect(f.sentences(await f.translator(placed.headers))).toEqual(["done translated Notice de"]);
  });
});

describe("the Translator's report subjects", () => {
  it("names a block by its summary once it has one", async () => {
    const f = await fixture();
    const edited = await retitled(f);
    await f.runTranslations();

    answerNext("summarize", "Pricing hero");
    await runService(
      runGenerationJob(f.db, { draftId: edited.id, entity: "block", entityId: f.block.id }),
    );

    expect(f.sentences(await f.translator(edited.headers)).sort()).toEqual([
      "done translated Pricing hero de",
      "done translated Pricing hero fr",
    ]);
  });

  it("names a block by its title as it is now", async () => {
    const f = await fixture();
    const edited = await retitled(f);
    await f.runTranslations();

    // Retitled again, its translations not run yet.
    await f.tool("editBlock", { id: f.block.id, content: { title: "Hi" } }, edited.headers);

    expect(f.sentences(await f.translator(edited.headers)).sort()).toEqual([
      "done translated Hi de",
      "done translated Hi fr",
    ]);
  });

  it("names a repeatable item by its title", async () => {
    const f = await fixture();
    const [item] = (await f.tool("getBlock", { id: f.block.id }, {})).repeatableItems;
    const edited = await f.draft((starting) =>
      call(
        router.repeatableItems.updateContent,
        { id: item.id, content: { label: "Hello" } },
        f.member(starting),
      ),
    );

    await f.runTranslations();

    expect(f.sentences(await f.translator(edited.headers)).sort()).toEqual([
      "done translated Hello de",
      "done translated Hello fr",
    ]);
  });

  it("names a collection record by its title in the report's locale", async () => {
    const f = await fixture();
    const edited = await f.draft((starting) =>
      f.tool(
        "editCollectionRecord",
        { collectionId: "articles", id: f.record.id, content: { title: "Welcome" } },
        starting,
      ),
    );

    await f.runTranslations();

    expect(f.sentences(await f.translator(edited.headers)).sort()).toEqual([
      "done translated Bienvenue fr",
      "done translated Willkommen de",
    ]);
  });

  it("says where each subject shows: a block or item on its page, a record in its collection", async () => {
    const f = await fixture();
    const [item] = (await f.tool("getBlock", { id: f.block.id }, {})).repeatableItems;
    const edited = await f.draft(async (starting) => {
      await f.tool("editBlock", { id: f.block.id, content: { title: "Welcome" } }, starting);
      const headers = { [DRAFT_HEADER]: starting[DRAFT_HEADER]! };
      await call(
        router.repeatableItems.updateContent,
        { id: item.id, content: { label: "Hello" } },
        f.member(headers),
      );
      await f.tool(
        "editCollectionRecord",
        { collectionId: "articles", id: f.record.id, content: { title: "Welcome" } },
        headers,
      );
    });
    await f.runTranslationsInto("de");

    const places = Object.fromEntries(
      (await f.translator(edited.headers)).reports.map((report) => [
        report.summary.kind === "structured" ? report.summary.subject?.entity : "-",
        report.place,
      ]),
    );
    expect(places).toEqual({
      block: { kind: "page", pageId: f.page.id, blockId: f.block.id, itemId: null },
      repeatableItem: { kind: "page", pageId: f.page.id, blockId: f.block.id, itemId: item.id },
      record: { kind: "record", collectionId: "articles", recordId: f.record.id },
    });
  });

  it("leaves out a report about a subject removed from the report's locale", async () => {
    const f = await fixture();
    const edited = await retitled(f);
    await f.runTranslations();

    await call(
      router.blocks.delete,
      { id: f.block.id },
      f.member({ ...edited.headers, [LOCALE_HEADER]: "de" }),
    );

    expect(f.sentences(await f.translator(edited.headers))).toEqual(["done translated Welcome fr"]);
  });
});

describe("the catch-up draft", () => {
  /** A draft retitling the hero, published anyway: its translations carry on in Camox's draft. */
  const publishedAnyway = async (f: Fixture) => {
    const edited = await retitled(f);
    await f.publish(edited.headers, { publishAnyway: true });
  };

  it("shows its Translator's work on Live, as Live's, and in any draft, marked Live's", async () => {
    const f = await fixture();
    await publishedAnyway(f);
    forgetSent(f.projectId);

    // French still translating keeps the catch-up draft open.
    await f.runTranslationsInto("de");

    const other = await f.draft((starting) =>
      call(router.pages.update, { id: f.page.id, nickname: "Plans" }, f.member(starting)),
    );
    expect(refreshes(sentTo(f.projectId), null, [...queryKeys.patrol.get, f.projectId])).toBe(true);
    expect(f.sentences(await f.translator({}))).toEqual(["done translated Welcome de live"]);
    expect(f.sentences(await f.translator(other.headers))).toEqual([
      "done translated Welcome de live",
    ]);
  });

  it("reports on Live publishing the catch-up draft, its own reports ending with it", async () => {
    const f = await fixture();
    await publishedAnyway(f);

    await f.runTranslations();

    const translator = await f.translator({});
    expect(f.sentences(translator)).toEqual(["done publishedCatchUp - - live"]);
    expect(translator.reports[0]!.summary).toMatchObject({ subject: null });
    // Camox stays its publisher.
    const { live } = await call(router.drafts.list, { projectId: f.projectId }, f.member());
    expect(live.publishedBy).toEqual({ id: CAMOX_ACTOR, name: "Camox" });
  });

  it("refreshes Live's Patrol when an editor deletes the catch-up draft, its reports ending", async () => {
    const f = await fixture();
    await publishedAnyway(f);
    // French still translating keeps the catch-up draft open, with a German report Live shows.
    await f.runTranslationsInto("de");
    const { drafts } = await call(router.drafts.list, { projectId: f.projectId }, f.member());
    const catchUp = drafts.find((draft) => draft.createdBy.id === CAMOX_ACTOR)!;
    expect((await f.translator({})).reports).toHaveLength(1);
    forgetSent(f.projectId);

    await call(
      router.drafts.delete,
      { projectId: f.projectId },
      f.member({ [DRAFT_HEADER]: catchUp.id }),
    );

    expect(refreshes(sentTo(f.projectId), null, [...queryKeys.patrol.get, f.projectId])).toBe(true);
    expect((await f.translator({})).reports).toEqual([]);
  });

  it("leaves no report when it's dropped because its translations changed nothing", async () => {
    const f = await fixture();
    await publishedAnyway(f);
    answerEvery("translate", () => new AiCallError({ cause: "OpenRouter 503" }));

    await f.runTranslations();

    const translator = await f.translator({});
    expect(translator.reports).toEqual([]);
    expect(translator.lastActivityAt).toBeNull();
  });
});
