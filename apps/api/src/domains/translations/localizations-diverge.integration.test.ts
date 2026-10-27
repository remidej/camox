import { DRAFT_CREATE_HEADER, DRAFT_HEADER, LOCALE_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { describe, expect, it } from "vite-plus/test";

import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  syncDefinitionSet,
} from "../../../test/fixtures";
import { answerEvery, forgetScheduled, scheduled } from "../../../test/generation";
import { isTranslationJob } from "../../lib/ai-job-queue";
import { runAiJob } from "../../lib/ai-jobs";
import { runService } from "../../lib/run-service";
import { router } from "../../router";

// Localizations can differ from the default locale in structure on purpose (ADR 0015): content
// added in a locale exists only there, a localization deleted from a locale stays deleted through
// source changes, and deleting a default-locale entity takes its localizations along.

type Headers = Record<string, string>;
type ToolResponse =
  | { ok: true; result: any }
  | { ok: false; error: { code: string; message: string } };

const GERMAN: Record<string, string> = {
  Hello: "Hallo",
  Welcome: "Willkommen",
  One: "Eins",
  hello: "hallo",
};

/**
 * A project with, on Live in the default locale, a page holding a block with a repeatable item,
 * and a collection record, and a draft translating it into German and French.
 */
async function fixture() {
  const base = await createProjectFixture(`diverge-${crypto.randomUUID()}`);
  const { db, project, memberUser } = base;
  const projectId = project.id;
  const projectUuid = project.uuid;
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
              items: {
                type: "object",
                properties: { label: { type: "string", fieldType: "String" } },
              },
            },
          },
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
          additionalProperties: false,
        },
      },
    ],
  });

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
    { pageId: page.id, type: "hero", content: { title: "Hello", items: [{ label: "One" }] } },
    member(),
  );
  const record = await callSeedingLive(
    router.collectionDefinitions.createRecord,
    { projectUuid, collectionId: "articles", content: { title: "Hello" } },
    member(),
  );

  const inDraft: Headers = { [DRAFT_HEADER]: generateUuidv7() };
  const tool = async (name: string, args: object = {}, headers: Headers = inDraft) => {
    const response = (await call(
      router.agent.callTool,
      { projectId, name, arguments: args },
      member(headers),
    )) as ToolResponse;
    if (!response.ok) throw new Error(`${name} failed: ${JSON.stringify(response.error)}`);
    return response.result;
  };
  /** Runs every translation job scheduled so far, as their alarms would, and forgets them. */
  const runTranslations = async () => {
    const jobs = scheduled().filter(isTranslationJob);
    const keyed = new Map(jobs.map((job) => [JSON.stringify({ ...job, delayMs: 0 }), job]));
    forgetScheduled(...jobs.map((job) => job.entityId));
    for (const job of keyed.values()) await runService(runAiJob(db, job));
  };
  /** Publishes the draft `headers` name. */
  const publish = async (headers: Headers = inDraft) => {
    const { token } = await tool("previewPublish", {}, headers);
    expect(await tool("publishDraft", { token }, headers)).toMatchObject({ published: true });
  };
  /** A new draft, created by its first request. */
  const newDraft = () => {
    const id = generateUuidv7();
    return {
      starting: { [DRAFT_HEADER]: id, [DRAFT_CREATE_HEADER]: "1" } as Headers,
      inDraft: { [DRAFT_HEADER]: id } as Headers,
    };
  };
  /** The ids of the blocks on a page in a locale. */
  const blocksOn = async (pageId: string, locale?: string, headers: Headers = inDraft) =>
    ((await tool("getPage", { id: pageId, locale }, headers)).blocks as { id: string }[]).map(
      ({ id }) => id,
    );
  const pagesIn = async (locale?: string, headers: Headers = inDraft) =>
    ((await tool("listPages", { locale }, headers)) as { id: string }[]).map(({ id }) => id);
  const recordsIn = async (locale?: string, headers: Headers = inDraft) =>
    (
      (await tool("listCollectionRecords", { collectionId: "articles", locale }, headers)) as {
        id: string;
      }[]
    ).map(({ id }) => id);
  const titleIn = async (locale: string, headers: Headers = inDraft) =>
    (await tool("getBlock", { id: block.id, locale }, headers)).block.content.title;

  answerEvery("translate", ({ to, texts }) =>
    Object.fromEntries(
      texts.map(({ key, text }) => [key, to === "de" ? (GERMAN[text] ?? text) : text]),
    ),
  );
  await tool("addLocale", { tag: "de" }, { ...inDraft, [DRAFT_CREATE_HEADER]: "1" });
  await tool("addLocale", { tag: "fr" });
  await runTranslations();

  return {
    ...base,
    projectId,
    projectUuid,
    member,
    page,
    block,
    record,
    inDraft,
    tool,
    runTranslations,
    publish,
    newDraft,
    blocksOn,
    pagesIn,
    recordsIn,
    titleIn,
  };
}

