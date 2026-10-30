import { DRAFT_HEADER } from "@camox/api-contract/drafts";
import { call } from "@orpc/server";
import { abortAllDurableObjects } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { contentFieldBuilder as field } from "../../../../../packages/sdk/src/core/lib/contentType";
import {
  callSeedingLive,
  createRpcContext,
  createServiceContext,
  startDraft,
  syncDefinitionSet,
} from "../../../test/fixtures";
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
  said,
  signIn,
  textDefinition,
  touchedOf,
  websiteFixture,
} from "../../../test/threads";
import { runService } from "../../lib/run-service";
import { readArtifactField } from "../artifact-sources/field";
import { blockProcedures } from "../blocks/routes";
import { pageProcedures } from "../pages/routes";
import { ARTIFACT_PATH } from "./env";

// Threads run on pi-ai's fake provider, scripted per test: the thread's agent and its Artifact
// Agents take their answers from the same script, in the order they're called.
vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

afterEach(async () => {
  await abortAllDurableObjects();
  forgetThreadModel();
});

const ORBIT = `<!doctype html><title>Orbit</title><script>const speed = 1;</script>`;

/** A block definition with an artifact field, `visual`, beside a heading. */
const visualDefinition = {
  blockId: "visual",
  title: "Visual",
  description: "A heading over an artifact",
  contentSchema: {
    type: "object",
    properties: {
      heading: field.string({ default: "" }),
      visual: field.artifact({ size: "fill" }),
    },
  },
};

/**
 * A website whose Live page `/visual` holds a block of `visualDefinition`, with `source` in its
 * artifact, and a draft the fixture member started, with its thread open.
 */
async function artifactFixture(source = "") {
  const website = await websiteFixture({});
  const { db, memberUser, project } = website;
  await syncDefinitionSet(db, project, { blocks: [textDefinition, visualDefinition] });
  const options = { context: createRpcContext(db, memberUser) };
  const { page } = await callSeedingLive(
    pageProcedures.create,
    { projectId: project.id, pathSegment: "visual", layoutId: website.layout.layoutId },
    options,
  );
  const block = await callSeedingLive(
    blockProcedures.create,
    { pageId: page.id, type: "visual", content: { heading: "How it works", visual: source } },
    options,
  );
  const draftId = await startDraft(db, project.id, memberUser.id);
  const thread = await connectDraftThread(project.id, draftId, await signIn(db, memberUser.id));
  /** The artifact's source, as the draft reads it. */
  const source_ = () =>
    runService(
      readArtifactField(
        { ...createServiceContext(db, memberUser), draft: { id: draftId, create: false } },
        { block: block.id, field: "visual" },
      ),
    );
  /** The block as the draft reads it, through the studio's procedure. */
  const shownBlock = () =>
    call(
      blockProcedures.get,
      { id: block.id },
      { context: createRpcContext(db, memberUser, { [DRAFT_HEADER]: draftId }) },
    );
  return { website, draftId, thread, block, page, source: source_, shownBlock };
}

