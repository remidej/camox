import { DRAFT_HEADER } from "@camox/api-contract/drafts";
import {
  EMPTY_THREAD_STATE,
  reduceThreadFrame,
  type ThreadView,
  threadViewOf,
} from "@camox/api-contract/threads";
import { call } from "@orpc/server";
import { abortAllDurableObjects, runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createRpcContext, startDraft } from "../../../test/fixtures";
import {
  broken,
  debuggerStatement,
  failedBuild,
  failingMarker,
  lintedMarker,
  lintRuns,
  PRICING,
  revisionFakes as fakes,
  websiteWithCode,
} from "../../../test/revision-builds";
import {
  answerFrom,
  answerNext,
  answerWithToolCall,
  answerWithToolCallFrom,
  forgetThreadModel,
  holdNextAnswer,
  threadModelCalls,
} from "../../../test/thread-model";
import {
  ask,
  connectDraftThread,
  said,
  signIn,
  type ThreadClient,
  type Website,
} from "../../../test/threads";
import { router } from "../../router";
import { INFRASTRUCTURE_ATTEMPTS } from "./build";
import { END_OF_TURN_BUILD_FAILURES } from "./end-of-turn";

// Threads run on pi-ai's fake provider, scripted per test, rather than reaching OpenRouter.
vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

afterEach(async () => {
  await abortAllDurableObjects();
  forgetThreadModel();
});

const PRICING_FILE = "src/blocks/pricing.tsx";

/** Who reviews a draft in the studio: the website's member, in the draft. */
const reviewer = ({ db, memberUser }: Website, draftId: string) => ({
  context: createRpcContext(db, memberUser, { [DRAFT_HEADER]: draftId }),
});

const previewOf = (website: Website, draftId: string) =>
  call(router.drafts.previewPublish, { projectId: website.project.id }, reviewer(website, draftId));

/** Every view the studio showed for what a socket received, in order. */
function viewsOf(thread: ThreadClient): ThreadView[] {
  let state = EMPTY_THREAD_STATE;
  return thread.frames.map((frame) => {
    state = reduceThreadFrame(state, frame);
    return threadViewOf(state);
  });
}

/** The status lines `views` showed, each once in a row. */
const statusLines = (views: ThreadView[]) =>
  views
    .map((view) => view.status)
    .filter((status, at, all) => status !== undefined && status !== all[at - 1]);

/** A new draft of the website, started by its member, with its thread open as theirs. */
async function newDraftThread(website: Website) {
  const draftId = await startDraft(website.db, website.project.id, website.memberUser.id);
  const token = await signIn(website.db, website.memberUser.id);
  return { draftId, thread: await connectDraftThread(website.project.id, draftId, token) };
}

/** A draft whose agent added a pricing section that built, with its thread open. */
async function draftWithPricing() {
  const website = await websiteWithCode();
  const { draftId, thread } = await newDraftThread(website);
  answerWithToolCall("write", { path: PRICING_FILE, content: PRICING });
  answerNext("I added a pricing section.");
  await ask(thread, "Add a pricing section", { keepOpen: true });
  return { website, draft: { id: draftId }, thread };
}

