import { abortAllDurableObjects } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { startDraft } from "../../../test/fixtures";
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
  answerWithScript,
  answerWithToolCall,
  answerWithToolCallFrom,
  forgetThreadModel,
  type ModelRequest,
  threadModelCalls,
} from "../../../test/thread-model";
import {
  ask,
  connectDraftThread,
  lastAnswer,
  pagesOf,
  said,
  signIn,
  textDefinition,
  type Website,
} from "../../../test/threads";
import { END_OF_TURN_BUILD_FAILURES } from "../revisions/end-of-turn";

// Threads run on pi-ai's fake provider, scripted per test: the thread's agent and its Code Agent
// take their answers from the same script, in the order they're called.
vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

afterEach(async () => {
  await abortAllDurableObjects();
  forgetThreadModel();
});

const PRICING_FILE = "src/blocks/pricing.tsx";

const pricingDefinition = {
  blockId: "pricing",
  title: "Pricing",
  description: "Plans and their prices",
  contentSchema: {
    type: "object",
    toMarkdown: ["{{headline}}"],
    properties: { headline: { type: "string", fieldType: "String" } },
  },
};

/** A new draft of the website, started by its member, with its thread open as theirs. */
async function newDraftThread(website: Website) {
  const draftId = await startDraft(website.db, website.project.id, website.memberUser.id);
  const token = await signIn(website.db, website.memberUser.id);
  return { draftId, thread: await connectDraftThread(website.project.id, draftId, token) };
}

