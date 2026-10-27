import { DRAFT_HEADER } from "@camox/api-contract/drafts";
import type { ThreadView } from "@camox/api-contract/threads";
import { call } from "@orpc/server";
import { abortAllDurableObjects } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { addMember, createRpcContext, startDraft } from "../../../test/fixtures";
import { answerNext as answerOverview } from "../../../test/generation";
import {
  answerFrom,
  answerNext,
  answerWithMessages,
  answerWithScript,
  answerWithToolCall,
  answerWithToolCallFrom,
  forgetThreadModel,
  holdNextScript,
  type ModelRequest,
  threadModelCalls,
} from "../../../test/thread-model";
import {
  ask,
  connectDraftThread,
  connectLiveThread,
  draftsOf,
  lastAnswer,
  pagesOf,
  said,
  signIn,
  threadIdOf,
  type Website,
  websiteFixture,
} from "../../../test/threads";
import type { DraftOverview } from "../../lib/ai-model";
import { runService } from "../../lib/run-service";
import { runOverviewJob } from "../drafts/overview-job";
import { draftProcedures } from "../drafts/routes";
import { liveThreads } from "./schema";

// The agent on Live changes nothing itself: it hands each request that would change the website
// off to a draft it starts with `startDraft`, whose thread takes the request on from a Brief
// (ADR 0025).

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