describe("the end of a turn", () => {
  it("hands the agent the errors of changes that don't build, and it fixes them", async () => {
    const marker = await failingMarker(PRICING_FILE);
    const website = await websiteWithCode();
    const { draftId, thread } = await newDraftThread(website);
    let toldAfterAnswering = "";
    answerWithToolCall("write", { path: PRICING_FILE, content: broken(marker) });
    answerNext("I added a pricing section.");
    answerWithToolCallFrom("write", ({ editorMessages }) => {
      toldAfterAnswering = editorMessages.at(-1)!;
      return { path: PRICING_FILE, content: PRICING };
    });
    answerNext("I added a pricing section, and fixed its import.");

    const view = await ask(thread, "Add a pricing section");

    expect(toldAfterAnswering).toContain("Could not resolve './missing'");
    expect(said(view)).toEqual([
      { from: "editor", text: "Add a pricing section" },
      { from: "agent", text: "I added a pricing section, and fixed its import." },
    ]);
    expect(await fakes.readFile(website.project.uuid, draftId, PRICING_FILE)).toBe(PRICING);
  });

  it("hands the agent a hosted check's error naming an import it can't make, and it fixes it", async () => {
    const marker = crypto.randomUUID();
    // As the SDK's hosted checks fail the build (packages/sdk/src/features/vite/hostedChecks.ts).
    await fakes.failBuildsOf(
      marker,
      failedBuild([
        `[plugin camox]
RolldownError: ${PRICING_FILE} imports "lodash-es", which a hosted project can't import. It can import files in src/, camox's public entry points and the packages package.json lists in dependencies.
    at error (file:///workspace/website/node_modules/rolldown/dist/logs.mjs:166:24)`,
      ]),
    );
    const website = await websiteWithCode();
    const { draftId, thread } = await newDraftThread(website);
    let told = "";
    answerWithToolCall("write", {
      path: PRICING_FILE,
      content: `import { sortBy } from "lodash-es"; // ${marker}\n${PRICING}`,
    });
    answerNext("I added a pricing section.");
    answerWithToolCallFrom("write", ({ editorMessages }) => {
      told = editorMessages.at(-1)!;
      return { path: PRICING_FILE, content: PRICING };
    });
    answerNext("I added a pricing section, without lodash.");

    const view = await ask(thread, "Add a pricing section sorted by price");

    const { build } = JSON.parse(told.slice(told.indexOf("{"))) as { build: unknown[] };
    expect(build).toEqual([
      expect.objectContaining({
        file: PRICING_FILE,
        message: expect.stringContaining(`imports "lodash-es"`),
      }),
    ]);
    expect(said(view).at(-1)).toEqual({
      from: "agent",
      text: "I added a pricing section, without lodash.",
    });
    expect((await previewOf(website, draftId)).blockers).toEqual([]);
  });

  it("commits changes that keep failing to build once the limit is reached, and the agent explains", async () => {
    const { website, draft, thread } = await draftWithPricing();
    const built = (await previewOf(website, draft.id)).code;
    const marker = await failingMarker(PRICING_FILE);
    let told = "";
    answerWithToolCall("write", { path: PRICING_FILE, content: broken(marker) });
    // The agent answers without fixing anything, every time the end of the turn sends it back.
    for (let failed = 0; failed < END_OF_TURN_BUILD_FAILURES; failed++) answerNext("Done.");
    answerFrom(({ editorMessages }) => {
      told = editorMessages.at(-1)!;
      return "The pricing section can't show its plans yet: the preview still shows the old one.";
    });

    const view = await ask(thread, "Show the plans from the pricing page");

    expect(told).toContain("preview");
    expect(said(view)).toEqual([
      { from: "editor", text: "Add a pricing section" },
      { from: "agent", text: "I added a pricing section." },
      { from: "editor", text: "Show the plans from the pricing page" },
      {
        from: "agent",
        text: "The pricing section can't show its plans yet: the preview still shows the old one.",
      },
    ]);
    // The changes are committed anyway, on the draft's branch.
    expect(await fakes.readFile(website.project.uuid, draft.id, PRICING_FILE)).toBe(broken(marker));
    const preview = await previewOf(website, draft.id);
    expect(preview.code).toEqual({ ...built, building: false });
    expect(preview.blockers).toEqual([
      expect.objectContaining({ entity: "code", code: "codeDoesNotBuild" }),
    ]);
  });

  it("goes on fixing as long as the end of the turn failed fewer times than the limit", async () => {
    const { website, draft, thread } = await draftWithPricing();
    const marker = await failingMarker(PRICING_FILE);
    answerWithToolCall("write", { path: PRICING_FILE, content: broken(marker) });
    for (let failed = 1; failed < END_OF_TURN_BUILD_FAILURES; failed++) answerNext("Done.");
    let told = "";
    answerWithToolCallFrom("write", ({ editorMessages }) => {
      told = editorMessages.at(-1)!;
      return { path: PRICING_FILE, content: PRICING };
    });
    answerNext("I fixed the pricing section.");

    const view = await ask(thread, "Show the plans from the pricing page");

    // Still told the errors to fix, not to give up.
    expect(told).toContain("Could not resolve './missing'");
    expect(said(view).at(-1)).toEqual({ from: "agent", text: "I fixed the pricing section." });
    expect((await previewOf(website, draft.id)).blockers).toEqual([]);
  });

  it("shows editors status lines while it builds and the agent fixes, never what the agent was told", async () => {
    const marker = await failingMarker(PRICING_FILE);
    const website = await websiteWithCode();
    const { thread } = await newDraftThread(website);
    answerWithToolCall("write", { path: PRICING_FILE, content: broken(marker) });
    answerNext("I added a pricing section.");
    answerWithToolCall("write", { path: PRICING_FILE, content: PRICING });
    answerNext("I added a pricing section, and fixed its import.");

    await ask(thread, "Add a pricing section", { keepOpen: true });
    thread.close();

    const views = viewsOf(thread);
    expect(statusLines(views)).toEqual(["building", "fixing", "building"]);
    const shown = new Set(views.flatMap((view) => said(view).map(({ text }) => text)));
    expect([...shown]).toEqual([
      "Add a pricing section",
      "I added a pricing section, and fixed its import.",
    ]);
  });

  it("skips building when the agent's last build covered the turn's changes", async () => {
    const website = await websiteWithCode();
    const { draftId, thread } = await newDraftThread(website);
    answerWithToolCall("write", { path: PRICING_FILE, content: PRICING });
    answerWithToolCall("build", {});
    answerNext("I added a pricing section.");

    await ask(thread, "Add a pricing section", { keepOpen: true });
    thread.close();

    expect(await fakes.revisionBuilds(draftId)).toHaveLength(1);
    expect(statusLines(viewsOf(thread))).toEqual([]);
  });

  it("says the draft is building while its latest changes build", async () => {
    const { website, draft, thread } = await draftWithPricing();
    await fakes.holdBuilds(draft.id);
    answerWithToolCall("write", { path: PRICING_FILE, content: `${PRICING}// Yearly plans\n` });
    answerNext("I added yearly plans.");
    thread.send({ type: "send", operationId: crypto.randomUUID(), text: "Add yearly plans" });
    await thread.until(() => thread.view().status === "building");

    const building = await previewOf(website, draft.id);
    await fakes.releaseBuilds(draft.id);
    await thread.untilIdle();
    thread.close();

    expect(building.code).toMatchObject({ building: true });
    expect((await previewOf(website, draft.id)).code).toMatchObject({ building: false });
  });
});

