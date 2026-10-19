import {
  CAMOX_ACTOR,
  DRAFT_CREATE_HEADER,
  DRAFT_HEADER,
  TRANSLATIONS_PENDING_ERROR,
} from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { queryKeys } from "@camox/api-contract/query-keys";
import { call } from "@orpc/server";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vite-plus/test";

import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  createServiceContext,
  seedLive,
} from "../../../test/fixtures";
import {
  answerEvery,
  failEverySchedule,
  forgetScheduled,
  scheduled,
} from "../../../test/generation";
import { forgetSent, refreshes, sentTo } from "../../../test/project-rooms";
import { createDb, type Database } from "../../db";
import { isTranslationJob } from "../../lib/ai-job-queue";
import { runAiJob } from "../../lib/ai-jobs";
import { AiCallError } from "../../lib/retry-ai-call";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import { blocks } from "../../schema";
import { upsertBlockDefinition } from "../block-definitions/service";

// Publishing a draft takes every locale live together (ADR 0015): it waits for the draft's
// pending translations, unless published anyway. Then Camox opens a draft of its own that
// finishes the translations against the new Live, and publishes it once they're done.

type Headers = Record<string, string>;
type ToolResponse =
  | { ok: true; result: any }
  | { ok: false; error: { code: string; message: string } };

/** The model translates into German with this dictionary, keeping words it doesn't know. */
const GERMAN: Record<string, string> = {
  Hello: "Hallo",
  Welcome: "Willkommen",
  pricing: "preise",
  Prices: "Preise",
};

/**
 * A project whose Live holds a page with a block, in English and German, and a draft to change
 * them in.
 */