describe("deleting a localization", () => {
  it("keeps a block deleted from a locale deleted when its original changes, even after publishing", async () => {
    const f = await fixture();
    await f.tool("deleteBlock", { id: f.block.id, locale: "de" });

    await f.tool("editBlock", { id: f.block.id, content: { title: "Welcome" } });
    await f.runTranslations();
    expect(await f.blocksOn(f.page.id, "de")).toEqual([]);
    expect(await f.titleIn("fr")).toBe("Welcome");

    await f.publish();
    expect(await f.blocksOn(f.page.id, "de", {})).toEqual([]);
    const later = f.newDraft();
    await f.tool("editBlock", { id: f.block.id, content: { title: "Hello" } }, later.starting);
    await f.runTranslations();
    expect(await f.blocksOn(f.page.id, "de", later.inDraft)).toEqual([]);
    expect(await f.blocksOn(f.page.id, "en", later.inDraft)).toEqual([f.block.id]);
  });

  it("keeps what's beneath a page deleted from a locale out of it when its originals change", async () => {
    const f = await fixture();
    await f.tool("deletePage", { id: f.page.id, locale: "de" });
    await f.publish();

    const later = f.newDraft();
    await f.tool("editBlock", { id: f.block.id, content: { title: "Welcome" } }, later.starting);
    await f.tool("updatePage", { id: f.page.id, pathSegment: "prices" }, later.inDraft);
    await f.runTranslations();

    expect(await f.pagesIn("de", later.inDraft)).toEqual([]);
    const preview = await f.tool("previewPublish", {}, later.inDraft);
    expect(preview.changes.map(({ locale }: { locale: string }) => locale)).not.toContain("de");
    expect(preview.lost).toEqual([]);
    expect(await f.titleIn("fr", later.inDraft)).toBe("Welcome");
  });

  it("keeps a repeatable item deleted from a locale deleted when its original changes", async () => {
    const f = await fixture();
    const itemsIn = async (locale: string) =>
      (await f.tool("getBlock", { id: f.block.id, locale })).repeatableItems as {
        id: string;
        content: { label: string };
      }[];
    const [item] = await itemsIn("de");
    await call(
      router.repeatableItems.delete,
      { id: item!.id },
      f.member({ ...f.inDraft, [LOCALE_HEADER]: "de" }),
    );

    await call(
      router.repeatableItems.updateContent,
      { id: item!.id, content: { label: "Hello" } },
      f.member(f.inDraft),
    );
    await f.runTranslations();

    expect(await itemsIn("de")).toEqual([]);
    expect((await itemsIn("fr")).map(({ content }) => content.label)).toEqual(["Hello"]);
  });

  it("keeps a record deleted from a locale deleted when its original changes", async () => {
    const f = await fixture();
    await f.tool("deleteCollectionRecord", {
      collectionId: "articles",
      id: f.record.id,
      locale: "de",
    });

    await f.tool("editCollectionRecord", {
      collectionId: "articles",
      id: f.record.id,
      content: { title: "Welcome" },
    });
    await f.runTranslations();

    expect(await f.recordsIn("de")).toEqual([]);
    expect(await f.recordsIn("fr")).toEqual([f.record.id]);
  });

  it("keeps a block out of a locale its page is deleted from while the block translates", async () => {
    const f = await fixture();
    await f.publish();
    const later = f.newDraft();
    const added = await call(
      router.blocks.create,
      { pageId: f.page.id, type: "hero", content: { title: "Welcome", items: [] } },
      f.member(later.starting),
    );

    let deleting: Promise<unknown> | undefined;
    answerEvery("translate", async ({ to, texts }) => {
      if (to === "de") {
        deleting ??= f.tool("deletePage", { id: f.page.id, locale: "de" }, later.inDraft);
        await deleting;
      }
      return Object.fromEntries(texts.map(({ key, text }) => [key, GERMAN[text] ?? text]));
    });
    await f.runTranslations();

    expect(deleting).toBeDefined();
    const preview = await f.tool("previewPublish", {}, later.inDraft);
    expect(
      preview.changes.filter(
        ({ id, locale }: { id: string; locale: string }) => id === added.id && locale === "de",
      ),
    ).toEqual([]);
    expect(preview.lost).toEqual([]);
  });

  it("is a change in its locale, which publishing keeps on Live", async () => {
    const f = await fixture();
    await f.publish();

    const later = f.newDraft();
    await f.tool("deleteBlock", { id: f.block.id, locale: "de" }, later.starting);
    const preview = await f.tool("previewPublish", {}, later.inDraft);
    expect(preview.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entity: "block", id: f.block.id, locale: "de" }),
        expect.objectContaining({ entity: "exclusion", id: f.block.id, locale: "de" }),
      ]),
    );
    expect(preview.changes).toHaveLength(2);
    await f.publish(later.inDraft);

    // The next draft holds no change, and its source changes don't bring the block back.
    const next = f.newDraft();
    await f.tool("editBlock", { id: f.block.id, content: { title: "Welcome" } }, next.starting);
    await f.runTranslations();
    expect(await f.blocksOn(f.page.id, "de", next.inDraft)).toEqual([]);
    const nextPreview = await f.tool("previewPublish", {}, next.inDraft);
    expect(nextPreview.changes.filter(({ locale }: { locale: string }) => locale === "de")).toEqual(
      [],
    );
  });
});

