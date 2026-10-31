import { DRAFT_HEADER } from "@camox/api-contract/drafts";
import { call } from "@orpc/server";
import { abortAllDurableObjects } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createRpcContext, startDraft } from "../../../test/fixtures";
import { pushToMain } from "../../../test/pushes";
import {
  broken,
  failingMarker,
  type FakeTypeError,
  HERO,
  LOCKFILE,
  PRICING,
  revisionFakes as fakes,
  typeErrorsMarker,
  websiteWithCode,
} from "../../../test/revision-builds";
import {
  answerFrom,
  answerNext,
  answerWithCodeRequest,
  answerWithToolCall,
  answerWithToolCallFrom,
  forgetThreadModel,
  holdNextAnswer,
  holdNextToolCall,
  threadModelCalls,
} from "../../../test/thread-model";
import {
  ask,
  connectDraftThread,
  lastAnswer,
  said,
  signIn,
  threadIdOf,
  type Website,
} from "../../../test/threads";
import { router } from "../../router";
import { END_OF_TURN_BUILD_FAILURES } from "./end-of-turn";

// When Live's code doesn't merge cleanly into a draft, Camox fixes it with an agent turn of its
// own (ADR 0020's amendment, spec #560 section 11): editors are never asked about code.

vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

afterEach(async () => {
  await abortAllDurableObjects();
  forgetThreadModel();
});

const STYLES_FILE = "src/styles.css";
const STYLES = `:root {\n  --color-accent: oklch(0.6 0.2 250);\n}\n`;
/** The styles as a merge that conflicts leaves them: both sides between markers. */
const CONFLICTED_STYLES = `:root {
<<<<<<< draft
  --color-accent: oklch(0.6 0.2 20);
=======
  --color-accent: oklch(0.6 0.2 140);
>>>>>>> Live
}
`;

const HERO_FILE = "src/blocks/hero.tsx";
const PRICING_FILE = "src/blocks/pricing.tsx";
/** The hero block as the draft's agent changed it. */
const OUR_HERO = `export const hero = "Welcome, friends";\n`;
/** The hero block as another publish changed it on `main`. */
const LIVE_HERO = `export const hero = "Welcome to the new Acme";\n`;
/** The hero block as Camox's turn reconciles both. */
const RECONCILED_HERO = `export const hero = "Welcome to the new Acme, friends";\n`;

const EXPLAINED =
  "Live's latest changes to the hero don't fit with this draft's yet: ask me again.";

const NOT_A_STRING: FakeTypeError = {
  file: HERO_FILE,
  line: 2,
  column: 7,
  code: "TS2322",
  message: "Type 'number' is not assignable to type 'string'.",
};

/** `main`'s files, as `websiteWithCode` pushed them, with `changes`. */
const mainWith = (changes: Record<string, string>) => ({
  "package.json": `{ "name": "acme", "dependencies": { "camox": "1.0.0" } }\n`,
  "pnpm-lock.yaml": LOCKFILE,
  [HERO_FILE]: HERO,
  ...changes,
});

const reviewer = ({ db, memberUser }: Website, draftId: string) => ({
  context: createRpcContext(db, memberUser, { [DRAFT_HEADER]: draftId }),
});

const previewOf = (website: Website, draftId: string) =>
  call(router.drafts.previewPublish, { projectId: website.project.id }, reviewer(website, draftId));

const blockersOf = async (website: Website, draftId: string) =>
  (await previewOf(website, draftId)).blockers.map(({ entity, code }) => ({ entity, code }));

/**
 * Scripts the thread's agent's answer to Camox's reconcile turn: it hands the request its
 * instructions hold to the Code Agent, whose answer ends the turn.
 */
const answerByHandingOffTheClash = () =>
  answerWithToolCallFrom("code", ({ editorMessages }) => ({
    request: editorMessages.at(-1)!.split("\n---\n")[1]!,
    final: true,
  }));

/**
 * A draft whose Code Agent wrote `content` to `path`, built at the end of its request, its thread
 * open.
 */
