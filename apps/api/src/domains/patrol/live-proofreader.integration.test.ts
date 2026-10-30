import {
  CAMOX_ACTOR,
  DRAFT_CREATE_HEADER,
  DRAFT_HEADER,
  LOCALE_HEADER,
} from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { PATROLLER_IDS, type FindingView, type PatrollerView } from "@camox/api-contract/patrol";
import { call } from "@orpc/server";
import { abortAllDurableObjects, createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { emailsTo } from "../../../test/emails";
import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  reviewed,
  runTranslations,
  syncDefinitionSet,
  type TestDefinitionSet,
} from "../../../test/fixtures";
import {
  answerEvery,
  forgetScheduledPatrols,
  modelCalls,
  scheduledPatrols,
} from "../../../test/generation";
import { answerNext, forgetThreadModel } from "../../../test/thread-model";
import { connectDraftThread, said as saidIn, signIn } from "../../../test/threads";
import { runAiJob } from "../../lib/ai-jobs";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import type { Bindings } from "../../types";
import worker from "../../worker";
import { LIVE_PATROL_CRON } from "./live-patrol";

// The Proofreader on Live (ADR 0034), through the router and the cron entry: it's asleep there,
// except once after a release no draft published, and once when it first arrives in a project.
// The scripted model proofreads with a dictionary of mistakes; what it finds on Live goes to the
// Patrol Draft.

// The Patrol Draft's agent runs on pi-ai's fake provider, scripted per test.
vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

afterEach(async () => {
  await abortAllDurableObjects();
  forgetThreadModel();
});

type Headers = Record<string, string>;
const startingDraft = (id: string): Headers => ({ [DRAFT_HEADER]: id, [DRAFT_CREATE_HEADER]: "1" });
const inDraft = (id: string): Headers => ({ [DRAFT_HEADER]: id });

/** The mistakes the scripted model knows, and their fixes. */
const MISTAKES: Record<string, string> = { recieve: "receive", Teh: "The" };

/** The model fixes every mistake it knows in each text. */
const proofreadWithDictionary = () =>
  answerEvery("proofread", ({ texts }) =>
    texts.flatMap(({ key, text }) =>
      Object.entries(MISTAKES)
        .filter(([original]) => text.includes(original))
        .map(([original, replacement]) => ({
          key,
          kind: "misspelling" as const,
          original,
          replacement,
        })),
    ),
  );

/** The texts the model was asked to proofread, in order. */
const proofread = () =>
  modelCalls().flatMap((made) =>
    made.method === "proofread" ? made.request.texts.map(({ text }) => text) : [],
  );

const titled = {
  type: "object",
  properties: { title: { type: "string", fieldType: "String", title: "Title" } },
  toTitle: "{{title}}",
};
const block = (blockId: string, extra: Record<string, unknown> = {}) => ({
  blockId,
  title: blockId === "hero" ? "Hero" : "Navbar",
  description: blockId,
  contentSchema: titled,
  ...extra,
});

/** A release of the website's code declaring a navbar in its layout, titled `title`. */
const releasing = (title: string): TestDefinitionSet => ({
  blocks: [block("hero"), block("navbar", { layoutOnly: true })],
  layouts: [
    {
      layoutId: "default",
      description: "Default",
      blocks: [{ type: "navbar", slot: "before", content: { title } }],
    },
  ],
});

/**
 * Calls the cron entry as its 6-hourly trigger would, then runs the patrols it scheduled, as their
 * alarms would.
 */
async function patrolLive(db: Awaited<ReturnType<typeof fixture>>["db"]) {
  await worker.scheduled(createScheduledController({ cron: LIVE_PATROL_CRON }), env as Bindings);
  await runPatrols(db);
}

/** Runs the patrols of Live scheduled so far, as their alarms would. */
async function runPatrols(db: Awaited<ReturnType<typeof fixture>>["db"]) {
  const jobs = scheduledPatrols();
  forgetScheduledPatrols();
  for (const job of jobs) await runService(runAiJob(db, job));
}

/**
 * A project whose Live home page has a hero titled `title`, published before the Proofreader
 * arrived: no draft check proofread it.
 */
