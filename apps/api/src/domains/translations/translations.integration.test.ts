import {
  DEVELOPMENT_DRAFT,
  DRAFT_CREATE_HEADER,
  DRAFT_HEADER,
  LOCALE_HEADER,
} from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { describe, expect, it } from "vite-plus/test";

import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  createServiceContext,
  openDevelopmentDraft,
} from "../../../test/fixtures";
import { answerEvery, forgetScheduled, modelCalls, scheduled } from "../../../test/generation";
import { runAiJob } from "../../lib/ai-jobs";
import { AiCallError } from "../../lib/retry-ai-call";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import { upsertBlockDefinition } from "../block-definitions/service";

// Camox keeps every locale translated from the default locale (ADR 0015): adding a locale
// translates the website into it, and every write to the default locale in a draft is translated
// into the draft's other locales. The model's translations are scripted as a dictionary.

type Headers = Record<string, string>;
type ToolResponse =
  | { ok: true; result: any }
  | { ok: false; error: { code: string; message: string } };

const GERMAN: Record<string, string> = {
  Hello: "Hallo",
  One: "Eins",
  Two: "Zwei",
  Docs: "Dokumentation",
  Welcome: "Willkommen",
  Acme: "Acme AG",
  First: "Erster",
  pricing: "preise",
  team: "Mannschaft",
  about: "uber-uns",
  prices: "preise",
};
const FRENCH: Record<string, string> = { Hello: "Bonjour", Welcome: "Bienvenue", team: "equipe" };

/** The model translates with these dictionaries, keeping words it doesn't know. */
function translateWithDictionaries() {
  const dictionaries: Record<string, Record<string, string>> = { de: GERMAN, fr: FRENCH };
  answerEvery("translate", ({ to, texts }) =>
    Object.fromEntries(texts.map(({ key, text }) => [key, dictionaries[to]?.[text] ?? text])),
  );
}

/**
 * A project with, on Live in the default locale: a page with a block holding a repeatable item,
 * and a collection record.
 */
async function fixture() {
  const base = await createProjectFixture(`translations-${crypto.randomUUID()}`);
  const { db, project, memberUser } = base;
  const projectId = project.id;
  const { slug: projectSlug, deployToken } = project;
  await runService(
    upsertBlockDefinition(createServiceContext(db, null), {
      projectSlug,
      deployToken,
      blockId: "hero",
      title: "Hero",
      description: "Hero",
      contentSchema: {
        type: "object",
        properties: {
          title: { type: "string", fieldType: "String" },
          variant: { type: "string", fieldType: "Enum", enum: ["light", "dark"] },
          items: {
            type: "array",
            fieldType: "Repeater",
            items: {
              type: "object",
              properties: { label: { type: "string", fieldType: "String" } },
            },
          },
        },
        toMarkdown: ["# {{title}}"],
      },
    }),
  );
  await call(
    router.collectionDefinitions.sync,
    {
      projectSlug,
      deployToken,
      autoCreate: false,
      definitions: [
        {
          collectionId: "articles",
          title: "Articles",
          description: "",
          label: "title",
          contentSchema: {
            type: "object",
            properties: { title: { type: "string", fieldType: "String" } },
            required: ["title"],
            additionalProperties: false,
          },
        },
      ],
    },
    { context: createRpcContext(db, null) },
  );

  const member = (headers: Headers = {}) => ({
    context: createRpcContext(db, memberUser, headers),
  });
  const { page } = await callSeedingLive(
    router.pages.create,
    { projectId, pathSegment: "pricing", layoutId: base.layout.layoutId },
    member(),
  );
  const block = await callSeedingLive(
    router.blocks.create,
    {
      pageId: page.id,
      type: "hero",
      content: { title: "Hello", variant: "dark", items: [{ label: "One" }] },
    },
    member(),
  );
  const record = await callSeedingLive(
    router.collectionDefinitions.createRecord,
    { projectSlug, collectionId: "articles", content: { title: "First" } },
    member(),
  );
  await openDevelopmentDraft(db, projectId, memberUser.id);

  const draft = generateUuidv7();
  const starting: Headers = { [DRAFT_HEADER]: draft, [DRAFT_CREATE_HEADER]: "1" };
  const inDraft: Headers = { [DRAFT_HEADER]: draft };

  const tool = async (name: string, args: object = {}, headers: Headers = inDraft) => {
    const response = (await call(
      router.agent.callTool,
      { projectId, name, arguments: args },
      member(headers),
    )) as ToolResponse;
    if (!response.ok) throw new Error(`${name} failed: ${JSON.stringify(response.error)}`);
    return response.result;
  };
  const blockIn = async (locale?: string, headers: Headers = inDraft) =>
    tool("getBlock", { id: block.id, locale }, headers);
  const pageIn = async (locale?: string, headers: Headers = inDraft) =>
    (await tool("getPage", { id: page.id, locale }, headers)).page;

  /** The translation jobs scheduled so far, each key once. */
  const translationJobs = () => {
    const jobs = scheduled().filter((job) => "locale" in job);
    const keyed = new Map(jobs.map((job) => [JSON.stringify({ ...job, delayMs: 0 }), job]));
    return [...keyed.values()];
  };
  /** Runs every translation job scheduled so far, as their alarms would, and forgets them. */
  const runTranslations = async () => {
    const jobs = translationJobs();
    forgetScheduled(...jobs.map((job) => job.entityId));
    for (const job of jobs) await runService(runAiJob(db, job));
  };

  return {
    ...base,
    projectId,
    projectSlug,
    member,
    page,
    block,
    record,
    draft,
    starting,
    inDraft,
    tool,
    blockIn,
    pageIn,
    translationJobs,
    runTranslations,
  };
}

