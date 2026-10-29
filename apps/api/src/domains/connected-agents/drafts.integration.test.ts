import { DRAFT_HEADER } from "@camox/api-contract/drafts";
import { call } from "@orpc/server";
import { abortAllDurableObjects } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vite-plus/test";

import { callTool, connectAgent, listTools, mcpRequest } from "../../../test/connected-agents";
import { addMember, createRpcContext, startDraft } from "../../../test/fixtures";
import {
  answerFrom,
  answerNext,
  answerWithScript,
  failNext,
  forgetThreadModel,
  holdNextScript,
} from "../../../test/thread-model";
import {
  ask,
  connectDraftThread,
  draftsOf,
  lastAnswer,
  said,
  signIn,
  type Website,
  websiteFixture,
} from "../../../test/threads";
import { router } from "../../router";
import type { Bindings } from "../../types";

// A Connected Agent starts a draft with its message, and Camox's agent works on it there as it
// would for an editor (ADR 0030). The call waits for the agent's turn to end.

// Threads run on pi-ai's fake provider, scripted per test, rather than reaching OpenRouter.
vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

afterEach(async () => {
  await abortAllDurableObjects();
  vi.restoreAllMocks();
  forgetThreadModel();
});

const REQUEST =
  "Add a page about our new export feature. It exports every page as PDF, for agencies.";

/** Waits until `check` holds, as the draft's thread works on its own. */
async function until(check: () => Promise<boolean>) {
  const deadline = Date.now() + 10_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("It never happened");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** The draft's thread, as an editor of `website` sees it in the studio. */
const editorOnDraft = async (website: Website, draftId: string, userId = website.memberUser.id) =>
  connectDraftThread(website.project.id, draftId, await signIn(website.db, userId));

/** The draft `draftId` of `website`, as its member reaches it through the API. */
const inDraft = (website: Website, draftId: string) => ({
  context: createRpcContext(website.db, website.memberUser, { [DRAFT_HEADER]: draftId }),
});

/** Publishes the draft `draftId` of `website`, as its member would in the studio. */
async function publishDraft(website: Website, draftId: string) {
  const input = { projectId: website.project.id };
  const { token } = await call(router.drafts.previewPublish, input, inDraft(website, draftId));
  await call(router.drafts.publish, { ...input, token }, inDraft(website, draftId));
}

/** What `start_draft` answered, read as the Connected Agent reads it. */
const answerOf = (result: { isError?: boolean; content: { text: string }[] }) => {
  expect(result.isError, result.content[0]?.text).toBeFalsy();
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
};

describe("start_draft", () => {
  it("starts a draft named as asked, created by the member, opening its thread with the Connected Agent's message", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const { memberUser, project } = website;
    const { accessToken } = await connectAgent(memberUser.id, { clientName: "Claude" });
    answerFrom(({ editorMessages }) => `You asked: ${editorMessages.at(-1)}`);

    const answer = answerOf(
      await callTool(accessToken, "start_draft", { name: "Export feature page", message: REQUEST }),
    );

    const [draft] = await draftsOf(website);
    expect(draft).toMatchObject({ name: "Export feature page", createdBy: { id: memberUser.id } });
    expect(answer).toMatchObject({
      draft: draft!.id,
      turn: "answered",
      message: `You asked: ${REQUEST}`,
      blockers: [],
    });
    const thread = await connectDraftThread(
      project.id,
      draft!.id,
      await signIn(website.db, memberUser.id),
    );
    expect(thread.view().messages).toEqual([
      {
        id: expect.any(String),
        from: "connectedAgent",
        member: { id: memberUser.id, name: memberUser.name, image: memberUser.image },
        client: { name: "Claude", verified: true },
        text: REQUEST,
      },
      { id: expect.any(String), from: "agent", text: `You asked: ${REQUEST}` },
    ]);
  });

  it("answers with a studio link to the draft on the page the turn changed", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const { accessToken } = await connectAgent(website.memberUser.id);
    answerWithScript(`
      const pricing = await tools.getPage({ path: "/pricing" });
      await tools.editBlock({ id: pricing.blocks[0].id, content: { body: "Plans start at $12." } });
    `);
    answerNext("Raised the price to $12.");

    const answer = answerOf(
      await callTool(accessToken, "start_draft", {
        name: "New prices",
        message: "Plans now start at $12, from next month.",
      }),
    );

    const [draft] = await draftsOf(website);
    expect(answer).toMatchObject({ turn: "answered", message: "Raised the price to $12." });
    expect(answer.studioLink).toBe(
      `https://${website.project.slug}.camox.site/pricing?camox-draft=${draft!.id}`,
    );
  });

  it("links to the website's home page when the turn changed no page", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const { accessToken } = await connectAgent(website.memberUser.id);
    answerNext("Which plans should change?");

    const answer = answerOf(
      await callTool(accessToken, "start_draft", { name: "New prices", message: "Raise prices." }),
    );

    const [draft] = await draftsOf(website);
    expect(answer.studioLink).toBe(
      `https://${website.project.slug}.camox.site/?camox-draft=${draft!.id}`,
    );
  });

  it("answers with the draft's Blockers", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9.", about: "About us." });
    const { accessToken } = await connectAgent(website.memberUser.id);
    // Two pages at one path can't be published.
    answerWithScript(`await tools.updatePage({ path: "/about", pathSegment: "pricing" });`);
    answerNext("Moved the about page.");

    const answer = answerOf(
      await callTool(accessToken, "start_draft", {
        name: "Move about",
        message: "Move the about page to /pricing.",
      }),
    );

    expect(answer.blockers).toEqual([{ problem: expect.any(String), page: "/pricing" }]);
  });

  it("says when the agent's turn failed", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const { accessToken } = await connectAgent(website.memberUser.id);
    failNext();

    const answer = answerOf(
      await callTool(accessToken, "start_draft", { name: "New prices", message: "Raise prices." }),
    );

    expect(answer).toMatchObject({ turn: "failed", blockers: [] });
    expect(answer).not.toHaveProperty("message");
  });

  it("says which editor stopped the agent's turn", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const teammate = await addMember(website.db, website.project.organizationId);
    const { accessToken } = await connectAgent(website.memberUser.id);
    holdNextScript(`text("looking");`);

    const answering = callTool(accessToken, "start_draft", {
      name: "New prices",
      message: "Raise prices.",
    });
    await until(async () => (await draftsOf(website)).length === 1);
    const [draft] = await draftsOf(website);
    const thread = await editorOnDraft(website, draft!.id, teammate.id);
    await thread.until(() => thread.view().running);
    thread.send({ type: "stop" });

    expect(answerOf(await answering)).toMatchObject({
      draft: draft!.id,
      turn: "stopped",
      stoppedBy: teammate.name,
    });
  });

  it("says the agent is still working past the wait, with the draft's id, and the turn carries on", async () => {
    const bindings = env as unknown as Bindings;
    bindings.CONNECTED_AGENT_TURN_WAIT_MS = "0";
    onTestFinished(() => {
      delete bindings.CONNECTED_AGENT_TURN_WAIT_MS;
    });
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const { accessToken } = await connectAgent(website.memberUser.id);
    const release = holdNextScript(`text("looking");`);
    answerNext("Raised the prices.");

    const answer = answerOf(
      await callTool(accessToken, "start_draft", { name: "New prices", message: "Raise prices." }),
    );

    const [draft] = await draftsOf(website);
    expect(answer).toMatchObject({ draft: draft!.id, turn: "stillWorking" });
    const thread = await editorOnDraft(website, draft!.id);
    expect(thread.view().running).toBe(true);
    release();
    await thread.untilIdle();
    expect(lastAnswer(thread.view())).toBe("Raised the prices.");
  });

  it("names an unverified client as only what it says it is", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const { accessToken } = await connectAgent(website.memberUser.id, {
      clientName: "Claude",
      registration: "dynamic",
    });
    answerNext("Done.");

    await callTool(accessToken, "start_draft", { name: "New prices", message: "Raise prices." });

    const [draft] = await draftsOf(website);
    const [opening] = (await editorOnDraft(website, draft!.id)).view().messages;
    expect(opening).toMatchObject({
      from: "connectedAgent",
      client: { name: "Claude", verified: false },
    });
  });
});

