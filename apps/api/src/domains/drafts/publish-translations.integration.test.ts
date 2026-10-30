import {
  CAMOX_ACTOR,
  DRAFT_CREATE_HEADER,
  DRAFT_HEADER,
  TRANSLATIONS_PENDING_ERROR,
} from "@camox/api-contract/drafts";
import { generateUuidv7, PAGE_TEXT_LINK_PREFIX } from "@camox/api-contract/ids";
import { queryKeys } from "@camox/api-contract/query-keys";
import { call } from "@orpc/server";
import { abortAllDurableObjects, createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  runAllChecks,
  runChecks,
  seedLive,
  syncDefinitionSet,
} from "../../../test/fixtures";
import { forwarded } from "../../../test/forwarded";
import {
  answerEvery,
  failEverySchedule,
  forgetScheduled,
  forgetScheduledPatrols,
  scheduled,
  scheduledPatrols,
} from "../../../test/generation";
import { forgetSent, refreshes, sentTo } from "../../../test/project-rooms";
import { createDb, type Database } from "../../db";
import { isTranslationJob } from "../../lib/ai-job-queue";
import { runAiJob } from "../../lib/ai-jobs";
import { AiCallError } from "../../lib/retry-ai-call";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import { blocks, pages } from "../../schema";
import type { Bindings } from "../../types";
import worker from "../../worker";
import { LIVE_PATROL_CRON } from "../patrol/live-patrol";

// Publishing a draft takes every locale live together (ADR 0033): it waits for the draft's
// pending translations, always. What a release writes on Live is translated in a draft Camox
// opens, its catch-up draft, which it publishes once the translations are done.

// The Patrol Draft's agent runs on pi-ai's fake provider.
vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