describe("an end of turn that fails on Camox's side", () => {
  /** Has the agent change the pricing section, holding `marker`, and end its turn. */
  async function changePricing(thread: ThreadClient, marker: string) {
    answerWithToolCall("write", { path: PRICING_FILE, content: `${PRICING}// ${marker}\n` });
    answerNext("I added yearly plans.");
    await ask(thread, "Add yearly plans");
  }

  /** Runs the retry Camox scheduled for the draft's build, if any. Whether one was scheduled. */
  const retryBuild = (draftId: string) =>
    runDurableObjectAlarm(env.DRAFT_CODE.getByName(draftId) as never);

  it("leaves the draft building, not publishable, until Camox's retry builds it", async () => {
    const { website, draft, thread } = await draftWithPricing();
    const before = (await previewOf(website, draft.id)).code!.revision;
    const marker = crypto.randomUUID();
    await fakes.crashSandboxes(marker, INFRASTRUCTURE_ATTEMPTS);
    await changePricing(thread, marker);

    expect((await previewOf(website, draft.id)).code).toMatchObject({
      revision: before,
      building: true,
    });

    expect(await retryBuild(draft.id)).toBe(true);
    const after = (await previewOf(website, draft.id)).code!;
    expect(after).toMatchObject({ building: false });
    expect(after.revision).not.toBe(before);
    expect(await retryBuild(draft.id)).toBe(false);
    thread.close();
  });

  it("leaves the draft building until Camox checks the types of a revision whose check crashed", async () => {
    const { website, draft, thread } = await draftWithPricing();
    const marker = crypto.randomUUID();
    await fakes.crashTypeChecks(marker, INFRASTRUCTURE_ATTEMPTS);
    await changePricing(thread, marker);

    // The revision built, and the preview shows it, but its type check never ran.
    const checking = (await previewOf(website, draft.id)).code!;
    expect(checking).toMatchObject({ building: true });

    expect(await retryBuild(draft.id)).toBe(true);
    expect((await previewOf(website, draft.id)).code).toMatchObject({
      revision: checking.revision,
      building: false,
    });
    thread.close();
  });

  it("says the draft is building while its agent's revision, whose check crashed, isn't checked", async () => {
    const { website, draft, thread } = await draftWithPricing();
    const marker = crypto.randomUUID();
    await fakes.crashTypeChecks(marker, INFRASTRUCTURE_ATTEMPTS);
    answerWithToolCall("write", { path: PRICING_FILE, content: `${PRICING}// ${marker}\n` });
    answerWithToolCall("build", {});
    const calls = threadModelCalls();
    const answer = holdNextAnswer("I added yearly plans.");
    thread.send({ type: "send", operationId: crypto.randomUUID(), text: "Add yearly plans" });
    // The agent has its build's answer: the revision built, and its check failed on Camox's side.
    await vi.waitFor(() => expect(threadModelCalls()).toBe(calls + 3), {
      timeout: 10_000,
      interval: 50,
    });

    expect((await previewOf(website, draft.id)).code).toMatchObject({ building: true });
    answer();
    await thread.untilIdle();
    // The end of the turn checks it again.
    expect((await previewOf(website, draft.id)).code).toMatchObject({ building: false });
    thread.close();
  });
});