/** Waits until `check` holds, as the threads work on their own. */
async function until(check: () => Promise<boolean>) {
  const deadline = Date.now() + 10_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("It never happened");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const LIVE_PRICING = { "/pricing": ["<!-- Text -->\nPlans start at $9."] };

const BRIEF = "The editor wants plans to cost $12. The pricing page is at /pricing.";

/** A script raising the pricing page's price to $12. */
const RAISE_PRICE = `
  const pricing = await tools.getPage({ path: "/pricing" });
  await tools.editBlock({ id: pricing.blocks[0].id, content: { body: "Plans start at $12." } });
`;

/** A script creating a page at `/launch`, printing who created it. */
const CREATE_LAUNCH_PAGE = `
  const { page } = await tools.createPage({ pathSegment: "launch", layoutId: "default" });
  const { page: created } = await tools.getPage({ id: page.id });
  text(created.createdBy);
`;

/** Scripts the agent on Live handing the request off to a draft named `name`. */
const handOff = (name: string, brief = BRIEF) => answerWithToolCall("startDraft", { name, brief });

/** The Live thread's id, which the socket's route resolves for its editor. */
const liveThreadIdOf = async ({ db, memberUser, project }: Website) => {
  const row = await db
    .select({ threadId: liveThreads.threadId })
    .from(liveThreads)
    .where(and(eq(liveThreads.projectId, project.id), eq(liveThreads.userId, memberUser.id)))
    .get();
  return row?.threadId;
};

describe("a Live thread handing a request off to a draft", () => {
  it("answers a read-only question without starting a draft", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const token = await signIn(website.db, website.memberUser.id);
    answerWithScript(`
      const pricing = await tools.getPage({ path: "/pricing" });
      text(pricing.blocks.length + " block");
    `);
    answerFrom(({ scriptOutput }) => `The pricing page has ${scriptOutput}.`);

    const view = await ask(
      await connectLiveThread(website.project.id, token),
      "What's on pricing?",
    );

    expect(lastAnswer(view)).toBe("The pricing page has 1 block.");
    expect(await draftsOf(website)).toEqual([]);
  });

  it("starts a draft named by the agent, created by the asking editor, and ends the turn on its card", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const token = await signIn(website.db, website.memberUser.id);
    const live = await connectLiveThread(website.project.id, token);
    handOff("Raise prices to $12");
    answerNext("Raised the price to $12.");
    const operationId = crypto.randomUUID();

    const view = await ask(live, "Raise the price to $12", { operationId, keepOpen: true });

    const [draft, ...others] = await draftsOf(website);
    expect(others).toEqual([]);
    expect(draft?.name).toBe("Raise prices to $12");
    expect(draft?.createdBy.id).toBe(website.memberUser.id);
    // The turn ends on the card, as an answer: no failed line, no more text.
    expect(view.messages.at(-1)).toEqual({
      id: expect.any(String),
      from: "draft",
      draftId: draft!.id,
      name: "Raise prices to $12",
    });
    expect(said(view)).toEqual([
      { from: "editor", text: "Raise the price to $12" },
      { from: "draft", name: "Raise prices to $12" },
    ]);
    // Only the studio that sent the run's message is told to enter the draft.
    expect(live.frames).toContainEqual({
      type: "started-draft",
      startedDraft: { draftId: draft!.id, operationIds: [operationId] },
    });
    live.close();
  });

  it("opens the draft's thread with the Brief, then the editor's messages, its agent acting as them with no studio connected", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const { db, memberUser, project } = website;
    const token = await signIn(db, memberUser.id);
    const live = await connectLiveThread(project.id, token);
    // The agent on Live reads first, then hands the request off.
    const release = holdNextScript(`text((await tools.listPages({})).length + " page");`);
    handOff("Launch page");
    answerWithScript(CREATE_LAUNCH_PAGE);
    answerFrom(
      ({ editorMessages, scriptOutput }) =>
        `Saw: ${editorMessages.join(" | ")}. As ${scriptOutput}.`,
    );
    live.send({ type: "send", operationId: crypto.randomUUID(), text: "Add a launch page" });
    await live.until(() => live.view().running);
    // Sent while the agent on Live was still reading.
    const steering = crypto.randomUUID();
    live.send({ type: "send", operationId: steering, text: "Link it from pricing" });
    await live.until(() =>
      live.frames.some((frame) => frame.type === "accepted" && frame.operationId === steering),
    );
    release();
    await live.until(() => live.view().messages.at(-1)?.from === "draft");
    // No studio follows the draft's thread, nor the Live one, while the draft's agent works.
    live.close();
    const [draft] = await draftsOf(website);

    await until(async () => "/launch" in (await pagesOf(website, draft!.id)));

    const inDraft = await connectDraftThread(project.id, draft!.id, token);
    await inDraft.untilIdle(4);
    expect(said(inDraft.view())).toEqual([
      { from: "camox", text: BRIEF },
      { from: "editor", text: "Add a launch page" },
      { from: "editor", text: "Link it from pricing" },
      {
        from: "agent",
        text: `Saw: ${BRIEF} | Add a launch page | Link it from pricing. As ${memberUser.name}.`,
      },
    ]);
    const senders = inDraft
      .view()
      .messages.flatMap((message) => (message.from === "editor" ? [message.sender.id] : []));
    expect(senders).toEqual([memberUser.id, memberUser.id]);
    inDraft.close();
    expect(await pagesOf(website)).toEqual(LIVE_PRICING);
  });

  it("refuses a script that writes on Live", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const token = await signIn(website.db, website.memberUser.id);
    answerWithScript(RAISE_PRICE);
    answerNext("Refused.");

    const view = await ask(await connectLiveThread(website.project.id, token), "Raise the price");

    expect(lastAnswer(view)).toBe("Refused.");
    expect(await draftsOf(website)).toEqual([]);
    expect(await pagesOf(website)).toEqual(LIVE_PRICING);
  });

  it("keeps the Live thread and its messages, and starts another draft later", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const token = await signIn(website.db, website.memberUser.id);
    const threadId = await (async () => {
      answerNext("Plans start at $9.");
      await ask(await connectLiveThread(website.project.id, token), "What do plans cost?");
      return liveThreadIdOf(website);
    })();
    handOff("New prices");
    answerNext("Raised the price.");
    await ask(await connectLiveThread(website.project.id, token), "Raise the price to $12");
    const [first] = await draftsOf(website);
    await until(async () => {
      const inDraft = await connectDraftThread(website.project.id, first!.id, token);
      const done = !inDraft.view().running && inDraft.view().messages.length === 3;
      inDraft.close();
      return done;
    });
    handOff("Launch page");
    answerNext("Added a launch page.");

    const view = await ask(await connectLiveThread(website.project.id, token), "Add a launch page");

    expect(await liveThreadIdOf(website)).toBe(threadId);
    expect(said(view)).toEqual([
      { from: "editor", text: "What do plans cost?" },
      { from: "agent", text: "Plans start at $9." },
      { from: "editor", text: "Raise the price to $12" },
      { from: "draft", name: "New prices" },
      { from: "editor", text: "Add a launch page" },
      { from: "draft", name: "Launch page" },
    ]);
    const names = (await draftsOf(website)).map(({ name }) => name);
    expect(names).toHaveLength(2);
    expect(names).toEqual(expect.arrayContaining(["Launch page", "New prices"]));
  });

  it("keeps the Live thread's request and card once the draft ended, which deletes the draft's thread", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const token = await signIn(website.db, website.memberUser.id);
    handOff("New prices");
    answerNext("Raised the price.");
    await ask(await connectLiveThread(website.project.id, token), "Raise the price to $12");
    const [draft] = await draftsOf(website);
    const draftThreadId = await threadIdOf(website.db, draft!.id);
    const inDraft = await connectDraftThread(website.project.id, draft!.id, token);
    await inDraft.untilIdle(3);

    await deleteDraft(website, draft!.id);

    await inDraft.until(() => inDraft.closedWith() !== undefined);
    expect(draftThreadId).not.toBeNull();
    const live = await connectLiveThread(website.project.id, token);
    expect(said(live.view())).toEqual([
      { from: "editor", text: "Raise the price to $12" },
      { from: "draft", name: "New prices" },
    ]);
    live.close();
  });
});