describe("a draft thread's Code Agent", () => {
  it("writes the code the agent's request asks for, and its answer ends the turn as the agent's", async () => {
    const website = await websiteWithCode();
    const { draftId, thread } = await newDraftThread(website);
    answerWithToolCall("code", {
      request: "Add a pricing block listing plans with their price.",
      final: true,
    });
    answerWithToolCall("write", { path: PRICING_FILE, content: PRICING });
    // The Code Agent reads the agent's request alone, never the editor's message.
    answerFrom(({ editorMessages }) => `Done: ${editorMessages.join(" | ")}`);

    const view = await ask(thread, "Add a pricing section");

    expect(said(view)).toEqual([
      { from: "editor", text: "Add a pricing section" },
      { from: "agent", text: "Done: Add a pricing block listing plans with their price." },
    ]);
    // The agent wasn't called again to repeat the answer.
    expect(threadModelCalls()).toBe(3);
    expect(await fakes.readFile(website.project.uuid, draftId, PRICING_FILE)).toBe(PRICING);
  });

  it("keeps one conversation per draft thread, which reads the earlier requests", async () => {
    const website = await websiteWithCode();
    const { thread } = await newDraftThread(website);
    answerWithToolCall("code", { request: "Add a pricing block.", final: true });
    answerWithToolCall("write", { path: PRICING_FILE, content: PRICING });
    answerNext("I added a Pricing block.");
    await ask(thread, "Add a pricing section", { keepOpen: true });

    let agentSaw: ModelRequest | undefined;
    answerWithToolCallFrom("code", (request) => {
      agentSaw = request;
      return { request: "Give the Pricing block a compact Block Setting.", final: true };
    });
    answerFrom(({ editorMessages }) => editorMessages.join(" | "));
    const view = await ask(thread, "Make the pricing more compact");

    // The Code Agent read the first request as well as the second.
    expect(lastAnswer(view)).toBe(
      "Add a pricing block. | Give the Pricing block a compact Block Setting.",
    );
    // The thread's agent read the first answer, never the code.
    expect(agentSaw?.lastToolResult).toBe("I added a Pricing block.");
    expect(JSON.stringify(agentSaw)).not.toContain(PRICING.trim());
  });

  it("builds each request's changes and sends the Code Agent back to fix what doesn't build", async () => {
    const marker = await failingMarker(PRICING_FILE);
    const website = await websiteWithCode();
    const { draftId, thread } = await newDraftThread(website);
    answerWithToolCall("code", { request: "Add a pricing block.", final: true });
    answerWithToolCall("write", { path: PRICING_FILE, content: broken(marker) });
    answerNext("I added a Pricing block.");
    let told = "";
    answerWithToolCallFrom("write", ({ editorMessages }) => {
      told = editorMessages.at(-1)!;
      return { path: PRICING_FILE, content: PRICING };
    });
    answerNext("I added a Pricing block, and fixed its import.");

    const view = await ask(thread, "Add a pricing section");

    expect(told).toContain("Could not resolve './missing'");
    expect(said(view).at(-1)).toEqual({
      from: "agent",
      text: "I added a Pricing block, and fixed its import.",
    });
    expect(await fakes.readFile(website.project.uuid, draftId, PRICING_FILE)).toBe(PRICING);
  });

  it("returns the Code Agent's explanation once its changes failed to build too many times", async () => {
    const marker = await failingMarker(PRICING_FILE);
    const website = await websiteWithCode();
    const { thread } = await newDraftThread(website);
    answerWithToolCall("code", { request: "Add a pricing block.", final: false });
    answerWithToolCall("write", { path: PRICING_FILE, content: broken(marker) });
    // The Code Agent answers without fixing anything, every time its request's end sends it back.
    for (let failed = 0; failed < END_OF_TURN_BUILD_FAILURES; failed++) answerNext("Done.");
    answerNext("The Pricing block doesn't build yet: an import is missing.");
    answerFrom(({ lastToolResult }) => `Not yet. (${lastToolResult})`);

    const view = await ask(thread, "Add a pricing section");

    expect(lastAnswer(view)).toBe(
      "Not yet. (The Pricing block doesn't build yet: an import is missing.)",
    );
  });

  it("builds a Block Definition the agent can place as soon as the Code Agent answers", async () => {
    const website = await websiteWithCode();
    const marker = crypto.randomUUID();
    await fakes.defineBuildsOf(marker, {
      blocks: [textDefinition, pricingDefinition],
      layouts: [{ layoutId: website.layout.layoutId, description: "Default", blocks: [] }],
      collections: [],
      homepage: null,
    });
    const { draftId, thread } = await newDraftThread(website);
    answerWithToolCall("code", { request: "Add a pricing block.", final: false });
    answerWithToolCall("write", {
      path: PRICING_FILE,
      content: `export const block = "built"; // ${marker}\n`,
    });
    answerNext("I added the Block Definition `pricing`, with a `headline` field.");
    answerWithScript(`
      const { blockTypes } = await tools.describeBlockTypes({ types: ["pricing"] });
      const [home] = await tools.listPages({});
      await tools.createBlock({ pageId: home.id, type: "pricing", content: { headline: "Plans start at $9" } });
      text(blockTypes.map((type) => type.title).join(", "));
    `);
    answerFrom(({ scriptOutput }) => `Placed: ${scriptOutput}`);

    const view = await ask(thread, "Add a pricing section saying plans start at $9");

    // The agent's script found the Block Definition before the end of its own turn built anything.
    expect(lastAnswer(view)).toBe("Placed: Pricing");
    expect(await pagesOf(website, draftId)).toEqual({
      "/home": ["<!-- Text -->\nHello", "<!-- Pricing -->\nPlans start at $9"],
    });
  });

  it("offers the Code Agent the code, web and font tools, look and build, and no content tools or code mode", async () => {
    const website = await websiteWithCode();
    const { thread } = await newDraftThread(website);
    answerWithToolCall("code", { request: "What can you do?", final: true });
    let offered: string[] = [];
    answerFrom(({ offeredTools }) => {
      offered = offeredTools;
      return "Code.";
    });

    await ask(thread, "What can you do with code?");

    expect(offered.toSorted()).toEqual([
      "build",
      "conflicts",
      "edit",
      "find",
      "grep",
      "look",
      "ls",
      "mv",
      "read",
      "rm",
      "searchFonts",
      "web_fetch",
      "web_search",
      "write",
    ]);
  });

  it("shows the Code Agent's activity as the agent's, and stopping the run stops it", async () => {
    const website = await websiteWithCode();
    const { draftId, thread } = await newDraftThread(website);
    await fakes.holdBuilds(draftId);
    answerWithToolCall("code", { request: "Add a pricing block.", final: true });
    answerWithToolCall("write", { path: PRICING_FILE, content: PRICING });
    answerWithToolCall("build", {});
    thread.send({ type: "send", operationId: crypto.randomUUID(), text: "Add a pricing section" });

    // The studio shows the Code Agent's build as the agent's.
    await thread.until(() => thread.view().activity === "building");
    thread.send({ type: "stop" });
    // A build going finishes, as stopping the agent's own build does.
    await thread.until(() => thread.view().messages.some(({ from }) => from === "stopped"));
    await fakes.releaseBuilds(draftId);
    await thread.untilIdle(2);

    // The Code Agent, stopped, takes the next request rather than finish the stopped one.
    answerWithToolCall("code", { request: "Add a pricing block, again.", final: true });
    answerFrom(({ editorMessages }) => editorMessages.at(-1)!);
    const view = await ask(thread, "Try again");

    expect(said(view).at(-1)).toEqual({ from: "agent", text: "Add a pricing block, again." });
  });
});