describe("the content missing from a locale", () => {
  it("lists a page deleted from a locale, without what's beneath it, and adds it back translated", async () => {
    const f = await fixture();
    const { page: child } = await f.tool("createPage", {
      pathSegment: "team",
      parentPageId: f.page.id,
      layoutId: f.layout.layoutId,
    });
    await f.runTranslations();
    await f.tool("deletePage", { id: child.id, locale: "de" });
    await f.tool("deletePage", { id: f.page.id, locale: "de" });
    await f.publish();

    const later = f.newDraft();
    await f.tool("editBlock", { id: f.block.id, content: { title: "Welcome" } }, later.starting);
    await f.runTranslations();
    expect(await f.tool("listMissingFromLocale", { locale: "de" }, later.inDraft)).toEqual({
      pages: [expect.objectContaining({ id: f.page.id, fullPath: "/pricing" })],
      records: [],
    });
    expect(await f.tool("listMissingFromLocale", { locale: "fr" }, later.inDraft)).toEqual({
      pages: [],
      records: [],
    });

    await f.tool("addBackToLocale", { entity: "page", id: f.page.id, locale: "de" }, later.inDraft);
    await f.runTranslations();
    expect(await f.titleIn("de", later.inDraft)).toBe("Willkommen");
    expect(
      (await f.tool("getBlock", { id: f.block.id, locale: "de" }, later.inDraft)).repeatableItems,
    ).toEqual([expect.objectContaining({ content: { label: "Eins" } })]);
    // The child page was deleted from the locale on its own: it's missing now.
    expect(await f.pagesIn("de", later.inDraft)).toEqual([f.page.id]);
    expect(await f.tool("listMissingFromLocale", { locale: "de" }, later.inDraft)).toEqual({
      pages: [expect.objectContaining({ id: child.id })],
      records: [],
    });

    // Published, the page follows its original again.
    await f.publish(later.inDraft);
    const next = f.newDraft();
    await f.tool("updatePage", { id: f.page.id, pathSegment: "hello" }, next.starting);
    await f.runTranslations();
    expect(
      (await f.tool("getPage", { id: f.page.id, locale: "de" }, next.inDraft)).page,
    ).toMatchObject({ pathSegment: "hallo" });
  });

  it("adds back a page deleted from a locale in the same draft", async () => {
    const f = await fixture();
    await f.publish();

    const later = f.newDraft();
    await f.tool("deletePage", { id: f.page.id, locale: "de" }, later.starting);
    await f.tool("addBackToLocale", { entity: "page", id: f.page.id, locale: "de" }, later.inDraft);
    await f.runTranslations();

    expect(await f.pagesIn("de", later.inDraft)).toEqual([f.page.id]);
    expect(await f.blocksOn(f.page.id, "de", later.inDraft)).toEqual([f.block.id]);
    expect(await f.tool("listMissingFromLocale", { locale: "de" }, later.inDraft)).toEqual({
      pages: [],
      records: [],
    });
    // Live's localization is back: the draft holds no change in the locale.
    const preview = await f.tool("previewPublish", {}, later.inDraft);
    expect(preview.changes.filter(({ locale }: { locale: string }) => locale === "de")).toEqual([]);
  });

  it("lists a record deleted from the locale the studio views, and adds it back translated", async () => {
    const f = await fixture();
    await f.tool("deleteCollectionRecord", {
      collectionId: "articles",
      id: f.record.id,
      locale: "de",
    });
    const inGerman = f.member({ ...f.inDraft, [LOCALE_HEADER]: "de" });

    expect(await call(router.locales.listMissing, { projectId: f.projectId }, inGerman)).toEqual({
      pages: [],
      records: [{ id: f.record.id, collectionId: "articles", title: "Hello" }],
    });
    await call(
      router.locales.addBack,
      { projectId: f.projectId, entity: "record", id: f.record.id },
      inGerman,
    );
    await f.runTranslations();

    expect(await f.recordsIn("de")).toEqual([f.record.id]);
    const record = await f.tool("getCollectionRecord", {
      collectionId: "articles",
      id: f.record.id,
      locale: "de",
    });
    expect(record.content).toMatchObject({ title: "Hallo" });
    expect(await call(router.locales.listMissing, { projectId: f.projectId }, inGerman)).toEqual({
      pages: [],
      records: [],
    });
  });

  it("adds back a page's blocks in the order of their originals, though their jobs run at once", async () => {
    const f = await fixture();
    const second = await f.tool("createBlock", {
      pageId: f.page.id,
      type: "hero",
      content: { title: "One" },
    });
    const third = await f.tool("createBlock", {
      pageId: f.page.id,
      type: "hero",
      content: { title: "Welcome" },
    });
    // Ordered against their ids, which break ties between equal positions.
    await f.tool("moveBlock", { id: third.id, position: "first" });
    await f.runTranslations();
    const order = await f.blocksOn(f.page.id, "en");
    expect(order).toEqual([third.id, f.block.id, second.id]);
    await f.tool("deletePage", { id: f.page.id, locale: "de" });
    await f.publish();

    const later = f.newDraft();
    await f.tool(
      "addBackToLocale",
      { entity: "page", id: f.page.id, locale: "de" },
      later.starting,
    );
    const jobs = scheduled().filter(isTranslationJob);
    forgetScheduled(...jobs.map((job) => job.entityId));
    const run = (job: (typeof jobs)[number]) => runService(runAiJob(f.db, job));
    for (const job of jobs.filter(({ entity }) => entity === "page")) await run(job);
    // Every block's job waits on the model until all of them do, then they go on together.
    const blockJobs = jobs.filter(({ entity }) => entity === "block");
    let waiting = 0;
    let release!: () => void;
    const together = new Promise<void>((resolve) => (release = resolve));
    answerEvery("translate", async ({ texts }) => {
      if (++waiting === blockJobs.length) release();
      await together;
      return Object.fromEntries(texts.map(({ key, text }) => [key, GERMAN[text] ?? text]));
    });
    await Promise.all(blockJobs.map(run));
    for (const job of jobs.filter(({ entity }) => entity !== "page" && entity !== "block")) {
      await run(job);
    }

    expect(waiting).toBeGreaterThanOrEqual(blockJobs.length);
    expect(await f.blocksOn(f.page.id, "de", later.inDraft)).toEqual(order);
  });

  it("refuses to add back what isn't missing from the locale", async () => {
    const f = await fixture();
    await expect(
      f.tool("addBackToLocale", { entity: "page", id: f.page.id, locale: "de" }),
    ).rejects.toThrow(/NOT_FOUND/);
    await f.tool("deletePage", { id: f.page.id, locale: "de" });
    await expect(f.tool("addBackToLocale", { entity: "page", id: f.page.id })).rejects.toThrow(
      /NOT_FOUND/,
    );
    await expect(
      f.tool("addBackToLocale", { entity: "record", id: f.page.id, locale: "de" }),
    ).rejects.toThrow(/NOT_FOUND/);
  });
});