/** The note Camox adds to the Live thread once a draft it started ended. */
const PUBLISHED_NOTE =
  'Note from Camox: the draft "New prices" you started was published by Teammate, so its ' +
  "changes are on Live now. Its Draft Overview:\n\nPlans cost $12\n- The pricing page's price " +
  "rose from $9 to $12";
const DELETED_NOTE =
  'Note from Camox: the draft "New prices" you started was deleted by Teammate, so none of its ' +
  "changes reached Live.";

/**
 * A draft named "New prices" the agent on Live started as the fixture member asked, whose agent
 * raised the price, and what the agent on Live saw as it started it.
 */
async function handedOffDraft(website: Website, token: string) {
  let handingOff: ModelRequest | undefined;
  answerWithToolCallFrom("startDraft", (request) => {
    handingOff = request;
    return { name: "New prices", brief: BRIEF };
  });
  answerWithScript(RAISE_PRICE);
  answerNext("Raised the price.");
  await ask(await connectLiveThread(website.project.id, token), "Raise the price to $12");
  const [draft] = await draftsOf(website);
  const inDraft = await connectDraftThread(website.project.id, draft!.id, token);
  await inDraft.untilIdle(3);
  inDraft.close();
  return { draftId: draft!.id, handingOff: handingOff! };
}

/** Scripts the model's next answer, keeping what it saw as it was called. */
function seenByNextAnswer(text: string) {
  const seen: { request?: ModelRequest } = {};
  answerFrom((request) => {
    seen.request = request;
    return text;
  });
  return seen;
}