describe("an artifact's Artifact Agent", () => {
  it("writes the source the agent hands it, and its answer ends the turn as the agent's", async () => {
    const { thread, block, page, source } = await artifactFixture();
    answerWithToolCall("artifact", {
      block: block.id,
      field: "visual",
      request: "Draw a planet orbiting its sun.",
      final: true,
    });
    answerWithToolCall("write", { path: ARTIFACT_PATH, content: ORBIT });
    answerNext("I drew a planet orbiting its sun.");
    const operationId = crypto.randomUUID();

    const view = await ask(thread, "Add an orbit animation", { keepOpen: true, operationId });

    expect(said(view)).toEqual([
      { from: "editor", text: "Add an orbit animation" },
      { from: "agent", text: "I drew a planet orbiting its sun." },
    ]);
    // The agent wasn't called again to repeat the answer.
    expect(threadModelCalls()).toBe(3);
    expect(await source()).toBe(ORBIT);
    // The studio that asked follows the write to the block, as for any content write.
    expect(touchedOf(thread)).toContainEqual({
      operationIds: [operationId],
      touches: [expect.objectContaining({ entity: "page", pageId: page.id, blockId: block.id })],
    });
  });

  it("keeps one conversation per artifact, which reads the earlier requests and edits the source in place", async () => {
    const { thread, block, source } = await artifactFixture();
    const artifactCall = (request: string) => ({
      block: block.id,
      field: "visual",
      request,
      final: true,
    });
    answerWithToolCall("artifact", artifactCall("Draw a planet orbiting its sun."));
    answerWithToolCall("write", { path: ARTIFACT_PATH, content: ORBIT });
    answerNext("I drew a planet orbiting its sun.");
    await ask(thread, "Add an orbit animation", { keepOpen: true });

    let agentSaw: ModelRequest | undefined;
    answerWithToolCallFrom("artifact", (request) => {
      agentSaw = request;
      return artifactCall("Make it slower.");
    });
    answerWithToolCall("edit", {
      path: ARTIFACT_PATH,
      edits: [{ oldText: "speed = 1", newText: "speed = 0.5" }],
    });
    answerFrom(({ editorMessages }) => editorMessages.join(" | "));
    const view = await ask(thread, "Slower please");

    expect(await source()).toBe(ORBIT.replace("speed = 1", "speed = 0.5"));
    // The Artifact Agent read the first request as well as the second.
    expect(lastAnswer(view)).toContain("Draw a planet orbiting its sun.");
    expect(lastAnswer(view)).toContain("Make it slower.");
    // The thread's agent read the first answer, never the source.
    expect(agentSaw?.lastToolResult).toBe("I drew a planet orbiting its sun.");
    expect(JSON.stringify(agentSaw)).not.toContain("speed = 1");
  });

  it("answers the agent, which ends the turn itself, when the call doesn't end it", async () => {
    const { thread, block } = await artifactFixture();
    answerWithToolCall("artifact", {
      block: block.id,
      field: "visual",
      request: "Draw a planet orbiting its sun.",
      final: false,
    });
    answerWithToolCall("write", { path: ARTIFACT_PATH, content: ORBIT });
    answerNext("I drew a planet orbiting its sun.");
    answerFrom(({ lastToolResult }) => `Done, and the heading too. (${lastToolResult})`);

    const view = await ask(thread, "Add an orbit animation and fix the heading");

    expect(said(view)).toEqual([
      { from: "editor", text: "Add an orbit animation and fix the heading" },
      { from: "agent", text: "Done, and the heading too. (I drew a planet orbiting its sun.)" },
    ]);
  });

  it("tells the Artifact Agent why a write was refused, leaving the source as it was", async () => {
    const { thread, block, source } = await artifactFixture(ORBIT);
    answerWithToolCall("artifact", {
      block: block.id,
      field: "visual",
      request: "Inline three.js.",
      final: true,
    });
    answerWithToolCall("write", { path: ARTIFACT_PATH, content: "x".repeat(300 * 1024) });
    answerFrom(({ lastToolResult }) => lastToolResult);

    const view = await ask(thread, "Inline three.js in the animation");

    expect(lastAnswer(view)).toContain("Artifact source is larger than");
    expect(await source()).toBe(ORBIT);
  });

  it("fails the agent's call naming a field that isn't an artifact, starting nothing", async () => {
    const { thread, block } = await artifactFixture();
    answerWithToolCall("artifact", {
      block: block.id,
      field: "heading",
      request: "Animate the heading.",
      final: true,
    });
    answerFrom(({ lastToolResult }) => lastToolResult);

    const view = await ask(thread, "Animate the heading");

    expect(lastAnswer(view)).toContain("isn't an artifact field");
    expect(threadModelCalls()).toBe(2);
  });
});

describe("the agent's reads of a draft with artifacts", () => {
  it("leave Artifact Sources out, with their title, and refuse one written back", async () => {
    const { thread, block, shownBlock } = await artifactFixture(ORBIT);
    answerWithScript(`
      const { block } = await tools.getBlock({ id: ${JSON.stringify(block.id)} });
      let written = "";
      try {
        await tools.editBlock({ id: block.id, content: { visual: block.content.visual } });
      } catch (error) {
        written = error.message;
      }
      text(JSON.stringify({ visual: block.content.visual, written }));
    `);
    answerFrom(({ scriptOutput }) => scriptOutput);

    const view = await ask(thread, "What's in the visual?");

    const { visual, written } = JSON.parse(lastAnswer(view)!) as Record<string, string>;
    expect(visual).toContain('[Artifact Source "Orbit"');
    expect(visual).not.toContain("speed");
    expect(written).toContain("ARTIFACT_SOURCE_LEFT_OUT");
    expect((await shownBlock()).block.content).toMatchObject({ visual: ORBIT });
  });
});