describe("content created in a locale", () => {
  it("keeps a block added to a localized page there, and only there, through source changes", async () => {
    const f = await fixture();
    const added = await call(
      router.blocks.create,
      { pageId: f.page.id, type: "hero", content: { title: "Hallo", items: [] } },
      f.member({ ...f.inDraft, [LOCALE_HEADER]: "de" }),
    );
    await f.runTranslations();

    await f.tool("updatePage", { id: f.page.id, pathSegment: "prices" });
    await f.tool("editBlock", { id: f.block.id, content: { title: "Welcome" } });
    await f.runTranslations();

    expect(await f.blocksOn(f.page.id, "de")).toEqual(expect.arrayContaining([added.id]));
    expect(await f.blocksOn(f.page.id, "en")).toEqual([f.block.id]);
    expect(await f.blocksOn(f.page.id, "fr")).toEqual([f.block.id]);
    await f.publish();
    expect(await f.blocksOn(f.page.id, "de", {})).toEqual(expect.arrayContaining([added.id]));
    expect(await f.blocksOn(f.page.id, "fr", {})).toEqual([f.block.id]);
  });

  it("creates a page only in the locale it's created in", async () => {
    const f = await fixture();
    const { page } = await f.tool("createPage", {
      pathSegment: "impressum",
      layoutId: f.layout.layoutId,
      locale: "de",
    });
    await f.runTranslations();

    expect(await f.pagesIn("de")).toContain(page.id);
    expect(await f.pagesIn("en")).not.toContain(page.id);
    expect(await f.pagesIn("fr")).not.toContain(page.id);
    await f.publish();
    expect(await f.pagesIn("de", {})).toContain(page.id);
    expect(await f.pagesIn("en", {})).not.toContain(page.id);
  });

  it("creates a record only in the locale it's created in", async () => {
    const f = await fixture();
    const created = await f.tool("createCollectionRecord", {
      collectionId: "articles",
      content: { title: "Neu" },
      locale: "de",
    });
    await f.runTranslations();

    expect(await f.recordsIn("de")).toContain(created.id);
    expect(await f.recordsIn("en")).toEqual([f.record.id]);
    expect(await f.recordsIn("fr")).toEqual([f.record.id]);
  });
});