async function fixture() {
  const base = await createProjectFixture(`publish-translations-${crypto.randomUUID()}`);
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
        properties: { title: { type: "string", fieldType: "String" } },
        toMarkdown: ["# {{title}}"],
      },
    }),
  );
  answerEvery("translate", ({ texts }) =>
    Object.fromEntries(texts.map(({ key, text }) => [key, GERMAN[text] ?? text])),
  );

  /** A member's request, on `on` or the project's database. */
  const member = (headers: Headers = {}, on: Database = db) => ({
    context: createRpcContext(on, memberUser, headers),
  });
  const { page } = await callSeedingLive(
    router.pages.create,
    { projectId, pathSegment: "pricing", layoutId: base.layout.layoutId },
    member(),
  );
  const block = await callSeedingLive(
    router.blocks.create,
    { pageId: page.id, type: "hero", content: { title: "Hello" } },
    member(),
  );

  const tool = async (name: string, args: object, headers: Headers, on: Database = db) => {
    const response = (await call(
      router.agent.callTool,
      { projectId, name, arguments: args },
      member(headers, on),
    )) as ToolResponse;
    if (!response.ok) throw new Error(`${name} failed: ${JSON.stringify(response.error)}`);
    return response.result;
  };
  /**
   * Runs every translation job scheduled so far, as their alarms would, and forgets them, on `on`
   * or the project's database.
   */
  const runTranslations = async (on: Database = db) => {
    const jobs = scheduled().filter(isTranslationJob);
    forgetScheduled(...jobs.map((job) => job.entityId));
    const keyed = new Map(jobs.map((job) => [JSON.stringify({ ...job, delayMs: 0 }), job]));
    for (const job of keyed.values()) await runService(runAiJob(on, job));
  };
  /** Opens a draft, which `run` writes in, and returns its headers. */
  const draft = async (run: (starting: Headers) => Promise<unknown>) => {
    const id = generateUuidv7();
    await run({ [DRAFT_HEADER]: id, [DRAFT_CREATE_HEADER]: "1" });
    return { id, headers: { [DRAFT_HEADER]: id } };
  };
  const publish = async (
    headers: Headers,
    { on = db, ...options }: { publishAnyway?: boolean; on?: Database } = {},
  ) => {
    const { token } = await tool("previewPublish", {}, headers);
    return tool("publishDraft", { token, ...options }, headers, on);
  };

  // German goes live, translated.
  const german = await draft((starting) => tool("addLocale", { tag: "de" }, starting));
  await runTranslations();
  await publish(german.headers);

  /** The block's title in a locale, on Live or in a draft. */
  const titleIn = async (locale: string, headers: Headers = {}) =>
    (await tool("getBlock", { id: block.id, locale }, headers)).block.content.title;
  const drafts = async () => call(router.drafts.list, { projectId }, member());

  return {
    ...base,
    projectId,
    member,
    page,
    block,
    tool,
    runTranslations,
    draft,
    publish,
    titleIn,
    drafts,
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

/**
 * The test database, running `meanwhile` once right before the first statement whose SQL
 * `matches` runs, alone or in a batch: what another request does at that moment.
 */
function interrupted(matches: (query: string) => boolean, meanwhile: () => Promise<unknown>) {
  let pending: (() => Promise<unknown>) | undefined = meanwhile;
  const interrupt = async (queries: string[]) => {
    if (!pending || !queries.some(matches)) return;
    const run = pending;
    pending = undefined;
    await run();
  };
  // Each statement handed out, with the one it stands for and its SQL.
  const prepared = new WeakMap<D1PreparedStatement, { real: D1PreparedStatement; query: string }>();
  const statement = (real: D1PreparedStatement, query: string): D1PreparedStatement => {
    const handed = new Proxy(real, {
      get(target, key) {
        const value = Reflect.get(target, key);
        if (typeof value !== "function") return value;
        if (key === "bind")
          return (...values: unknown[]) => statement(target.bind(...values), query);
        return async (...args: unknown[]) => {
          await interrupt([query]);
          return value.apply(target, args);
        };
      },
    });
    prepared.set(handed, { real, query });
    return handed;
  };
  const d1 = new Proxy(env.DB, {
    get(target, key) {
      if (key === "prepare") return (query: string) => statement(target.prepare(query), query);
      if (key === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          const known = statements.map((handed) => prepared.get(handed)!);
          await interrupt(known.map(({ query }) => query));
          return target.batch(known.map(({ real }) => real));
        };
      }
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return createDb(d1);
}

/** Whether a statement starts publishing a draft: the guard on its conflicts (ADR 0009). */
const publishing = (query: string) => query.startsWith('with "guarded"');

/** Whether a statement requests translations. */
const requestingTranslations = (query: string) =>
  query.trimStart().startsWith('insert into "translation_requests"');

/** A draft changing the block's title, with its German translation pending. */
const editedDraft = (f: Fixture) =>
  f.draft((starting) =>
    f.tool("editBlock", { id: f.block.id, content: { title: "Welcome" } }, starting),
  );

describe("the publish preview", () => {
  it("lists the locales still translating, until their translations finish", async () => {
    const f = await fixture();
    const edited = await editedDraft(f);

    expect((await f.tool("previewPublish", {}, edited.headers)).translating).toEqual(["de"]);

    await f.runTranslations();
    expect((await f.tool("previewPublish", {}, edited.headers)).translating).toEqual([]);
  });
});

describe("publishing a draft with pending translations", () => {
  it("waits for them: the publish tool reports the locales translating and publishes nothing", async () => {
    const f = await fixture();
    const edited = await editedDraft(f);

    const result = await f.publish(edited.headers);

    expect(result).toMatchObject({
      published: false,
      reason: "translating",
      preview: { translating: ["de"] },
    });
    expect(await f.titleIn("en")).toBe("Hello");
  });

  it("fails with TRANSLATIONS_PENDING through the API", async () => {
    const f = await fixture();
    const edited = await editedDraft(f);
    const { token } = await call(
      router.drafts.previewPublish,
      { projectId: f.projectId },
      f.member(edited.headers),
    );

    await expect(
      call(router.drafts.publish, { projectId: f.projectId, token }, f.member(edited.headers)),
    ).rejects.toMatchObject({ code: TRANSLATIONS_PENDING_ERROR });
    expect(await f.titleIn("en")).toBe("Hello");
  });

  it("publishes once they finish", async () => {
    const f = await fixture();
    const edited = await editedDraft(f);
    await f.runTranslations();

    expect(await f.publish(edited.headers)).toMatchObject({ published: true });
    expect(await f.titleIn("en")).toBe("Welcome");
    expect(await f.titleIn("de")).toBe("Willkommen");
  });
});

/** Camox's catch-up drafts among the project's open drafts. */
const catchUpDrafts = async (f: Fixture) =>
  (await f.drafts()).drafts.filter((draft) => draft.createdBy.id === CAMOX_ACTOR);

describe("publishing anyway", () => {
  it("publishes the draft as it is, then Camox's catch-up draft publishes the remaining translations", async () => {
    const f = await fixture();
    const edited = await editedDraft(f);

    expect(await f.publish(edited.headers, { publishAnyway: true })).toMatchObject({
      published: true,
      ended: { outcome: "published" },
    });
    expect(await f.titleIn("en")).toBe("Welcome");
    expect(await f.titleIn("de")).toBe("Hallo");
    expect(await catchUpDrafts(f)).toEqual([
      expect.objectContaining({
        createdBy: { id: CAMOX_ACTOR, name: "Camox" },
        translatingLocales: ["de"],
      }),
    ]);

    await f.runTranslations();

    expect(await f.titleIn("de")).toBe("Willkommen");
    expect(await catchUpDrafts(f)).toEqual([]);
    expect((await f.drafts()).live.publishedBy).toEqual({ id: CAMOX_ACTOR, name: "Camox" });
  });

  it("adds to the catch-up draft still open rather than opening another", async () => {
    const f = await fixture();
    const first = await editedDraft(f);
    await f.publish(first.headers, { publishAnyway: true });
    const second = await f.draft((starting) =>
      f.tool("editBlock", { id: f.block.id, content: { title: "Hello" } }, starting),
    );
    await f.publish(second.headers, { publishAnyway: true });

    expect(await catchUpDrafts(f)).toHaveLength(1);
    await f.runTranslations();
    expect(await f.titleIn("de")).toBe("Hallo");
  });

  it("drops a pending merge with Live's localization, which the draft's own replaced", async () => {
    const f = await fixture();
    const editDe = (title: string) => (headers: Headers) =>
      f.tool("editBlock", { id: f.block.id, content: { title }, locale: "de" }, headers);
    const mine = await f.draft(editDe("Grüß Gott"));
    const theirs = await f.draft(editDe("Servus"));
    await f.publish(theirs.headers);
    expect((await f.tool("previewPublish", {}, mine.headers)).translating).toEqual(["de"]);

    await f.publish(mine.headers, { publishAnyway: true });

    expect(await catchUpDrafts(f)).toEqual([]);
    expect(await f.titleIn("de")).toBe("Grüß Gott");
  });

  it("leaves no catch-up draft behind when its translations changed nothing", async () => {
    const f = await fixture();
    const edited = await editedDraft(f);
    await f.publish(edited.headers, { publishAnyway: true });

    answerEvery("translate", () => new AiCallError({ cause: "OpenRouter 503" }));
    await f.runTranslations();

    expect(await catchUpDrafts(f)).toEqual([]);
    expect(await f.titleIn("de")).toBe("Hallo");
  });

  it("keeps one catch-up draft when two requests catch up at once, as a release's do", async () => {
    const f = await fixture();
    const released = (title: string, position: string) =>
      seedLive(f.db, blocks, {
        projectId: f.projectId,
        pageId: f.page.id,
        type: "hero",
        content: { title },
        position,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

    await Promise.all([released("Hello", "b0"), released("Welcome", "c0")]);

    expect(await catchUpDrafts(f)).toEqual([
      expect.objectContaining({ translatingLocales: ["de"] }),
    ]);
  });

  it("loses no translation requested while the catch-up draft publishes", async () => {
    const f = await fixture();
    const edited = await editedDraft(f);
    await f.publish(edited.headers, { publishAnyway: true });
    const retitled = await f.draft((starting) =>
      f.tool("setPageSeo", { id: f.page.id, metaTitle: "Prices" }, starting),
    );

    // The catch-up draft's last translation publishes it, and another draft publishes anyway right
    // before, requesting the page's translation in it.
    await f.runTranslations(
      interrupted(publishing, () => f.publish(retitled.headers, { publishAnyway: true })),
    );
    await f.runTranslations();

    expect(await f.titleIn("de")).toBe("Willkommen");
    const page = await f.tool("getPage", { id: f.page.id, locale: "de" }, {});
    expect(page.page.metaTitle).toBe("Preise");
    expect(await catchUpDrafts(f)).toEqual([]);
  });

  it("catches up in a new draft when Camox published the open one meanwhile", async () => {
    const f = await fixture();
    const edited = await editedDraft(f);
    await f.publish(edited.headers, { publishAnyway: true });
    const retitled = await f.draft((starting) =>
      f.tool("setPageSeo", { id: f.page.id, metaTitle: "Prices" }, starting),
    );

    // Another draft publishing anyway found the catch-up draft open, and Camox publishes it right
    // before the translations are requested in it.
    await f.publish(retitled.headers, {
      publishAnyway: true,
      on: interrupted(requestingTranslations, () => f.runTranslations()),
    });
    expect(await catchUpDrafts(f)).toEqual([
      expect.objectContaining({ translatingLocales: ["de"] }),
    ]);
    await f.runTranslations();

    expect(await f.titleIn("de")).toBe("Willkommen");
    const page = await f.tool("getPage", { id: f.page.id, locale: "de" }, {});
    expect(page.page.metaTitle).toBe("Preise");
    expect(await catchUpDrafts(f)).toEqual([]);
  });

  it("publishes the catch-up draft when its last translations can't be scheduled", async () => {
    const f = await fixture();
    const edited = await editedDraft(f);
    failEverySchedule();

    await f.publish(edited.headers, { publishAnyway: true });

    expect(await catchUpDrafts(f)).toEqual([]);
  });

  it("leaves the catch-up draft open, like any other draft, when it has a blocker", async () => {
    const f = await fixture();
    const retitled = await f.draft((starting) =>
      f.tool("setPageSeo", { id: f.page.id, metaTitle: "Prices" }, starting),
    );
    await f.publish(retitled.headers, { publishAnyway: true });

    // The model translates the meta title to nothing, which blocks publishing.
    answerEvery("translate", ({ texts }) =>
      Object.fromEntries(texts.map(({ key, text }) => [key, text === "Prices" ? "" : text])),
    );
    await f.runTranslations();

    const [open] = await catchUpDrafts(f);
    expect(open).toMatchObject({ translatingLocales: [] });
    const preview = await f.tool("previewPublish", {}, { [DRAFT_HEADER]: open!.id });
    expect(preview.blockers).toEqual([
      expect.objectContaining({ entity: "page", id: f.page.id, locale: "de" }),
    ]);
  });
});

describe("a translation settling", () => {
  it("refreshes the draft's publish preview, even having written nothing", async () => {
    const f = await fixture();
    const edited = await editedDraft(f);
    answerEvery("translate", () => new AiCallError({ cause: "OpenRouter 503" }));
    forgetSent(f.projectId);

    await f.runTranslations();

    expect(
      refreshes(sentTo(f.projectId), edited.id, [
        ...queryKeys.drafts.all,
        "previewPublish",
        edited.id,
      ]),
    ).toBe(true);
  });
});