async function draftChanging(path: string, content: string) {
  const website = await websiteWithCode();
  const token = await signIn(website.db, website.memberUser.id);
  const draftId = await startDraft(website.db, website.project.id, website.memberUser.id);
  const thread = await connectDraftThread(website.project.id, draftId, token);
  answerWithCodeRequest();
  answerWithToolCall("write", { path, content });
  answerNext("I changed the website.");
  await ask(thread, "Change the website", { keepOpen: true });
  return { website, token, draftId, thread };
}

describe("Camox's reconcile turn", () => {
  it("has the Code Agent fix a merge of Live's code that conflicts, in a turn of its own", async () => {
    const { website, draftId, thread } = await draftChanging(HERO_FILE, OUR_HERO);
    const repo = website.project.uuid;
    const reviewed = await previewOf(website, draftId);
    // Camox's turn hands the clash to the Code Agent, which lists the files with markers, and
    // fixes the one listed, as Camox.
    answerByHandingOffTheClash();
    const listed = holdNextToolCall("conflicts", {});
    let conflicts: string | undefined;
    answerWithToolCallFrom("write", ({ lastToolResult }) => {
      conflicts = lastToolResult;
      return { path: HERO_FILE, content: RECONCILED_HERO };
    });
    answerNext("Live's new welcome is in, and I kept your friendly greeting.");

    await pushToMain(repo, mainWith({ [HERO_FILE]: LIVE_HERO }));

    // While Camox's turn works, the draft has the blocker, and the preview keeps its revision.
    await thread.until(() => thread.view().running);
    expect(said(thread.view()).at(-1)).toEqual({ from: "camox", text: expect.any(String) });
    expect(await blockersOf(website, draftId)).toEqual([
      { entity: "code", code: "codeDoesNotMerge" },
    ]);
    expect((await previewOf(website, draftId)).code).toMatchObject({
      revision: reviewed.code!.revision,
    });
    expect(await fakes.readFile(repo, draftId, HERO_FILE)).toBe(OUR_HERO);

    listed();
    await thread.untilIdle();
    expect(conflicts).toContain(HERO_FILE);
    expect(said(thread.view()).slice(-2)).toEqual([
      { from: "camox", text: expect.any(String) },
      { from: "agent", text: "Live's new welcome is in, and I kept your friendly greeting." },
    ]);
    // Its merge revision built, and holds Live's code: the blocker cleared.
    expect(await fakes.readFile(repo, draftId, HERO_FILE)).toBe(RECONCILED_HERO);
    const preview = await previewOf(website, draftId);
    expect(preview.code).toMatchObject({ includesLive: true });
    expect(preview.code!.revision).not.toBe(reviewed.code!.revision);
    expect(preview.blockers).toEqual([]);
  });

  it("has the Code Agent fix a merge of Live's code that no longer builds, from the merged files", async () => {
    const { website, draftId, thread } = await draftChanging(PRICING_FILE, PRICING);
    const repo = website.project.uuid;
    const reviewed = await previewOf(website, draftId);
    const marker = await failingMarker(HERO_FILE);
    answerByHandingOffTheClash();
    let told = "";
    let merged: string | undefined;
    const read = holdNextToolCall("read", { path: HERO_FILE });
    answerWithToolCallFrom("write", ({ editorMessages, lastToolResult }) => {
      told = editorMessages.at(-1)!;
      merged = lastToolResult;
      return { path: HERO_FILE, content: LIVE_HERO };
    });
    answerNext("Live's new welcome is in, with the draft's pricing.");
    const calls = threadModelCalls();

    await pushToMain(repo, mainWith({ [HERO_FILE]: broken(marker) }));

    // The files hold the merge, which built nothing: the preview keeps the draft's revision.
    await vi.waitFor(() => expect(threadModelCalls()).toBe(calls + 2));
    expect(await blockersOf(website, draftId)).toEqual([
      { entity: "code", code: "codeDoesNotMerge" },
    ]);
    expect(await fakes.readFile(repo, draftId, HERO_FILE)).toBe(HERO);
    expect((await previewOf(website, draftId)).code).toMatchObject({
      revision: reviewed.code!.revision,
      includesLive: false,
    });

    read();
    await thread.untilIdle();
    expect(merged).toContain(marker);
    expect(told).toContain(HERO_FILE);
    expect(await fakes.readFile(repo, draftId, HERO_FILE)).toBe(LIVE_HERO);
    expect(await fakes.readFile(repo, draftId, PRICING_FILE)).toBe(PRICING);
    const preview = await previewOf(website, draftId);
    expect(preview.code).toMatchObject({ includesLive: true });
    expect(preview.blockers).toEqual([]);
  });

  it("has the Code Agent fix a merge of Live's code that no longer type checks, in a turn of its own", async () => {
    const { website, draftId, thread } = await draftChanging(PRICING_FILE, PRICING);
    const repo = website.project.uuid;
    const marker = await typeErrorsMarker([NOT_A_STRING]);
    answerByHandingOffTheClash();
    const fixed = holdNextToolCall("write", { path: HERO_FILE, content: LIVE_HERO });
    answerNext("Live's new welcome is in, with the draft's pricing.");
    const calls = threadModelCalls();
    const before = (await previewOf(website, draftId)).code!.revision;

    // Live's hero merges cleanly into the draft, but the merged code has a type error in it.
    await pushToMain(repo, mainWith({ [HERO_FILE]: `${LIVE_HERO}// ${marker}\n` }));

    await vi.waitFor(() => expect(threadModelCalls()).toBe(calls + 2));
    expect(said(thread.view()).at(-1)).toEqual({ from: "camox", text: expect.any(String) });
    const clashed = await previewOf(website, draftId);
    expect(clashed.blockers.map(({ entity, code }) => ({ entity, code }))).toEqual([
      { entity: "code", code: "codeDoesNotMerge" },
    ]);
    // The preview stays on the draft's last revision, on the old `main`.
    expect(clashed.code).toMatchObject({ revision: before, includesLive: false });

    fixed();
    await thread.untilIdle();
    expect(lastAnswer(thread.view())).toBe("Live's new welcome is in, with the draft's pricing.");
    expect(await fakes.readFile(repo, draftId, HERO_FILE)).toBe(LIVE_HERO);
    expect(await fakes.readFile(repo, draftId, PRICING_FILE)).toBe(PRICING);
    const preview = await previewOf(website, draftId);
    expect(preview.code).toMatchObject({ includesLive: true });
    expect(preview.blockers).toEqual([]);
  });
});

