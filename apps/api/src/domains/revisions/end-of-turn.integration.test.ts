import { DRAFT_HEADER, PUBLISH_BLOCKED_ERROR } from "@camox/api-contract/drafts";
import {
  EMPTY_THREAD_STATE,
  reduceThreadFrame,
  type ThreadView,
  threadViewOf,
} from "@camox/api-contract/threads";
import { call } from "@orpc/server";
import { abortAllDurableObjects } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createRpcContext } from "../../../test/fixtures";
import {
  broken,
  failingMarker,
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
} from "../../../test/thread-model";
import {
  ask,
  connectDraftThread,
  connectLiveThread,
  draftsOf,
  said,
  signIn,
  type ThreadClient,
  type Website,
} from "../../../test/threads";
import { router } from "../../router";
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

/** A draft whose agent added a pricing section that built, with its thread open. */
async function draftWithPricing() {
  const website = await websiteWithCode();
  const token = await signIn(website.db, website.memberUser.id);
  const live = await connectLiveThread(website.project.id, token);
  answerWithToolCall("write", { path: PRICING_FILE, content: PRICING });
  answerNext("I added a pricing section.");
  await ask(live, "Add a pricing section");
  const [draft] = await draftsOf(website);
  const thread = await connectDraftThread(website.project.id, draft!.id, token);
  return { website, draft: draft!, thread };
}

describe("the end of a turn", () => {
  it("hands the agent the errors of changes that don't build, and it fixes them", async () => {
    const marker = await failingMarker(PRICING_FILE);
    const website = await websiteWithCode();
    const live = await connectLiveThread(
      website.project.id,
      await signIn(website.db, website.memberUser.id),
    );
    let toldAfterAnswering = "";
    answerWithToolCall("write", { path: PRICING_FILE, content: broken(marker) });
    answerNext("I added a pricing section.");
    answerWithToolCallFrom("write", ({ editorMessages }) => {
      toldAfterAnswering = editorMessages.at(-1)!;
      return { path: PRICING_FILE, content: PRICING };
    });
    answerNext("I added a pricing section, and fixed its import.");

    const view = await ask(live, "Add a pricing section");

    expect(toldAfterAnswering).toContain("Could not resolve './missing'");
    expect(said(view)).toEqual([
      { from: "editor", text: "Add a pricing section" },
      { from: "agent", text: "I added a pricing section, and fixed its import." },
    ]);
    const [draft] = await draftsOf(website);
    expect(await fakes.readFile(website.project.uuid, draft!.id, PRICING_FILE)).toBe(PRICING);
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

  it("refuses to publish a draft whose code doesn't build", async () => {
    const { website, draft, thread } = await draftWithPricing();
    const marker = await failingMarker(PRICING_FILE);
    answerWithToolCall("write", { path: PRICING_FILE, content: broken(marker) });
    for (let failed = 0; failed < END_OF_TURN_BUILD_FAILURES; failed++) answerNext("Done.");
    answerNext("The pricing section can't be updated yet.");
    await ask(thread, "Show the plans from the pricing page");
    // Content changes too, so the draft has something to publish.
    const [page] = await call(
      router.pages.list,
      { projectId: website.project.id },
      reviewer(website, draft.id),
    );
    await call(
      router.blocks.create,
      { pageId: page!.id, type: "text", content: { body: "Plans" } } as never,
      reviewer(website, draft.id),
    );

    const { token } = await previewOf(website, draft.id);

    await expect(
      call(
        router.drafts.publish,
        { projectId: website.project.id, token },
        reviewer(website, draft.id),
      ),
    ).rejects.toMatchObject({ code: PUBLISH_BLOCKED_ERROR });
  });

  it("shows editors status lines while it builds and the agent fixes, never what the agent was told", async () => {
    const marker = await failingMarker(PRICING_FILE);
    const website = await websiteWithCode();
    const live = await connectLiveThread(
      website.project.id,
      await signIn(website.db, website.memberUser.id),
    );
    answerWithToolCall("write", { path: PRICING_FILE, content: broken(marker) });
    answerNext("I added a pricing section.");
    answerWithToolCall("write", { path: PRICING_FILE, content: PRICING });
    answerNext("I added a pricing section, and fixed its import.");

    await ask(live, "Add a pricing section", { keepOpen: true });
    live.close();

    const views = viewsOf(live);
    expect(statusLines(views)).toEqual(["building", "fixing", "building"]);
    const shown = new Set(views.flatMap((view) => said(view).map(({ text }) => text)));
    expect([...shown]).toEqual([
      "Add a pricing section",
      "I added a pricing section, and fixed its import.",
    ]);
  });

  it("skips building when the agent's last build covered the turn's changes", async () => {
    const website = await websiteWithCode();
    const live = await connectLiveThread(
      website.project.id,
      await signIn(website.db, website.memberUser.id),
    );
    answerWithToolCall("write", { path: PRICING_FILE, content: PRICING });
    answerWithToolCall("build", {});
    answerNext("I added a pricing section.");

    await ask(live, "Add a pricing section", { keepOpen: true });
    live.close();

    const [draft] = await draftsOf(website);
    expect(await fakes.revisionBuilds(draft!.id)).toHaveLength(1);
    expect(statusLines(viewsOf(live))).toEqual([]);
  });

  it("says the draft is building while its latest changes build", async () => {
    const { website, draft, thread } = await draftWithPricing();
    await fakes.holdBuilds();
    answerWithToolCall("write", { path: PRICING_FILE, content: `${PRICING}// Yearly plans\n` });
    answerNext("I added yearly plans.");
    thread.send({ type: "send", operationId: crypto.randomUUID(), text: "Add yearly plans" });
    await thread.until(() => thread.view().status === "building");

    const building = await previewOf(website, draft.id);
    await fakes.releaseBuilds();
    await thread.untilIdle();
    thread.close();

    expect(building.code).toMatchObject({ building: true });
    expect((await previewOf(website, draft.id)).code).toMatchObject({ building: false });
  });
});