async function fixture(title = "Welcome") {
  const base = await createProjectFixture(`live-proofreader-${crypto.randomUUID()}`);
  const { db, project, memberUser } = base;
  const projectId = project.id;
  await syncDefinitionSet(db, project, { blocks: [block("hero")] });
  const member = (headers: Headers = {}) => ({
    context: createRpcContext(db, memberUser, headers),
  });
  const { page: home } = await callSeedingLive(
    router.pages.create,
    { projectId, pathSegment: "", layoutId: base.layout.layoutId, nickname: "Home" },
    member(),
  );
  // A manual meta title keeps its SEO out of publishing's checks.
  await callSeedingLive(router.pages.setSeo, { id: home.id, metaTitle: "Home" }, member());
  // Published while the model found nothing: before the Proofreader.
  const hero = await callSeedingLive(
    router.blocks.create,
    { pageId: home.id, type: "hero", content: { title } },
    member(),
  );
  proofreadWithDictionary();
  const proofreader = async (headers: Headers = {}): Promise<PatrollerView> =>
    (
      await call(router.patrol.get, { projectId, patrollers: [...PATROLLER_IDS] }, member(headers))
    ).patrollers.find((patroller) => patroller.id === "proofreader")!;
  const findings = async (headers: Headers = {}) => (await proofreader(headers)).findings;
  const release = (set: TestDefinitionSet) => syncDefinitionSet(db, project, set);
  const drafts = async () =>
    (await call(router.drafts.list, { projectId }, member())).drafts.map((draft) => ({
      id: draft.id,
      name: draft.name,
      createdBy: draft.createdBy,
    }));
  /** Connects to a draft's thread as the member, once its agent is done with `messages`. */
  const threadOf = async (draftId: string, messages: number) => {
    const thread = await connectDraftThread(projectId, draftId, await signIn(db, memberUser.id));
    await thread.untilIdle(messages);
    return thread;
  };
  const publish = async (draftId: string) => {
    const input = { projectId };
    const { token } = await reviewed(
      db,
      draftId,
      call(router.drafts.previewPublish, input, member(inDraft(draftId))),
    );
    await call(router.drafts.publish, { ...input, token }, member(inDraft(draftId)));
  };
  return {
    ...base,
    projectId,
    member,
    home,
    hero,
    proofreader,
    findings,
    release,
    drafts,
    threadOf,
    publish,
  };
}

/** What a finding says, in short. */
const said = (finding: FindingView) => ({
  subject: finding.subject.id,
  field: finding.field,
  about: finding.about,
  fix: finding.fix,
  live: finding.live,
});

describe("the Proofreader's first arrival on Live", () => {
  it("proofreads Live once, raising what it finds there", async () => {
    const f = await fixture("Teh best gifts.");
    answerNext("I'll fix it.");

    await patrolLive(f.db);

    expect((await f.findings()).map(said)).toEqual([
      {
        subject: f.hero.id,
        field: "title",
        about: { kind: "misspelling", text: "Teh", sentence: "Teh best gifts." },
        fix: { kind: "replaceText", replacement: "The" },
        live: true,
      },
    ]);
    const asked = proofread().length;
    await patrolLive(f.db);
    expect(proofread()).toHaveLength(asked);
    expect(await f.findings()).toHaveLength(1);
  });

  it("leaves out the text the Translator wrote on Live, and reads Live's localizations edited by hand", async () => {
    const f = await fixture();
    // A draft adding French publishes while the model finds nothing.
    answerEvery("proofread", () => []);
    answerEvery("translate", ({ texts }) =>
      Object.fromEntries(texts.map(({ key, text }) => [key, `${text} recieve`])),
    );
    const draft = generateUuidv7();
    await call(
      router.locales.add,
      { projectId: f.projectId, tag: "fr" },
      f.member(startingDraft(draft)),
    );
    await call(
      router.blocks.create,
      { pageId: f.home.id, type: "hero", content: { title: "Hello" } },
      f.member(inDraft(draft)),
    );
    await runTranslations(f.db);
    await call(
      router.blocks.updateContent,
      { id: f.hero.id, content: { title: "Ils recieve un cadeau." } },
      f.member({ ...inDraft(draft), [LOCALE_HEADER]: "fr" }),
    );
    await f.publish(draft);
    proofreadWithDictionary();
    answerNext("I'll fix it.");

    await patrolLive(f.db);

    expect((await f.findings()).map(said)).toEqual([
      {
        subject: f.hero.id,
        field: "title",
        about: { kind: "misspelling", text: "recieve", sentence: "Ils recieve un cadeau." },
        fix: { kind: "replaceText", replacement: "receive" },
        live: true,
      },
    ]);
  });
});