describe("Camox's reconcile turn that fails", () => {
  it("leaves the blocker and an explanation, and isn't tried again until Live's code moves", async () => {
    const { website, draftId, thread } = await draftChanging(HERO_FILE, OUR_HERO);
    const repo = website.project.uuid;
    const reviewed = await previewOf(website, draftId);
    // The Code Agent never fixes the conflict, and explains once the end of its request gives up.
    answerByHandingOffTheClash();
    for (let ended = 0; ended < END_OF_TURN_BUILD_FAILURES; ended++) answerNext("Done.");
    let told = "";
    answerFrom(({ editorMessages }) => {
      told = editorMessages.at(-1)!;
      return EXPLAINED;
    });

    await pushToMain(repo, mainWith({ [HERO_FILE]: LIVE_HERO }));
    await thread.until(() => lastAnswer(thread.view()) === EXPLAINED && !thread.view().running);

    expect(told).toContain("doesn't merge");
    expect(said(thread.view()).slice(-2)).toEqual([
      { from: "camox", text: expect.any(String) },
      { from: "agent", text: EXPLAINED },
    ]);
    expect(await blockersOf(website, draftId)).toEqual([
      { entity: "code", code: "codeDoesNotMerge" },
    ]);
    // Nothing with markers was committed, and the preview keeps the draft's last revision.
    expect(await fakes.readFile(repo, draftId, HERO_FILE)).toBe(OUR_HERO);
    expect((await previewOf(website, draftId)).code).toMatchObject({
      revision: reviewed.code!.revision,
      includesLive: false,
    });

    // The same move of `main` isn't merged again.
    const threadId = await threadIdOf(website.db, draftId);
    const calls = threadModelCalls();
    expect(await env.THREAD.getByName(threadId!).mergeMain()).toBe("clashedBefore");
    expect(threadModelCalls()).toBe(calls);

    // Once `main` moves again, Camox tries again, with a merge of it.
    holdNextAnswer("Reconciling.");
    await pushToMain(
      repo,
      mainWith({ [HERO_FILE]: LIVE_HERO, [PRICING_FILE]: PRICING }),
      "Another push",
    );
    await vi.waitFor(() => expect(threadModelCalls()).toBe(calls + 1));
    expect(said(thread.view()).filter(({ from }) => from === "camox")).toHaveLength(2);
  });
});