describe("adding a locale", () => {
  it("queues translations of the whole website into it, and running them writes the locale's content into the draft", async () => {
    const f = await fixture();
    translateWithDictionaries();

    await f.tool("addLocale", { tag: "de" }, f.starting);
    expect(f.translationJobs()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entity: "page", entityId: f.page.id, locale: "de" }),
        expect.objectContaining({ entity: "block", entityId: f.block.id, locale: "de" }),
        expect.objectContaining({ entity: "record", entityId: f.record.id, locale: "de" }),
      ]),
    );
    await f.runTranslations();

    const german = await f.blockIn("de");
    // Text is translated, other values are copied as they are.
    expect(german.block.content).toMatchObject({ title: "Hallo", variant: "dark" });
    expect(german.repeatableItems).toEqual([
      expect.objectContaining({ locale: "de", content: { label: "Eins" } }),
    ]);
    expect(await f.pageIn("de")).toMatchObject({ pathSegment: "preise", fullPath: "/preise" });
    const record = await f.tool("getCollectionRecord", {
      collectionId: "articles",
      id: f.record.id,
      locale: "de",
    });
    expect(record.content).toEqual({ title: "Erster" });
    // Live and the default locale are untouched.
    expect((await f.blockIn()).block.content).toMatchObject({ title: "Hello" });
    expect((await f.blockIn(undefined, {})).block.content).toMatchObject({ title: "Hello" });
    expect(modelCalls().every(({ method }) => method === "translate")).toBe(true);
  });
});

/** A draft of `f` holding German and French, both translated. */
async function translatedDraft(f: Awaited<ReturnType<typeof fixture>>) {
  translateWithDictionaries();
  await f.tool("addLocale", { tag: "de" }, f.starting);
  await f.tool("addLocale", { tag: "fr" });
  await f.runTranslations();
}

/** The title of `f`'s block in a locale of its draft. */
const titleIn = async (f: Awaited<ReturnType<typeof fixture>>, locale: string) =>
  (await f.blockIn(locale)).block.content.title;