describe("the Proofreader after a release", () => {
  it("proofreads once what a release no draft published wrote on Live", async () => {
    const f = await fixture();
    await patrolLive(f.db);
    const before = proofread().length;

    await f.release(releasing("Teh menu"));
    await runPatrols(f.db);

    expect(proofread().slice(before)).toEqual(["Teh menu"]);
    expect((await f.findings()).map((finding) => finding.about)).toEqual([
      { kind: "misspelling", text: "Teh", sentence: "Teh menu" },
    ]);
    await patrolLive(f.db);
    expect(proofread().slice(before)).toEqual(["Teh menu"]);
  });
});

describe("the Proofreader's Live findings", () => {
  it("go to the Patrol Draft, its thread opening with a Brief that lists them, and email members", async () => {
    const f = await fixture("Guests recieve a gift.");
    answerNext("I'll fix it.");

    await patrolLive(f.db);

    const drafts = await f.drafts();
    expect(drafts).toEqual([
      { id: expect.any(String), name: "Patrol", createdBy: { id: CAMOX_ACTOR, name: "Camox" } },
    ]);
    const [brief] = saidIn((await f.threadOf(drafts[0]!.id, 2)).view());
    expect(brief).toEqual({ from: "camox", text: expect.stringContaining("recieve") });
    const emails = await emailsTo(f.memberUser.email);
    expect(emails).toHaveLength(1);
    expect(emails[0]!.text).toContain("recieve");
  });

  it("close once a publish fixed them on Live, without proofreading Live again", async () => {
    const f = await fixture("Teh best gifts.");
    answerNext("I'll fix it.");
    await patrolLive(f.db);
    expect(await f.findings()).toHaveLength(1);
    const draft = generateUuidv7();
    await call(
      router.blocks.updateContent,
      { id: f.hero.id, content: { title: "The best gifts." } },
      f.member(startingDraft(draft)),
    );
    await f.publish(draft);
    const asked = proofread().length;

    await patrolLive(f.db);

    expect(await f.findings()).toEqual([]);
    expect(proofread()).toHaveLength(asked);
  });
});

describe("the Proofreader in Live's Patrol", () => {
  it("is asleep on Live, and works there only while it proofreads", async () => {
    const f = await fixture("Teh best gifts.");
    answerNext("I'll fix it.");
    const before = await f.proofreader();
    let during: PatrollerView | undefined;
    answerEvery("proofread", async () => {
      during = await f.proofreader();
      return [];
    });

    await patrolLive(f.db);

    const after = await f.proofreader();
    expect([before.duty, before.working]).toEqual(["off", null]);
    expect(during?.working).toEqual({
      subject: { entity: "block", id: f.hero.id, name: "Teh best gifts." },
      locales: [{ locale: "en", count: 1 }],
    });
    expect([after.duty, after.working]).toEqual(["off", null]);
    expect(after.lastCheckedAt).not.toBeNull();
  });

  it("stays asleep on Live while a draft's publish changes Live", async () => {
    const f = await fixture();
    await patrolLive(f.db);
    const checkedAt = (await f.proofreader()).lastCheckedAt;
    const draft = generateUuidv7();
    await call(
      router.blocks.updateContent,
      { id: f.hero.id, content: { title: "Welcome home" } },
      f.member(startingDraft(draft)),
    );
    await f.publish(draft);
    const before = proofread().length;

    await patrolLive(f.db);

    expect(proofread()).toHaveLength(before);
    expect((await f.proofreader()).lastCheckedAt).toBe(checkedAt);
  });
});