describe("send_message", () => {
  it("continues a draft an editor started, named by a studio link", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const { db, memberUser, project } = website;
    const draftId = await startDraft(db, project.id, memberUser.id);
    answerNext("Which tone do you want?");
    await ask(await editorOnDraft(website, draftId), "Make the pricing page friendlier.");
    const { accessToken } = await connectAgent(memberUser.id, { clientName: "Claude" });
    answerFrom(({ editorMessages }) => `You said: ${editorMessages.at(-1)}`);

    const answer = answerOf(
      await callTool(accessToken, "send_message", {
        draft: `https://${project.slug}.camox.site/pricing?camox-draft=${draftId}`,
        message: "Warm and playful, for small agencies.",
      }),
    );

    expect(answer).toMatchObject({
      draft: draftId,
      turn: "answered",
      message: "You said: Warm and playful, for small agencies.",
    });
    const thread = await editorOnDraft(website, draftId);
    expect(said(thread.view())).toEqual([
      { from: "editor", text: "Make the pricing page friendlier." },
      { from: "agent", text: "Which tone do you want?" },
      { from: "connectedAgent", text: "Warm and playful, for small agencies." },
      { from: "agent", text: "You said: Warm and playful, for small agencies." },
    ]);
  });
  it("continues a draft named by its id, whose thread nobody opened yet", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const { db, memberUser, project } = website;
    const draftId = await startDraft(db, project.id, memberUser.id);
    const { accessToken } = await connectAgent(memberUser.id);
    answerNext("Raised the prices.");

    const answer = answerOf(
      await callTool(accessToken, "send_message", { draft: draftId, message: "Raise prices." }),
    );

    expect(answer).toMatchObject({ draft: draftId, turn: "answered" });
    expect(said((await editorOnDraft(website, draftId)).view())).toEqual([
      { from: "connectedAgent", text: "Raise prices." },
      { from: "agent", text: "Raised the prices." },
    ]);
  });

  it("steers the turn going, answering when it ends, linking the page it changed", async () => {
    const bindings = env as unknown as Bindings;
    bindings.CONNECTED_AGENT_TURN_WAIT_MS = "0";
    onTestFinished(() => {
      delete bindings.CONNECTED_AGENT_TURN_WAIT_MS;
    });
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const { accessToken } = await connectAgent(website.memberUser.id);
    // The turn changes the pricing page, then works on, until the message steers in.
    answerWithScript(`
      const pricing = await tools.getPage({ path: "/pricing" });
      await tools.editBlock({ id: pricing.blocks[0].id, content: { body: "Plans start at $12." } });
    `);
    const release = holdNextScript(`text("checking");`);
    answerFrom(({ editorMessages }) => `Done, and noted: ${editorMessages.at(-1)}`);
    const { draft } = answerOf(
      await callTool(accessToken, "start_draft", { name: "New prices", message: "Raise prices." }),
    );
    const thread = await editorOnDraft(website, draft as string);
    delete bindings.CONNECTED_AGENT_TURN_WAIT_MS;

    const answering = callTool(accessToken, "send_message", {
      draft: draft as string,
      message: "Keep the yearly plan as is.",
    });
    await thread.until(() =>
      thread.frames.some(
        (frame) =>
          frame.type === "events" &&
          frame.events.some(
            (event) =>
              event.type === "inbox_update" && event.items.some(({ mode }) => mode === "steer"),
          ),
      ),
    );
    release();

    expect(answerOf(await answering)).toMatchObject({
      draft,
      turn: "answered",
      message: "Done, and noted: Keep the yearly plan as is.",
      studioLink: `https://${website.project.slug}.camox.site/pricing?camox-draft=${draft}`,
    });
    expect(said(thread.view())).toEqual([
      { from: "connectedAgent", text: "Raise prices." },
      { from: "connectedAgent", text: "Keep the yearly plan as is." },
      { from: "agent", text: "Done, and noted: Keep the yearly plan as is." },
    ]);
  });

  it("refuses a draft that was published or deleted, saying which", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const { db, memberUser, project } = website;
    const { accessToken } = await connectAgent(memberUser.id);
    answerWithScript(`
      const pricing = await tools.getPage({ path: "/pricing" });
      await tools.editBlock({ id: pricing.blocks[0].id, content: { body: "Plans start at $12." } });
    `);
    answerNext("Raised the price to $12.");
    const { draft: published } = answerOf(
      await callTool(accessToken, "start_draft", { name: "New prices", message: "Raise prices." }),
    );
    await publishDraft(website, published as string);
    const deleted = await startDraft(db, project.id, memberUser.id);
    await call(router.drafts.delete, { projectId: project.id }, inDraft(website, deleted));

    const refusalOf = async (draft: string) => {
      const result = await callTool(accessToken, "send_message", { draft, message: "And more." });
      expect(result.isError).toBe(true);
      return result.content[0]!.text;
    };
    expect(await refusalOf(published as string)).toContain(
      `The draft "New prices" has ended: ${memberUser.name} published it`,
    );
    expect(await refusalOf(deleted)).toContain(`${memberUser.name} deleted it`);
  });
});