describe("the agent on Live hearing that a draft it started ended", () => {
  it("reads who published it and its Draft Overview after everything before, which shows no note", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const token = await signIn(website.db, website.memberUser.id);
    const teammate = await addMember(website.db, website.project.organizationId);
    const { draftId, handingOff } = await handedOffDraft(website, token);
    await writeOverview(website, draftId, {
      headline: "Plans cost $12",
      bullets: ["The pricing page's price rose from $9 to $12"],
    });

    await publish(website, draftId, teammate);

    const seen = seenByNextAnswer("It's live.");
    const view = await ask(await connectLiveThread(website.project.id, token), "Is it live?");
    expect(seen.request?.editorMessages).toEqual([
      "Raise the price to $12",
      PUBLISHED_NOTE,
      "Is it live?",
    ]);
    expect(seen.request?.instructions).toBe(handingOff.instructions);
    expect(said(view)).toEqual([
      { from: "editor", text: "Raise the price to $12" },
      { from: "draft", name: "New prices" },
      { from: "editor", text: "Is it live?" },
      { from: "agent", text: "It's live." },
    ]);
  });

  it("reads who deleted it at the next break of the run going", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const token = await signIn(website.db, website.memberUser.id);
    const teammate = await addMember(website.db, website.project.organizationId);
    const { draftId } = await handedOffDraft(website, token);
    const live = await connectLiveThread(website.project.id, token);
    const calls = threadModelCalls();
    const release = holdNextScript(`text((await tools.listPages({})).length + " page");`);
    const seen = seenByNextAnswer("It was deleted, so prices stay at $9.");
    live.send({ type: "send", operationId: crypto.randomUUID(), text: "Do prices change?" });
    await until(async () => threadModelCalls() > calls);

    await deleteDraft(website, draftId, teammate);
    release();

    await live.until(() => !live.view().running && lastAnswer(live.view()) !== undefined);
    expect(seen.request?.editorMessages).toEqual([
      "Raise the price to $12",
      "Do prices change?",
      DELETED_NOTE,
    ]);
    expect(said(live.view()).at(-1)).toEqual({
      from: "agent",
      text: "It was deleted, so prices stay at $9.",
    });
    live.close();
  });

  it("hears nothing of a draft no Live thread started", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const { db, memberUser, project } = website;
    const token = await signIn(db, memberUser.id);
    answerNext("Plans start at $9.");
    await ask(await connectLiveThread(project.id, token), "What do plans cost?");
    const draftId = await startDraft(db, project.id, memberUser.id);

    await deleteDraft(website, draftId, memberUser);

    const seen = seenByNextAnswer("Still $9.");
    await ask(await connectLiveThread(project.id, token), "And now?");
    expect(seen.request?.editorMessages).toEqual(["What do plans cost?", "And now?"]);
  });

  it.each([
    ["published", publish],
    ["deleted", deleteDraft],
  ] as const)(
    "leaves the draft %s when the note can't reach the Live thread",
    async (outcome, end) => {
      const website = await websiteFixture({ pricing: "Plans start at $9." });
      const token = await signIn(website.db, website.memberUser.id);
      const { draftId } = await handedOffDraft(website, token);
      const liveThreadId = await liveThreadIdOf(website);
      const getByName = env.THREAD.getByName.bind(env.THREAD);
      vi.spyOn(env.THREAD, "getByName").mockImplementation((name) => {
        if (name === liveThreadId) throw new Error("The Live thread is unreachable");
        return getByName(name);
      });

      const result = await end(website, draftId, website.memberUser);

      expect(result.ended).toMatchObject({ draftId, outcome });
      expect(await draftsOf(website)).toEqual([]);
    },
  );
});

type Member = Website["memberUser"];

const inDraft = ({ db }: Website, draftId: string, member: Member) => ({
  context: createRpcContext(db, member, { [DRAFT_HEADER]: draftId }),
});

/** Deletes a draft as `member` (the fixture member by default) does from the studio. */
function deleteDraft(website: Website, draftId: string, member: Member = website.memberUser) {
  return call(
    draftProcedures.delete,
    { projectId: website.project.id },
    inDraft(website, draftId, member),
  );
}

/** Publishes a draft as `member` does from the studio, after reviewing it. */
async function publish(website: Website, draftId: string, member: Member) {
  const projectId = website.project.id;
  const options = inDraft(website, draftId, member);
  const { token } = await call(draftProcedures.previewPublish, { projectId }, options);
  return call(draftProcedures.publish, { projectId, token }, options);
}