describe("changing the default locale", () => {
  it("translates a change made in the studio into every locale of the same draft", async () => {
    const f = await fixture();
    await translatedDraft(f);

    await call(
      router.blocks.updateContent,
      { id: f.block.id, content: { title: "Welcome" } },
      f.member(f.inDraft),
    );

    expect(f.translationJobs()).toEqual([
      expect.objectContaining({
        entity: "block",
        entityId: f.block.id,
        locale: "de",
        draftId: f.draft,
      }),
      expect.objectContaining({
        entity: "block",
        entityId: f.block.id,
        locale: "fr",
        draftId: f.draft,
      }),
    ]);
    await f.runTranslations();
    expect(await titleIn(f, "de")).toBe("Willkommen");
    expect(await titleIn(f, "fr")).toBe("Bienvenue");
  });

  it("translates a change made by an AI tool", async () => {
    const f = await fixture();
    await translatedDraft(f);

    await f.tool("editBlock", { id: f.block.id, content: { title: "Welcome" } });

    expect(f.translationJobs().map(({ locale }) => locale)).toEqual(["de", "fr"]);
    await f.runTranslations();
    expect(await titleIn(f, "de")).toBe("Willkommen");
  });

  it("translates a change made with the CLI in a development draft", async () => {
    const f = await fixture();
    const development = { [DRAFT_HEADER]: DEVELOPMENT_DRAFT };
    translateWithDictionaries();
    await f.tool("addLocale", { tag: "de" }, development);
    await f.runTranslations();

    await f.tool("editBlock", { id: f.block.id, content: { title: "Welcome" } }, development);

    expect(f.translationJobs()).toEqual([
      expect.objectContaining({ entity: "block", entityId: f.block.id, locale: "de" }),
    ]);
    await f.runTranslations();
    expect((await f.blockIn("de", development)).block.content.title).toBe("Willkommen");
  });

  it("queues nothing when a localization is edited", async () => {
    const f = await fixture();
    await translatedDraft(f);

    await f.tool("editBlock", { id: f.block.id, content: { title: "Grüß Gott" }, locale: "de" });
    await call(
      router.pages.update,
      { id: f.page.id, pathSegment: "tarifs" },
      f.member({ ...f.inDraft, [LOCALE_HEADER]: "fr" }),
    );

    expect(f.translationJobs()).toEqual([]);
    expect(await titleIn(f, "fr")).toBe("Bonjour");
  });

  it("gives a new page a translated path in every locale, unique within the locale", async () => {
    const f = await fixture();
    await translatedDraft(f);
    // "prices" translates to the German path the pricing page already has.

    const created = async (pathSegment: string) =>
      (
        await call(
          router.pages.create,
          { projectId: f.projectId, pathSegment, layoutId: f.layout.layoutId },
          f.member(f.inDraft),
        )
      ).page;
    const team = await created("team");
    const prices = await created("prices");
    await f.runTranslations();

    const pathOf = async (id: string, locale: string) =>
      (await f.tool("getPage", { id, locale })).page.fullPath;
    expect(await pathOf(team.id, "de")).toBe("/mannschaft");
    expect(await pathOf(team.id, "fr")).toBe("/equipe");
    expect(await pathOf(prices.id, "de")).not.toBe("/preise");
    expect(await pathOf(prices.id, "de")).toMatch(/^\/preise/);
    expect((await f.tool("previewPublish")).blockers).not.toContainEqual(
      expect.objectContaining({ code: "duplicatePath" }),
    );
  });

  it("deletes a localization when its source is deleted", async () => {
    const f = await fixture();
    await translatedDraft(f);

    await f.tool("deleteBlock", { id: f.block.id });
    await f.runTranslations();

    const blocksIn = async (locale: string) =>
      (await f.tool("getPage", { id: f.page.id, locale })).blocks;
    expect(await blocksIn("de")).toEqual([]);
    expect(await blocksIn("fr")).toEqual([]);
  });
});

describe("a translation job", () => {
  it("shows its locale as translating until it finishes", async () => {
    const f = await fixture();
    await translatedDraft(f);
    const translating = async () =>
      (await call(router.drafts.get, { projectId: f.projectId }, f.member(f.inDraft)))
        .translatingLocales;
    expect(await translating()).toEqual([]);

    await f.tool("editBlock", { id: f.block.id, content: { title: "Welcome" } });
    expect(await translating()).toEqual(["de", "fr"]);

    await f.runTranslations();
    expect(await translating()).toEqual([]);
  });

  it("stops showing as translating when the model gives up, keeping the localization as it was", async () => {
    const f = await fixture();
    await translatedDraft(f);
    await f.tool("editBlock", { id: f.block.id, content: { title: "Welcome" } });

    answerEvery("translate", () => new AiCallError({ cause: "OpenRouter 503" }));
    await f.runTranslations();

    expect(
      (await call(router.drafts.get, { projectId: f.projectId }, f.member(f.inDraft)))
        .translatingLocales,
    ).toEqual([]);
    expect(await titleIn(f, "de")).toBe("Hallo");
  });

  it.each(["published", "discarded"] as const)(
    "does nothing once its draft was %s",
    async (outcome) => {
      const f = await fixture();
      await translatedDraft(f);
      await f.tool("editBlock", { id: f.block.id, content: { title: "Welcome" } });
      const jobs = f.translationJobs();

      if (outcome === "published") {
        const { token } = await f.tool("previewPublish");
        await f.tool("publishDraft", { token });
      } else {
        await call(router.drafts.discard, { projectId: f.projectId }, f.member(f.inDraft));
      }
      const asked = modelCalls().length;
      await f.runTranslations();

      expect(jobs).not.toEqual([]);
      expect(modelCalls()).toHaveLength(asked);
    },
  );

  it("does nothing once its development draft was published, which stays open", async () => {
    const f = await fixture();
    const development = { [DRAFT_HEADER]: DEVELOPMENT_DRAFT };
    translateWithDictionaries();
    await f.tool("addLocale", { tag: "de" }, development);
    await f.runTranslations();
    await f.tool("editBlock", { id: f.block.id, content: { title: "Welcome" } }, development);

    const { token } = await f.tool("previewPublish", {}, development);
    await f.tool("publishDraft", { token }, development);
    await f.runTranslations();

    // The development draft stays empty: it reads Live's German, as published.
    expect((await f.tool("previewPublish", {}, development)).changes).toEqual([]);
    expect((await f.blockIn("de", development)).block.content.title).toBe("Hallo");
  });
});