afterEach(async () => {
  await abortAllDurableObjects();
});

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
  await syncDefinitionSet(db, project, {
    blocks: [
      {
        blockId: "hero",
        title: "Hero",
        description: "Hero",
        contentSchema: {
          type: "object",
          properties: { title: { type: "string", fieldType: "String" } },
          toMarkdown: ["# {{title}}"],
        },
      },
    ],
  });
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

  const tool = async (
    name: string,
    args: Record<string, unknown>,
    headers: Headers,
    on: Database = db,
  ) => {
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
  const runTranslationJobs = async (on: Database = db) => {
    const jobs = scheduled().filter(isTranslationJob);
    forgetScheduled(...jobs.map((job) => job.entityId));
    const keyed = new Map(jobs.map((job) => [JSON.stringify({ ...job, delayMs: 0 }), job]));
    for (const job of keyed.values()) await runService(runAiJob(on, job));
  };
  /**
   * Runs the translation jobs, then the patrollers' checks they requested, which a catch-up draft
   * waits for before Camox publishes it (ADR 0033).
   */
  const runTranslations = async (on: Database = db) => {
    await runTranslationJobs(on);
    await runAllChecks(on);
  };
  /** Opens a draft, which `run` writes in, and returns its headers. */
  const draft = async (run: (starting: Headers) => Promise<unknown>) => {
    const id = generateUuidv7();
    await run({ [DRAFT_HEADER]: id, [DRAFT_CREATE_HEADER]: "1" });
    return { id, headers: { [DRAFT_HEADER]: id } };
  };
  const publish = async (headers: Headers, { on = db }: { on?: Database } = {}) => {
    const { token } = await tool("previewPublish", {}, headers);
    await runAllChecks(db);
    return tool("publishDraft", { token }, headers, on);
  };

  // German goes live, translated.
  const german = await draft((starting) => tool("addLocale", { tag: "de" }, starting));
  await runTranslations();
  await publish(german.headers);

  /** A block's title in a locale, on Live or in a draft: the fixture's block by default. */
  const titleIn = async (locale: string, headers: Headers = {}, id: string = block.id) =>
    (await tool("getBlock", { id, locale }, headers)).block.content.title;
  /** Writes a hero titled `title` on Live as a release does, on `on` or the project's database. */
  const release = (title: string, on: Database = db) =>
    seedLive(on, blocks, {
      projectId,
      pageId: page.id,
      type: "hero",
      content: { title },
      position: `b${crypto.randomUUID()}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  const drafts = async () => call(router.drafts.list, { projectId }, member());

  return {
    ...base,
    projectId,
    member,
    page,
    block,
    tool,
    runTranslations,
    runTranslationJobs,
    draft,
    publish,
    titleIn,
    drafts,
    release,
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
        if (key === "bind")
          return (...values: unknown[]) => statement(target.bind(...values), query);
        const value = forwarded(target, key);
        if (typeof value !== "function") return value;
        return async (...args: unknown[]) => {
          await interrupt([query]);
          return value(...args);
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
      return forwarded(target, key);
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
    expect(result.message).not.toMatch(/anyway/);
    expect(await f.titleIn("en")).toBe("Hello");
    expect(await f.titleIn("de")).toBe("Hallo");
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

  it("publishes once they finish, opening no catch-up draft", async () => {
    const f = await fixture();
    const edited = await editedDraft(f);
    expect(await f.publish(edited.headers)).toMatchObject({ reason: "translating" });
    await f.runTranslations();

    expect(await f.publish(edited.headers)).toMatchObject({ published: true });
    expect(await f.titleIn("en")).toBe("Welcome");
    expect(await f.titleIn("de")).toBe("Willkommen");
    expect(await catchUpDrafts(f)).toEqual([]);
  });

  it("waits for a translation requested while it publishes", async () => {
    const f = await fixture();
    const edited = await editedDraft(f);
    await f.runTranslations();

    // The draft changes again right before its publish batch, requesting a translation.
    const result = await f.publish(edited.headers, {
      on: interrupted(publishing, () =>
        f.tool("editBlock", { id: f.block.id, content: { title: "Hello" } }, edited.headers),
      ),
    });

    expect(result).toMatchObject({ published: false, reason: "translating" });
    expect(await f.titleIn("en")).toBe("Hello");
    expect(await f.titleIn("de")).toBe("Hallo");
    expect(await catchUpDrafts(f)).toEqual([]);
  });
});

/** Rich text, as content stores it: plain text, then a link to `url` reading `label`. */
const linkedText = (before: string, url: string, label: string) =>
  JSON.stringify({
    root: {
      type: "root",
      version: 1,
      direction: "ltr",
      format: "",
      indent: 0,
      children: [
        {
          type: "paragraph",
          version: 1,
          direction: "ltr",
          format: "",
          indent: 0,
          children: [
            {
              type: "text",
              text: before,
              format: 0,
              detail: 0,
              mode: "normal",
              style: "",
              version: 1,
            },
            {
              type: "link",
              url,
              version: 1,
              direction: "ltr",
              format: "",
              indent: 0,
              children: [
                {
                  type: "text",
                  text: label,
                  format: 0,
                  detail: 0,
                  mode: "normal",
                  style: "",
                  version: 1,
                },
              ],
            },
          ],
        },
      ],
    },
  });

/** Camox's catch-up drafts among the project's open drafts. */
const catchUpDrafts = async (f: Fixture) =>
  (await f.drafts()).drafts.filter((draft) => draft.createdBy.id === CAMOX_ACTOR);

describe("a release's catch-up draft", () => {
  it("translates what the release added, then Camox publishes it", async () => {
    const f = await fixture();
    const released = await f.release("Welcome");

    expect(await catchUpDrafts(f)).toEqual([
      expect.objectContaining({
        createdBy: { id: CAMOX_ACTOR, name: "Camox" },
        translatingLocales: ["de"],
      }),
    ]);

    await f.runTranslations();

    expect(await f.titleIn("de", {}, released.id)).toBe("Willkommen");
    expect(await catchUpDrafts(f)).toEqual([]);
    expect((await f.drafts()).live.publishedBy).toEqual({ id: CAMOX_ACTOR, name: "Camox" });
  });

  it("waits for the patrollers' checks before Camox publishes it", async () => {
    const f = await fixture();
    await f.release("Welcome");

    await f.runTranslationJobs();

    expect(await catchUpDrafts(f)).toEqual([expect.objectContaining({ translatingLocales: [] })]);
  });

  it("stays open for a member while it has an open finding", async () => {
    const f = await fixture();
    const missing = `${PAGE_TEXT_LINK_PREFIX}${generateUuidv7()}`;
    await f.release(linkedText("Read ", missing, "pricing"));
    await f.runTranslationJobs();
    const [catchUp] = await catchUpDrafts(f);

    await runChecks(f.db, catchUp!.id);

    expect(await catchUpDrafts(f)).toHaveLength(1);
    const preview = await f.tool("previewPublish", {}, { [DRAFT_HEADER]: catchUp!.id });
    expect(preview).toMatchObject({
      checking: [],
      findings: [{ locale: "de", about: { kind: "missingPage", url: missing } }],
    });
  });

  it("opens beside the Patrol Draft, which later releases don't join", async () => {
    const f = await fixture();
    await f.release(linkedText("Read ", `${PAGE_TEXT_LINK_PREFIX}${generateUuidv7()}`, "pricing"));

    // The Live patrol finds the link to a missing page, which opens the Patrol Draft.
    await worker.scheduled(createScheduledController({ cron: LIVE_PATROL_CRON }), env as Bindings);
    const patrols = scheduledPatrols();
    forgetScheduledPatrols();
    for (const job of patrols) await runService(runAiJob(f.db, job));
    await f.release("Hello");

    const names = (await catchUpDrafts(f))
      .map((draft) => draft.name)
      .sort((a, b) => (a ?? "").localeCompare(b ?? ""));
    expect(names).toEqual(["Patrol", "Translations"]);
  });

  it("takes later releases in while it's open rather than opening another", async () => {
    const f = await fixture();
    const first = await f.release("Welcome");
    const second = await f.release("Hello");

    expect(await catchUpDrafts(f)).toHaveLength(1);
    await f.runTranslations();
    expect(await f.titleIn("de", {}, first.id)).toBe("Willkommen");
    expect(await f.titleIn("de", {}, second.id)).toBe("Hallo");
  });

  it("is left behind by no one when its translations changed nothing", async () => {
    const f = await fixture();
    await f.release("Welcome");

    answerEvery("translate", () => new AiCallError({ cause: "OpenRouter 503" }));
    await f.runTranslations();

    expect(await catchUpDrafts(f)).toEqual([]);
  });

  it("stays one when two requests catch up at once, as a release's do", async () => {
    const f = await fixture();

    await Promise.all([f.release("Hello"), f.release("Welcome")]);

    expect(await catchUpDrafts(f)).toEqual([
      expect.objectContaining({ translatingLocales: ["de"] }),
    ]);
  });

  it("loses no translation a release requests while it publishes", async () => {
    const f = await fixture();
    const first = await f.release("Welcome");
    let second: { id: string } | undefined;

    // The catch-up draft's last translation publishes it, and another release requests a
    // translation in it right before.
    await f.runTranslations(
      interrupted(publishing, async () => {
        second = await f.release("Prices");
      }),
    );
    await f.runTranslations();

    expect(await f.titleIn("de", {}, first.id)).toBe("Willkommen");
    expect(await f.titleIn("de", {}, second!.id)).toBe("Preise");
    expect(await catchUpDrafts(f)).toEqual([]);
  });

  it("is opened anew when Camox published the open one meanwhile", async () => {
    const f = await fixture();
    const first = await f.release("Welcome");

    // A release found the catch-up draft open, and Camox publishes it right before the
    // translations are requested in it.
    const second = await f.release(
      "Prices",
      interrupted(requestingTranslations, () => f.runTranslations()),
    );
    expect(await catchUpDrafts(f)).toEqual([
      expect.objectContaining({ translatingLocales: ["de"] }),
    ]);
    await f.runTranslations();

    expect(await f.titleIn("de", {}, first.id)).toBe("Willkommen");
    expect(await f.titleIn("de", {}, second.id)).toBe("Preise");
    expect(await catchUpDrafts(f)).toEqual([]);
  });

  it("is published when its last translations can't be scheduled", async () => {
    const f = await fixture();
    failEverySchedule();

    await f.release("Welcome");

    expect(await catchUpDrafts(f)).toEqual([]);
  });

  it("stays open, like any other draft, when it has a blocker", async () => {
    const f = await fixture();
    const released = await seedLive(f.db, pages, {
      projectId: f.projectId,
      layoutId: f.layout.layoutId,
      pathSegment: "about",
      fullPath: "/about",
      nickname: "About",
      metaTitle: "Prices",
      contentUpdatedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // The model translates the meta title to nothing, which blocks publishing.
    answerEvery("translate", ({ texts }) =>
      Object.fromEntries(texts.map(({ key, text }) => [key, text === "Prices" ? "" : text])),
    );
    await f.runTranslations();

    const [open] = await catchUpDrafts(f);
    expect(open).toMatchObject({ translatingLocales: [] });
    const preview = await f.tool("previewPublish", {}, { [DRAFT_HEADER]: open!.id });
    expect(preview.blockers).toEqual([
      expect.objectContaining({ entity: "page", id: released.id, locale: "de" }),
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