/** Has the model write `overview` as the draft's Draft Overview. */
async function writeOverview(website: Website, draftId: string, overview: DraftOverview) {
  answerOverview("draftOverview", overview);
  await runService(runOverviewJob(website.db, { kind: "overview", draftId }));
}
describe("a Live thread's card for a draft it started", () => {
  it("shows the draft's new name once it's renamed, on the Live thread already open and on the next", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const token = await signIn(website.db, website.memberUser.id);
    const live = await connectLiveThread(website.project.id, token);
    handOff("New prices");
    answerNext("Raised the price.");
    await ask(live, "Raise the price to $12", { keepOpen: true });
    const [draft] = await draftsOf(website);

    await renameDraft(website, draft!.id, "Prices for 2027");

    await live.until(() => cardOf(live.view())?.name === "Prices for 2027");
    expect(live.view().messages.at(-1)).toEqual({
      id: expect.any(String),
      from: "draft",
      draftId: draft!.id,
      name: "Prices for 2027",
    });
    live.close();
    const next = await connectLiveThread(website.project.id, token);
    await next.until(() => cardOf(next.view())?.name === "Prices for 2027");
    next.close();
  });

  it("says the draft was published, with its last name, and opens nothing", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const token = await signIn(website.db, website.memberUser.id);
    const live = await connectLiveThread(website.project.id, token);
    handOff("New prices");
    answerWithScript(RAISE_PRICE);
    answerNext("Raised the price to $12.");
    await ask(live, "Raise the price to $12", { keepOpen: true });
    const [draft] = await draftsOf(website);
    await until(async () => (await pagesOf(website, draft!.id))["/pricing"]![0]!.includes("$12"));
    await renameDraft(website, draft!.id, "Prices for 2027");

    await publish(website, draft!.id, website.memberUser);

    await live.until(() => cardOf(live.view())?.ended !== undefined);
    expect(cardOf(live.view())).toEqual({
      id: expect.any(String),
      from: "draft",
      draftId: draft!.id,
      name: "Prices for 2027",
      ended: "published",
    });
    live.close();
    const next = await connectLiveThread(website.project.id, token);
    await next.until(() => cardOf(next.view())?.ended === "published");
    expect(cardOf(next.view())?.name).toBe("Prices for 2027");
    next.close();
  });

  it("says the draft was deleted, with its last name, and opens nothing", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const token = await signIn(website.db, website.memberUser.id);
    const live = await connectLiveThread(website.project.id, token);
    handOff("New prices");
    answerNext("Raised the price.");
    await ask(live, "Raise the price to $12", { keepOpen: true });
    const [draft] = await draftsOf(website);
    await renameDraft(website, draft!.id, "Prices for 2027");

    await deleteDraft(website, draft!.id);

    await live.until(() => cardOf(live.view())?.ended !== undefined);
    expect(cardOf(live.view())).toEqual({
      id: expect.any(String),
      from: "draft",
      draftId: draft!.id,
      name: "Prices for 2027",
      ended: "deleted",
    });
    live.close();
    const next = await connectLiveThread(website.project.id, token);
    await next.until(() => cardOf(next.view())?.ended === "deleted");
    expect(cardOf(next.view())?.name).toBe("Prices for 2027");
    next.close();
  });

  it("changes nothing the Live model already read once its draft is renamed and ends", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const token = await signIn(website.db, website.memberUser.id);
    handOff("New prices");
    answerNext("Raised the price.");
    await ask(await connectLiveThread(website.project.id, token), "Raise the price to $12");
    const [draft] = await draftsOf(website);
    await until(async () => {
      const inDraft = await connectDraftThread(website.project.id, draft!.id, token);
      const done = !inDraft.view().running && inDraft.view().messages.length === 3;
      inDraft.close();
      return done;
    });
    const read: (readonly unknown[])[] = [];
    answerWithMessages((messages) => {
      read.push(messages);
      return "Plans start at $9.";
    });
    await ask(await connectLiveThread(website.project.id, token), "What do plans cost?");
    await renameDraft(website, draft!.id, "Prices for 2027");
    await deleteDraft(website, draft!.id);
    answerWithMessages((messages) => {
      read.push(messages);
      return "Still $9.";
    });

    await ask(await connectLiveThread(website.project.id, token), "And now?");

    const [before, after] = read;
    expect(after!.slice(0, before!.length)).toEqual(before);
  });
});

/** The last message of a Live thread's view, when it's a draft's card. */
const cardOf = (view: ThreadView) => {
  const message = view.messages.at(-1);
  return message?.from === "draft" ? message : undefined;
};

/** Renames a draft as the fixture member does from the studio. */
function renameDraft(website: Website, draftId: string, name: string) {
  return call(
    draftProcedures.rename,
    { projectId: website.project.id, name },
    inDraft(website, draftId, website.memberUser),
  );
}