describe("lint at the end of a turn", () => {
  /** A new draft's thread on a website with code, as its member. */
  async function draftThreadOf() {
    const website = await websiteWithCode();
    return { website, ...(await newDraftThread(website)) };
  }

  /** Pricing code that builds, with a lint finding the fake sandbox reports for its marker. */
  const linted = (marker: string) => `${PRICING}// ${marker}\n`;

  it("hands the agent the turn's lint findings once, and the turn ends though it doesn't fix them", async () => {
    const marker = await lintedMarker([debuggerStatement(PRICING_FILE, 2)]);
    const { website, draftId, thread } = await draftThreadOf();
    let told = "";
    answerWithToolCall("write", { path: PRICING_FILE, content: linted(marker) });
    answerNext("I added a pricing section.");
    answerFrom(({ editorMessages }) => {
      told = editorMessages.at(-1)!;
      return "I added a pricing section.";
    });

    const view = await ask(thread, "Add a pricing section");

    expect(told).toContain("eslint(no-debugger)");
    expect(told).toContain(PRICING_FILE);
    expect(said(view)).toEqual([
      { from: "editor", text: "Add a pricing section" },
      { from: "agent", text: "I added a pricing section." },
    ]);
    expect(threadModelCalls()).toBe(3);
    expect((await previewOf(website, draftId)).blockers).toEqual([]);
  });

  it("doesn't lint the agent's fix again in the same turn", async () => {
    const marker = await lintedMarker([debuggerStatement(PRICING_FILE, 2)]);
    const { draftId, thread } = await draftThreadOf();
    answerWithToolCall("write", { path: PRICING_FILE, content: linted(marker) });
    answerNext("I added a pricing section.");
    // A fix that still has the finding: the end of the turn builds it, and lets the turn end.
    answerWithToolCall("write", { path: PRICING_FILE, content: `${linted(marker)}// Fixed\n` });
    answerNext("I added a pricing section, and tidied its code.");

    const view = await ask(thread, "Add a pricing section");

    expect(said(view).at(-1)).toEqual({
      from: "agent",
      text: "I added a pricing section, and tidied its code.",
    });
    expect(await fakes.revisionBuilds(draftId)).toHaveLength(2);
    expect(await lintRuns(draftId)).toBe(1);
  });

  it("lints a turn whose last build covered its changes", async () => {
    const marker = await lintedMarker([debuggerStatement(PRICING_FILE, 2)]);
    const { thread } = await draftThreadOf();
    let told = "";
    answerWithToolCall("write", { path: PRICING_FILE, content: linted(marker) });
    answerWithToolCall("build", {});
    answerNext("I added a pricing section.");
    answerFrom(({ editorMessages }) => {
      told = editorMessages.at(-1)!;
      return "I added a pricing section.";
    });

    await ask(thread, "Add a pricing section");

    expect(told).toContain("eslint(no-debugger)");
  });

  it("doesn't lint a turn that left the code as it was", async () => {
    const marker = await lintedMarker([debuggerStatement(PRICING_FILE, 2)]);
    const { website, draftId, thread: first } = await draftThreadOf();
    answerWithToolCall("write", { path: PRICING_FILE, content: linted(marker) });
    answerNext("I added a pricing section.");
    answerNext("I added a pricing section.");
    await ask(first, "Add a pricing section");
    const linting = await lintRuns(draftId);
    const thread = await connectDraftThread(
      website.project.id,
      draftId,
      await signIn(website.db, website.memberUser.id),
    );
    answerNext("The pricing section shows plans from $9.");

    const view = await ask(thread, "What does the pricing section say?");

    expect(said(view).at(-1)).toEqual({
      from: "agent",
      text: "The pricing section shows plans from $9.",
    });
    expect(await lintRuns(draftId)).toBe(linting);
  });
});
