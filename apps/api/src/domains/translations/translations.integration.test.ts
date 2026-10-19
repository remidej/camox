import {
  DEVELOPMENT_DRAFT,
  DRAFT_CREATE_HEADER,
  DRAFT_HEADER,
  LOCALE_HEADER,
} from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { queryKeys } from "@camox/api-contract/query-keys";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  createServiceContext,
  openDevelopmentDraft,
} from "../../../test/fixtures";
import {
  answerEvery,
  forgetScheduled,
  modelCalls,
  scheduled,
  scheduledFor,
} from "../../../test/generation";
import { forgetSent, refreshes, sentTo } from "../../../test/project-rooms";
import { isTranslationJob } from "../../lib/ai-job-queue";
import { runAiJob } from "../../lib/ai-jobs";
import { lexicalStateToMarkdown, markdownToLexicalState } from "../../lib/lexical-state";
import { AiCallError } from "../../lib/retry-ai-call";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import { files } from "../../schema";
import { upsertBlockDefinition } from "../block-definitions/service";
import { drafts } from "../drafts/schema";
import { draftOf } from "../drafts/scope";
import { requestTranslations } from "./service";

// Camox keeps every locale translated from the default locale (ADR 0015): adding a locale
// translates the website into it, and every write to the default locale in a draft is translated
// into the draft's other locales, merging with hand edits to localizations. The model's translations
// are scripted as a dictionary.

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
  first: "erster",
  pricing: "preise",
  team: "Mannschaft",
  about: "uber-uns",
  prices: "preise",
  tariffs: "preise",
  news: "neu",
  latest: "neu",
  // Slugs come back from the model as words, which a URL can't hold as they are.
  "hello-world": "Hallo Welt",
  "hi-world": "Hallo Welt",
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
          subtitle: { type: "string", fieldType: "String" },
          image: {
            type: "object",
            fieldType: "Image",
            properties: { _fileId: { type: "string" } },
          },
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
      settingsSchema: {
        properties: {
          size: { type: "string", enum: ["small", "medium", "large"], default: "medium" },
        },
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
            properties: {
              title: { type: "string", fieldType: "String" },
              slug: { type: "string", fieldType: "String" },
            },
            required: ["title", "slug"],
            additionalProperties: false,
          },
        },
      ],
    },
    { context: createRpcContext(db, null) },
  );
  // Article pages, found by the article's slug.
  await call(
    router.layouts.sync,
    {
      projectSlug,
      deployToken,
      autoCreate: false,
      layouts: [
        { layoutId: base.layout.layoutId, kind: "curated", description: "", blocks: [] },
        {
          layoutId: "articles.$slug",
          kind: "derived",
          description: "",
          blocks: [],
          recordPages: { collectionId: "articles", field: "slug" },
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
      content: {
        title: "Hello",
        subtitle: "Docs",
        variant: "dark",
        items: [{ label: "One" }],
      },
    },
    member(),
  );
  const record = await callSeedingLive(
    router.collectionDefinitions.createRecord,
    { projectSlug, collectionId: "articles", content: { title: "First", slug: "first" } },
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
    const jobs = scheduled().filter(isTranslationJob);
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
    expect(record.content).toEqual({ title: "Erster", slug: "erster" });
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

  it("requests each locale's page SEO once its translation is written, so it's generated from translated content", async () => {
    const f = await fixture();
    await translatedDraft(f);
    await f.tool("editBlock", { id: f.block.id, content: { title: "Welcome" } });
    const seoIn = () =>
      scheduledFor(f.page.id)
        .filter((job) => !isTranslationJob(job) && job.locale !== undefined)
        .map(({ locale }) => locale);
    forgetScheduled(f.page.id);
    expect(seoIn()).toEqual([]);

    await f.runTranslations();

    expect(seoIn()).toEqual(expect.arrayContaining(["de", "fr"]));
    expect(seoIn()).toHaveLength(2);
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

  it("gives two new pages whose paths translate alike different paths, though their jobs run at once", async () => {
    const f = await fixture();
    await translatedDraft(f);
    const created = async (pathSegment: string) =>
      (
        await call(
          router.pages.create,
          { projectId: f.projectId, pathSegment, layoutId: f.layout.layoutId },
          f.member(f.inDraft),
        )
      ).page;
    // Both translate to the German path the pricing page already has.
    const prices = await created("prices");
    const tariffs = await created("tariffs");

    const jobs = f.translationJobs().filter(({ locale }) => locale === "de");
    forgetScheduled(prices.id, tariffs.id);
    await Promise.all(jobs.map((job) => runService(runAiJob(f.db, job))));

    const paths = await Promise.all(
      [f.page.id, prices.id, tariffs.id].map(
        async (id) => (await f.tool("getPage", { id, locale: "de" })).page.fullPath,
      ),
    );
    expect(new Set(paths).size).toBe(3);
  });

  it("keeps the paths of a moved page's descendants unique within the locale", async () => {
    const f = await fixture();
    await translatedDraft(f);
    const created = async (pathSegment: string, parentPageId?: string) =>
      (
        await call(
          router.pages.create,
          { projectId: f.projectId, pathSegment, parentPageId, layoutId: f.layout.layoutId },
          f.member(f.inDraft),
        )
      ).page;
    const news = await created("news");
    const newsTeam = await created("team", news.id);
    const about = await created("about");
    const aboutTeam = await created("team", about.id);
    await f.runTranslations();
    // Removing the German news page by hand leaves its team page at /neu/mannschaft.
    await call(
      router.pages.delete,
      { id: news.id },
      f.member({ ...f.inDraft, [LOCALE_HEADER]: "de" }),
    );

    // "latest" translates to the German path the news page had.
    await call(router.pages.update, { id: about.id, pathSegment: "latest" }, f.member(f.inDraft));
    // The team page's own job runs first, before its parent's moves it.
    const jobs = f.translationJobs().filter(({ locale }) => locale === "de");
    forgetScheduled(about.id, aboutTeam.id);
    for (const job of jobs.sort((a) => (a.entityId === aboutTeam.id ? -1 : 1))) {
      await runService(runAiJob(f.db, job));
    }

    const pathOf = async (id: string) =>
      (await f.tool("getPage", { id, locale: "de" })).page.fullPath;
    expect(await pathOf(about.id)).toBe("/neu");
    expect(await pathOf(newsTeam.id)).toBe("/neu/mannschaft");
    expect(await pathOf(aboutTeam.id)).not.toBe("/neu/mannschaft");
    expect(await pathOf(aboutTeam.id)).toMatch(/^\/neu\//);
  });

  it("translates a record's slug as a URL segment, unique within the locale", async () => {
    const f = await fixture();
    await translatedDraft(f);
    const created = async (slug: string) =>
      call(
        router.collectionDefinitions.createRecord,
        { projectSlug: f.projectSlug, collectionId: "articles", content: { title: "Hello", slug } },
        f.member(f.inDraft),
      );
    // Both slugs translate to the same words.
    const hello = await created("hello-world");
    const hi = await created("hi-world");
    await f.runTranslations();

    const slugOf = async (id: string) =>
      (await f.tool("getCollectionRecord", { collectionId: "articles", id, locale: "de" })).content
        .slug;
    const slugs = [await slugOf(hello.id), await slugOf(hi.id)];
    expect(slugs).toContain("hallo-welt");
    expect(new Set(slugs).size).toBe(2);
    for (const slug of slugs) expect(slug).toMatch(/^hallo-welt(-\d+)?$/);
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

  it("tells the draft's viewers and the drafts list when it settles, even having written nothing", async () => {
    const f = await fixture();
    await translatedDraft(f);
    await f.tool("editBlock", { id: f.block.id, content: { title: "Welcome" } });
    answerEvery("translate", () => new AiCallError({ cause: "OpenRouter 503" }));

    forgetSent(f.projectId);
    await f.runTranslations();

    const sent = sentTo(f.projectId);
    expect(refreshes(sent, f.draft, [...queryKeys.drafts.get, f.draft])).toBe(true);
    expect(refreshes(sent, null, [...queryKeys.drafts.list, f.projectId])).toBe(true);
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

describe("hand edits to a localization", () => {
  it("keeps a hand-edited field when the source changes another field, which is retranslated", async () => {
    const f = await fixture();
    await translatedDraft(f);

    await call(
      router.blocks.updateContent,
      { id: f.block.id, content: { subtitle: "Handbuch" } },
      f.member({ ...f.inDraft, [LOCALE_HEADER]: "de" }),
    );
    await f.tool("editBlock", { id: f.block.id, content: { title: "Welcome" } });
    await f.runTranslations();

    expect((await f.blockIn("de")).block.content).toMatchObject({
      title: "Willkommen",
      subtitle: "Handbuch",
    });
  });

  it("merges a field both the source and the localization changed with the model, writing its answer", async () => {
    const f = await fixture();
    await translatedDraft(f);
    answerEvery("merge", ({ texts }) =>
      Object.fromEntries(texts.map(({ key }) => [key, "Herzlich willkommen, Freunde"])),
    );

    await f.tool("editBlock", {
      id: f.block.id,
      content: { title: "Hallo Freunde" },
      locale: "de",
    });
    await f.tool("editBlock", { id: f.block.id, content: { title: "Welcome" } });
    await f.runTranslations();

    const merges = modelCalls().filter(({ method }) => method === "merge");
    expect(merges).toEqual([
      {
        method: "merge",
        request: {
          from: "en",
          to: "de",
          texts: [
            {
              key: "title",
              format: "plain",
              previousSource: "Hello",
              previousTranslation: "Hallo",
              source: "Welcome",
              current: "Hallo Freunde",
            },
          ],
        },
      },
    ]);
    expect(await titleIn(f, "de")).toBe("Herzlich willkommen, Freunde");
    // French wasn't edited by hand: it follows the source.
    expect(await titleIn(f, "fr")).toBe("Bienvenue");
  });

  it("keeps treating a field as edited by hand through later source changes, merged or not", async () => {
    const f = await fixture();
    await translatedDraft(f);
    answerEvery("merge", ({ texts }) =>
      Object.fromEntries(texts.map(({ key, current }) => [key, `${current}!`])),
    );
    await f.tool("editBlock", { id: f.block.id, content: { subtitle: "Handbuch" }, locale: "de" });
    await f.tool("editBlock", { id: f.block.id, content: { title: "Hallo Leute" }, locale: "de" });

    // The title is merged, the subtitle kept.
    await f.tool("editBlock", { id: f.block.id, content: { title: "Welcome" } });
    await f.runTranslations();
    // Both change again in the source.
    await f.tool("editBlock", { id: f.block.id, content: { title: "Hello", subtitle: "One" } });
    await f.runTranslations();

    const germanMerges = modelCalls().flatMap((call) =>
      call.method === "merge" && call.request.to === "de" ? [call.request.texts] : [],
    );
    expect(germanMerges.at(-1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "title",
          previousSource: "Welcome",
          previousTranslation: "Willkommen",
          current: "Hallo Leute!",
        }),
        expect.objectContaining({
          key: "subtitle",
          previousSource: "Docs",
          previousTranslation: "Dokumentation",
          current: "Handbuch",
        }),
      ]),
    );
    expect((await f.blockIn("de")).block.content).toMatchObject({
      title: "Hallo Leute!!",
      subtitle: "Handbuch!",
    });
  });

  it("merges rich text paragraph by paragraph, keeping a hand-edited paragraph and retranslating a changed one", async () => {
    const f = await fixture();
    await translatedDraft(f);
    await f.tool("editBlock", {
      id: f.block.id,
      content: { subtitle: JSON.stringify(markdownToLexicalState("Hello\n\nOne")) },
    });
    await f.runTranslations();
    await f.tool("editBlock", {
      id: f.block.id,
      content: { subtitle: JSON.stringify(markdownToLexicalState("Grüß Gott\n\nEins")) },
      locale: "de",
    });

    await f.tool("editBlock", {
      id: f.block.id,
      content: { subtitle: JSON.stringify(markdownToLexicalState("Hello\n\nTwo")) },
    });
    await f.runTranslations();

    expect(lexicalStateToMarkdown((await f.blockIn("de")).block.content.subtitle).trim()).toBe(
      "Grüß Gott\n\nZwei",
    );
    expect(modelCalls().some(({ method }) => method === "merge")).toBe(false);
  });

  it("merges rich text whose paragraphs no longer line up as a whole with the model, writing its answer", async () => {
    const f = await fixture();
    await translatedDraft(f);
    await f.tool("editBlock", {
      id: f.block.id,
      content: { subtitle: JSON.stringify(markdownToLexicalState("Hello\n\nOne")) },
    });
    await f.runTranslations();
    // The hand edit joins the two paragraphs into one.
    await f.tool("editBlock", {
      id: f.block.id,
      content: { subtitle: JSON.stringify(markdownToLexicalState("Grüß Gott, eins")) },
      locale: "de",
    });
    answerEvery("merge", ({ texts }) =>
      Object.fromEntries(texts.map(({ key }) => [key, "Grüß Gott, **zwei**"])),
    );

    await f.tool("editBlock", {
      id: f.block.id,
      content: { subtitle: JSON.stringify(markdownToLexicalState("Hello\n\nTwo")) },
    });
    await f.runTranslations();

    const merges = modelCalls().flatMap((call) => (call.method === "merge" ? [call.request] : []));
    expect(merges).toEqual([
      {
        from: "en",
        to: "de",
        texts: [
          {
            key: "subtitle",
            format: "markdown",
            previousSource: "Hello\n\nOne",
            previousTranslation: "Hallo\n\nEins",
            source: "Hello\n\nTwo",
            current: "Grüß Gott, eins",
          },
        ],
      },
    ]);
    expect(lexicalStateToMarkdown((await f.blockIn("de")).block.content.subtitle)).toBe(
      "Grüß Gott, **zwei**",
    );
  });

  it("sends the model only the source fields that changed", async () => {
    const f = await fixture();
    await translatedDraft(f);
    const asked = modelCalls().length;

    await f.tool("editBlock", { id: f.block.id, content: { title: "Welcome" } });
    await f.runTranslations();

    const calls = modelCalls().slice(asked);
    expect(calls.map(({ method }) => method)).toEqual(["translate", "translate"]);
    for (const { request } of calls) {
      expect(request).toMatchObject({ texts: [{ key: "title", text: "Welcome" }] });
    }
    expect((await f.blockIn("de")).block.content).toMatchObject({
      title: "Willkommen",
      subtitle: "Dokumentation",
    });
  });

  it("carries a changed block setting over to localizations that didn't change it, without the model, and keeps it where one did", async () => {
    const f = await fixture();
    await translatedDraft(f);
    await call(
      router.blocks.updateSettings,
      { id: f.block.id, settings: { size: "small" } },
      f.member({ ...f.inDraft, [LOCALE_HEADER]: "fr" }),
    );
    const asked = modelCalls().length;

    await call(
      router.blocks.updateSettings,
      { id: f.block.id, settings: { size: "large" } },
      f.member(f.inDraft),
    );
    await f.tool("editBlock", { id: f.block.id, content: { variant: "light" } });
    await f.runTranslations();

    expect(modelCalls().slice(asked)).toEqual([]);
    const german = (await f.blockIn("de")).block;
    expect(german.settings).toEqual({ size: "large" });
    expect(german.content.variant).toBe("light");
    const french = (await f.blockIn("fr")).block;
    expect(french.settings).toEqual({ size: "small" });
    // A value the localization didn't change follows the source.
    expect(french.content.variant).toBe("light");
  });

  it("keeps a different image picked in a localization when the source changes", async () => {
    const f = await fixture();
    await translatedDraft(f);
    const image = async (name: string) => {
      const now = Date.now();
      const file = await f.db
        .insert(files)
        .values({
          projectId: f.projectId,
          url: `http://localhost/files/serve/${name}.png`,
          mimeType: "image/png",
          size: 68,
          blobId: crypto.randomUUID(),
          path: "/",
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      return { _fileId: file.id };
    };
    const [team, berlin, office] = [
      await image("team"),
      await image("berlin"),
      await image("office"),
    ];
    await f.tool("editBlock", { id: f.block.id, content: { image: team } });
    await f.runTranslations();
    await f.tool("editBlock", { id: f.block.id, content: { image: berlin }, locale: "de" });

    await f.tool("editBlock", { id: f.block.id, content: { image: office, title: "Welcome" } });
    await f.runTranslations();

    expect((await f.blockIn("de")).block.content).toMatchObject({
      image: berlin,
      title: "Willkommen",
    });
    expect((await f.blockIn("fr")).block.content).toMatchObject({ image: office });
  });

  it("keeps a page's SEO all manual when the source makes it generated again after a localization changed one of its fields", async () => {
    const f = await fixture();
    await translatedDraft(f);
    await call(
      router.pages.setSeo,
      { id: f.page.id, metaTitle: "Hello", metaDescription: "Welcome" },
      f.member(f.inDraft),
    );
    await f.runTranslations();
    await call(
      router.pages.setSeo,
      { id: f.page.id, metaDescription: "Unsere Preise" },
      f.member({ ...f.inDraft, [LOCALE_HEADER]: "de" }),
    );

    await call(router.pages.setSeo, { id: f.page.id, aiSeo: true }, f.member(f.inDraft));
    await f.runTranslations();

    expect(await f.pageIn("de")).toMatchObject({
      metaTitle: "Hallo",
      metaDescription: "Unsere Preise",
    });
    // French didn't change its SEO: it follows the source back to generated.
    expect(await f.pageIn("fr")).toMatchObject({ metaTitle: null, metaDescription: null });
  });

  it("keeps a hand edit published to Live when a later draft changes the source", async () => {
    const f = await fixture();
    await translatedDraft(f);
    await f.tool("editBlock", { id: f.block.id, content: { subtitle: "Handbuch" }, locale: "de" });
    const { token } = await f.tool("previewPublish");
    await f.tool("publishDraft", { token });

    const later = { [DRAFT_HEADER]: generateUuidv7(), [DRAFT_CREATE_HEADER]: "1" };
    await f.tool("editBlock", { id: f.block.id, content: { title: "Welcome" } }, later);
    await f.runTranslations();

    expect((await f.blockIn("de", later)).block.content).toMatchObject({
      title: "Willkommen",
      subtitle: "Handbuch",
    });
  });
});

describe("a localization's bookkeeping", () => {
  it("is never a change or a conflict, when a source change leaves the localization as it was", async () => {
    const f = await fixture();
    await translatedDraft(f);
    await call(
      router.blocks.updateSettings,
      { id: f.block.id, settings: { size: "small" } },
      f.member({ ...f.inDraft, [LOCALE_HEADER]: "fr" }),
    );
    const { token } = await f.tool("previewPublish");
    await f.tool("publishDraft", { token });

    // A draft changes a setting French changed by hand: French stays as it is.
    const draft = generateUuidv7();
    await call(
      router.blocks.updateSettings,
      { id: f.block.id, settings: { size: "large" } },
      f.member({ [DRAFT_HEADER]: draft, [DRAFT_CREATE_HEADER]: "1" }),
    );
    await f.runTranslations();
    // Meanwhile, another draft publishes a hand edit to French.
    const other = { [DRAFT_HEADER]: generateUuidv7(), [DRAFT_CREATE_HEADER]: "1" };
    await f.tool(
      "editBlock",
      { id: f.block.id, content: { subtitle: "Mode d'emploi" }, locale: "fr" },
      other,
    );
    const published = await f.tool("previewPublish", {}, other);
    await f.tool("publishDraft", { token: published.token }, other);

    const preview = await f.tool("previewPublish", {}, { [DRAFT_HEADER]: draft });
    expect(preview.conflicts).toEqual([]);
    // German follows the source as Camox wrote it, so only the source change is listed.
    expect(preview.changes.map(({ locale }: { locale: string | null }) => locale)).toEqual(["en"]);
    expect((await f.blockIn("fr", { [DRAFT_HEADER]: draft })).block).toMatchObject({
      settings: { size: "small" },
      content: { subtitle: "Mode d'emploi" },
    });
  });
});

describe("the review and the change count", () => {
  type Listed = { entity: string; id: string; locale: string | null; change: string };

  /** What `f`'s draft lists for review, and the count its summary shows. */
  async function review(f: Awaited<ReturnType<typeof fixture>>, headers: Headers = f.inDraft) {
    const { changes } = await f.tool("previewPublish", {}, headers);
    const { changeCount } = await call(
      router.drafts.get,
      { projectId: f.projectId },
      f.member(headers),
    );
    return {
      changes: (changes as Listed[]).map(({ entity, id, locale, change }) => ({
        entity,
        id,
        locale,
        change,
      })),
      changeCount,
    };
  }

  /** `f` with German and French on Live, and a new draft opened. */
  async function translatedLive(f: Awaited<ReturnType<typeof fixture>>) {
    await translatedDraft(f);
    const { token } = await f.tool("previewPublish");
    await f.tool("publishDraft", { token });
    const draft = generateUuidv7();
    return {
      starting: { [DRAFT_HEADER]: draft, [DRAFT_CREATE_HEADER]: "1" },
      inDraft: { [DRAFT_HEADER]: draft },
    };
  }

  it("counts a change to one source block as one change, in a draft with three locales", async () => {
    const f = await fixture();
    const next = await translatedLive(f);

    await f.tool("editBlock", { id: f.block.id, content: { title: "Welcome" } }, next.starting);
    await f.runTranslations();

    expect(await f.blockIn("de", next.inDraft)).toMatchObject({
      block: { content: { title: "Willkommen" } },
    });
    expect(await review(f, next.inDraft)).toEqual({
      changes: [{ entity: "block", id: f.block.id, locale: "en", change: "changed" }],
      changeCount: 1,
    });
  });

  it("lists a hand edit to a localization under its locale", async () => {
    const f = await fixture();
    const next = await translatedLive(f);

    await f.tool(
      "editBlock",
      { id: f.block.id, content: { title: "Grüß Gott" }, locale: "de" },
      next.starting,
    );
    await f.runTranslations();

    expect(await review(f, next.inDraft)).toEqual({
      changes: [{ entity: "block", id: f.block.id, locale: "de", change: "changed" }],
      changeCount: 1,
    });
  });

  it("keeps listing a hand edit to a localization after its source changes", async () => {
    const f = await fixture();
    const next = await translatedLive(f);

    await f.tool(
      "editBlock",
      { id: f.block.id, content: { subtitle: "Handbuch" }, locale: "de" },
      next.starting,
    );
    await f.tool("editBlock", { id: f.block.id, content: { title: "Welcome" } }, next.inDraft);
    await f.runTranslations();

    const { changes, changeCount } = await review(f, next.inDraft);
    expect(changes.map(({ locale }) => locale).sort((a, b) => a!.localeCompare(b!))).toEqual([
      "de",
      "en",
    ]);
    expect(changeCount).toBe(2);
  });

  it("lists adding a locale as one change, before and after Camox translates into it", async () => {
    const f = await fixture();
    translateWithDictionaries();

    await f.tool("addLocale", { tag: "de" }, f.starting);
    const added = [{ entity: "locale", id: expect.any(String), locale: null, change: "created" }];
    expect(await review(f)).toEqual({ changes: added, changeCount: 1 });
    // The locale is named by its tag.
    expect((await f.tool("previewPublish")).changes).toEqual([
      expect.objectContaining({ entity: "locale", label: "de" }),
    ]);

    await f.runTranslations();
    expect(await f.blockIn("de")).toMatchObject({ block: { content: { title: "Hallo" } } });
    expect(await review(f)).toEqual({ changes: added, changeCount: 1 });
  });

  it("lists removing a locale as one change", async () => {
    const f = await fixture();
    const next = await translatedLive(f);

    await f.tool("removeLocale", { tag: "fr" }, next.starting);

    expect(await review(f, next.inDraft)).toEqual({
      changes: [{ entity: "locale", id: expect.any(String), locale: null, change: "deleted" }],
      changeCount: 1,
    });
  });

  it("leaves out the localizations Camox deletes with their source", async () => {
    const f = await fixture();
    const next = await translatedLive(f);

    await f.tool("deleteBlock", { id: f.block.id }, next.starting);
    await f.runTranslations();

    const { changes, changeCount } = await review(f, next.inDraft);
    expect(changes).toContainEqual({
      entity: "block",
      id: f.block.id,
      locale: "en",
      change: "deleted",
    });
    expect(changes.filter(({ locale }) => locale !== "en")).toEqual([]);
    expect(changeCount).toBe(changes.length);
  });

  it("lists content placed in one locale only under that locale", async () => {
    const f = await fixture();
    const next = await translatedLive(f);

    const placed = await call(
      router.blocks.create,
      { pageId: f.page.id, type: "hero", content: { title: "Nur auf Deutsch" } },
      f.member({ ...next.starting, [LOCALE_HEADER]: "de" }),
    );
    await f.runTranslations();

    const { changes, changeCount } = await review(f, next.inDraft);
    expect(changes).toContainEqual(
      expect.objectContaining({ entity: "block", id: placed.id, locale: "de" }),
    );
    expect(changes.every(({ locale }) => locale === "de")).toBe(true);
    expect(changeCount).toBe(changes.length);
  });
});

describe("placing a block in a locale", () => {
  /**
   * `f`'s draft in German, with a banner definition whose defaults the dictionary translates, and
   * a synced notice definition with the same defaults, placed nowhere yet.
   */
  async function germanDraft(f: Awaited<ReturnType<typeof fixture>>) {
    for (const [blockId, synced] of [
      ["banner", false],
      ["notice", true],
    ] as const) {
      await runService(
        upsertBlockDefinition(createServiceContext(f.db, null), {
          projectSlug: f.projectSlug,
          deployToken: f.project.deployToken,
          blockId,
          title: blockId,
          description: blockId,
          synced,
          contentSchema: {
            type: "object",
            properties: {
              title: { type: "string", fieldType: "String", default: "Hello" },
              subtitle: { type: "string", fieldType: "String", default: "Welcome" },
              variant: {
                type: "string",
                fieldType: "Enum",
                enum: ["light", "dark"],
                default: "dark",
              },
              items: {
                type: "array",
                fieldType: "Repeater",
                minItems: 1,
                items: {
                  type: "object",
                  properties: { label: { type: "string", fieldType: "String", default: "One" } },
                },
              },
            },
            toMarkdown: ["# {{title}}"],
          },
        }),
      );
    }
    translateWithDictionaries();
    await f.tool("addLocale", { tag: "de" }, f.starting);
    await f.runTranslations();
  }

  /** Places a block, a banner unless told otherwise, with its defaults, as the studio does. */
  const place = async (f: Awaited<ReturnType<typeof fixture>>, locale?: string, type = "banner") =>
    call(
      router.blocks.create,
      { pageId: f.page.id, type, content: { title: "Hello", subtitle: "Welcome" } },
      f.member(locale ? { ...f.inDraft, [LOCALE_HEADER]: locale } : f.inDraft),
    );

  it("translates the block's defaults into the page's locale", async () => {
    const f = await fixture();
    await germanDraft(f);

    const placed = await place(f, "de");
    expect(f.translationJobs()).toEqual([
      expect.objectContaining({ entity: "block", entityId: placed.id, locale: "de" }),
    ]);
    await f.runTranslations();

    const german = await f.tool("getBlock", { id: placed.id, locale: "de" });
    expect(german.block.content).toMatchObject({
      title: "Hallo",
      subtitle: "Willkommen",
      variant: "dark",
    });
    expect(german.repeatableItems).toEqual([
      expect.objectContaining({ content: { label: "Eins" } }),
    ]);
  });

  it("keeps a field edited before the translation finishes", async () => {
    const f = await fixture();
    await germanDraft(f);
    const placed = await place(f, "de");

    // A word the dictionary would translate, so translating the edit would show.
    await f.tool("editBlock", { id: placed.id, content: { title: "Docs" }, locale: "de" });
    await f.runTranslations();

    const german = await f.tool("getBlock", { id: placed.id, locale: "de" });
    expect(german.block.content).toMatchObject({ title: "Docs", subtitle: "Willkommen" });
  });

  it("queues no translation of its defaults when placed in the default locale", async () => {
    const f = await fixture();
    await germanDraft(f);

    const placed = await place(f);

    // Like any write to the default locale, the block is translated into German, from itself.
    const jobsOfBlock = f.translationJobs().filter(({ entityId }) => entityId === placed.id);
    expect(jobsOfBlock).toEqual([
      {
        kind: "translation",
        entity: "block",
        entityId: placed.id,
        locale: "de",
        draftId: f.draft,
        delayMs: expect.any(Number),
      },
    ]);
  });

  it("translates the defaults of the shared content a synced block creates in the locale", async () => {
    const f = await fixture();
    await germanDraft(f);

    const placed = await place(f, "de", "notice");
    await f.runTranslations();

    const german = await f.tool("getBlock", { id: placed.id, locale: "de" });
    expect(german.block.content).toMatchObject({ title: "Hallo", subtitle: "Willkommen" });
    expect(german.repeatableItems).toEqual([
      expect.objectContaining({ content: { label: "Eins" } }),
    ]);
  });

  it("leaves a synced block's shared content alone when it already exists in the locale", async () => {
    const f = await fixture();
    await germanDraft(f);
    const first = await place(f, "de", "notice");
    await f.runTranslations();
    // Back to a default, which a translation of the defaults would translate again.
    await f.tool("editBlock", { id: first.id, content: { title: "Hello" }, locale: "de" });

    const second = await place(f, "de", "notice");
    await f.runTranslations();

    const german = await f.tool("getBlock", { id: second.id, locale: "de" });
    expect(german.block.content).toMatchObject({ title: "Hello", subtitle: "Willkommen" });
  });

  it("translates the defaults of a copy made before the original's were translated", async () => {
    const f = await fixture();
    await germanDraft(f);
    const placed = await place(f, "de");

    const copy = await call(
      router.blocks.duplicate,
      { id: placed.id },
      f.member({ ...f.inDraft, [LOCALE_HEADER]: "de" }),
    );
    await f.runTranslations();

    const german = await f.tool("getBlock", { id: copy.id, locale: "de" });
    expect(german.block.content).toMatchObject({ title: "Hallo", subtitle: "Willkommen" });
  });

  it("settles a translation of a block's defaults apart from a translation of the block", async () => {
    const f = await fixture();
    await germanDraft(f);
    const row = await f.db.select().from(drafts).where(eq(drafts.id, f.draft)).get();
    await f.tool("editBlock", { id: f.block.id, content: { title: "Welcome" } });
    await runService(
      requestTranslations(f.db, draftOf(row!), [{ entity: "block", id: f.block.id }], ["de"], {
        source: "defaults",
      }),
    );

    const defaults = f
      .translationJobs()
      .find((job) => isTranslationJob(job) && job.source === "defaults");
    await runService(runAiJob(f.db, defaults!));

    // The translation of the block's edit is still pending.
    const { translatingLocales } = await call(
      router.drafts.get,
      { projectId: f.projectId },
      f.member(f.inDraft),
    );
    expect(translatingLocales).toEqual(["de"]);
  });
});