describe("deleting a default-locale entity", () => {
  it("deletes a block's localizations", async () => {
    const f = await fixture();
    await f.tool("deleteBlock", { id: f.block.id });
    await f.runTranslations();

    expect(await f.blocksOn(f.page.id, "de")).toEqual([]);
    expect(await f.blocksOn(f.page.id, "fr")).toEqual([]);
    await f.publish();
    expect(await f.blocksOn(f.page.id, "de", {})).toEqual([]);
  });

  it("deletes a page's localizations with the content created beneath them in their locale", async () => {
    const f = await fixture();
    await call(
      router.blocks.create,
      { pageId: f.page.id, type: "hero", content: { title: "Hallo", items: [{ label: "Eins" }] } },
      f.member({ ...f.inDraft, [LOCALE_HEADER]: "de" }),
    );
    await f.runTranslations();

    await f.tool("deletePage", { id: f.page.id });
    await f.runTranslations();

    expect(await f.pagesIn("de")).toEqual([]);
    expect((await f.tool("previewPublish")).lost).toEqual([]);
    await f.publish();
    expect(await f.pagesIn("de", {})).toEqual([]);
  });

  it("deletes a block's localizations with the items created beneath them in their locale", async () => {
    const f = await fixture();
    await call(
      router.repeatableItems.create,
      { blockId: f.block.id, fieldName: "items", content: { label: "Zwei" } },
      f.member({ ...f.inDraft, [LOCALE_HEADER]: "de" }),
    );

    await f.tool("deleteBlock", { id: f.block.id });
    await f.runTranslations();

    expect(await f.blocksOn(f.page.id, "de")).toEqual([]);
    expect((await f.tool("previewPublish")).lost).toEqual([]);
  });
});