describe("guidance to a Connected Agent", () => {
  it("makes business context the Connected Agent's job, in the server's instructions", async () => {
    const website = await websiteFixture({});
    const { accessToken } = await connectAgent(website.memberUser.id);

    const { message } = await mcpRequest(accessToken, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "Claude", version: "1.0.0" },
    });

    const { instructions } = message!.result as { instructions: string };
    expect(instructions).toContain(
      "It knows the website, but nothing about the business behind it beyond what's already published. **That knowledge is yours to bring.**",
    );
    expect(instructions).toContain(
      "Given too little, it can only produce slop. If something it needs isn't in your reach, ask the member rather than leave Camox to guess.",
    );
    expect(instructions).toContain(
      "Say what to change and why, never how to build it. After each turn, give the member the studio link: they review and publish there.",
    );
  });

  it("asks for the request and all its context in start_draft's message, mentioning no Camox internals", async () => {
    const website = await websiteFixture({});
    const { accessToken } = await connectAgent(website.memberUser.id);

    const startDraft = (await listTools(accessToken)).find((tool) => tool.name === "start_draft");

    const properties = startDraft!.inputSchema.properties as Record<
      string,
      { description?: string }
    >;
    expect(properties.message?.description).toBe(
      "The request, and all the context it depends on that Camox can't know: product facts and claims, audience, sources, image URLs. You're the only source of business knowledge Camox has, so be thorough. Leave out what doesn't apply.",
    );
    expect(JSON.stringify(startDraft)).not.toMatch(/\bblocks?\b/i);
  });
});