describe("a merge of main into files holding one Camox's turn didn't fix", () => {
  it("keeps what the agent wrote since, rather than merge over it", async () => {
    const { website, draftId, thread } = await draftChanging(HERO_FILE, OUR_HERO);
    const repo = website.project.uuid;
    // Camox's reconcile turn leaves the conflict, and explains once the end of its turn gives up.
    answerByHandingOffTheClash();
    for (let ended = 0; ended < END_OF_TURN_BUILD_FAILURES; ended++) answerNext("Done.");
    answerNext(EXPLAINED);
    await pushToMain(repo, mainWith({ [HERO_FILE]: LIVE_HERO }));
    await thread.until(() => lastAnswer(thread.view()) === EXPLAINED && !thread.view().running);

    // The editor asks for pricing: the Code Agent writes it beside the conflict it leaves.
    answerWithCodeRequest("Add a pricing block listing plans with their price.");
    answerWithToolCall("write", { path: PRICING_FILE, content: PRICING });
    for (let ended = 0; ended < END_OF_TURN_BUILD_FAILURES; ended++) answerNext("Done.");
    answerNext("I added pricing, but the hero still doesn't fit with Live's.");
    await ask(thread, "Add a pricing section");

    // `main` moves again.
    await pushToMain(
      repo,
      mainWith({ [HERO_FILE]: LIVE_HERO, "src/blocks/faq.tsx": `export const faq = "FAQ";\n` }),
      "Another push",
    );
    const threadId = await threadIdOf(website.db, draftId);
    await env.THREAD.getByName(threadId!).mergeMain();
    await thread.untilIdle();

    const workingCopy = env.DRAFT_CODE.getByName(draftId);
    expect(
      await workingCopy.call({ operation: "readTextFile", args: [`/${PRICING_FILE}`] }),
    ).toEqual({ ok: true, value: PRICING });
    thread.close();
  });
});

describe("conflict markers", () => {
  it("keeps build from committing a CSS file that still has them", async () => {
    const website = await websiteWithCode();
    const draftId = await startDraft(website.db, website.project.id, website.memberUser.id);
    const thread = await connectDraftThread(
      website.project.id,
      draftId,
      await signIn(website.db, website.memberUser.id),
    );
    answerWithCodeRequest("Change the accent color.");
    answerWithToolCall("write", { path: STYLES_FILE, content: CONFLICTED_STYLES });
    answerWithToolCall("build", {});
    let result: string | undefined;
    answerFrom(({ lastToolResult }) => {
      result = lastToolResult;
      return "Built.";
    });
    // The end of the turn refuses them too, and the agent fixes them.
    answerWithToolCall("write", { path: STYLES_FILE, content: STYLES });
    answerNext("I fixed the styles.");
    await ask(thread, "Change the accent color");

    expect(JSON.parse(result!)).toMatchObject({
      ok: false,
      build: [expect.objectContaining({ file: STYLES_FILE })],
    });
    expect(JSON.parse(result!)).not.toHaveProperty("revision");
    // Nothing with markers was built or committed: only the fixed styles were.
    const builds = await fakes.revisionBuilds(draftId);
    expect(builds.map(({ files }) => files[STYLES_FILE])).toEqual([STYLES]);
    expect(await fakes.readFile(website.project.uuid, draftId, STYLES_FILE)).toBe(STYLES);
  });
});
