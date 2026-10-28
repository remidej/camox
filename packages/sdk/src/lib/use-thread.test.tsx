import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import {
  EDITOR_MESSAGE_ENTRY,
  THREAD_ENDED_CLOSE_CODE,
  type ThreadClientMessage,
  START_DRAFT_TOOL,
  type ThreadServerMessage,
  type TouchedBatch,
} from "@camox/api-contract/threads";
import { Window } from "happy-dom";
import { act } from "react";

const window = new Window({ url: "http://studio.localhost:3000" });
Object.assign(globalThis, {
  window,
  document: window.document,
  localStorage: window.localStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const { createRoot } = await import("react-dom/client");
const { useThread } = await import("./use-thread");

/** A thread's end of the socket, standing in for the API. */
class ThreadSocket extends EventTarget {
  static opened: ThreadSocket[] = [];
  readyState = 0;
  readonly url: string;
  readonly received: ThreadClientMessage[] = [];

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    ThreadSocket.opened.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.dispatchEvent(new Event("open"));
    });
  }

  send(data: string) {
    this.received.push(JSON.parse(data));
  }

  reply(message: ThreadServerMessage) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) }));
  }

  close(code = 1006) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    // Node 22 (CI) has no global CloseEvent.
    this.dispatchEvent(Object.assign(new Event("close"), { code, reason: "" }));
  }

  /** The thread ending with its draft, closing the socket for good. */
  end() {
    this.close(THREAD_ENDED_CLOSE_CODE);
  }
}

async function waitFor(check: () => boolean, message: string) {
  for (let i = 0; i < 1000 && !check(); i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  assert.ok(check(), message);
}

/** A studio in project 1, on Live or in `draftId`. */
async function studio(
  t: TestContext,
  draftId: string | null = null,
  options: Parameters<typeof useThread>[3] = {},
) {
  const NativeWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = ThreadSocket as never;
  ThreadSocket.opened = [];
  let thread!: ReturnType<typeof useThread>;
  function Studio() {
    thread = useThread("http://api.localhost:8787", 1, draftId, options);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  t.after(async () => {
    await act(async () => root.unmount());
    globalThis.WebSocket = NativeWebSocket;
  });
  await act(async () => root.render(<Studio />));
  await waitFor(() => ThreadSocket.opened.at(-1)?.readyState === 1, "the socket opens");
  return { thread: () => thread, socket: () => ThreadSocket.opened.at(-1)! };
}

void test("in a draft, the studio follows the draft's thread", async (t) => {
  const draftId = "019a0000-0000-7000-8000-000000000000";
  const { socket } = await studio(t, draftId);

  assert.equal(new URL(socket().url).pathname, `/threads/draft/1/${draftId}`);
});

void test("a message the thread turns down stops the wait and says so; only the others are resent", async (t) => {
  const { thread, socket } = await studio(t);
  assert.equal(new URL(socket().url).pathname, "/threads/live/1");

  await act(async () => thread().send("Hello"));
  await act(async () => thread().send("Are you there?"));
  const [turnedDown, onItsWay] = socket().received;
  assert.equal(turnedDown?.type, "send");
  assert.equal(onItsWay?.type, "send");
  await act(async () =>
    socket().reply({
      type: "error",
      operationId: turnedDown.operationId,
      message: "The message couldn't be sent",
    }),
  );
  assert.equal(thread().error, "The message couldn't be sent");
  await act(async () => socket().reply({ type: "accepted", operationId: onItsWay.operationId }));
  assert.equal(thread().sending, false);

  await act(async () => thread().send("Still there?"));
  assert.equal(thread().sending, true);
  assert.equal(thread().error, undefined, "sending again clears the failure");
  const stillOnItsWay = socket().received.at(-1);
  const first = socket();
  await act(async () => first.close());
  // PartySocket waits a few seconds before reconnecting.
  await waitFor(() => socket() !== first && socket().readyState === 1, "the studio reconnects");
  assert.deepEqual(socket().received, [], "nothing is resent before the thread shows itself");
  await act(async () => socket().reply(snapshotOf([])));

  assert.deepEqual(socket().received, [stillOnItsWay]);
});

void test("a message carries where the editor was as they sent it, resent too", async (t) => {
  const { thread, socket } = await studio(t);
  const where = {
    on: "page" as const,
    locale: "en",
    path: "/pricing",
    title: "Pricing",
    pageId: "019a0000-0000-7000-8000-000000000002",
  };

  await act(async () => thread().send("Shorten this page's intro", where));
  const sent = socket().received.at(-1);
  assert.ok(sent?.type === "send");
  assert.deepEqual(sent.where, where);
  const first = socket();
  await act(async () => first.close());
  await waitFor(() => socket() !== first && socket().readyState === 1, "the studio reconnects");
  await act(async () => socket().reply(snapshotOf([])));

  assert.deepEqual(socket().received, [sent]);
});

const STARTED_DRAFT = "019a0000-0000-7000-8000-000000000001";

const ada = { id: "user-1", name: "Ada Lovelace", image: null };

/** The thread's snapshot of a transcript of editors' messages, with their operation ids. */
function snapshotOf(messages: { text: string; operationId: string }[]): ThreadServerMessage {
  return {
    type: "events",
    events: [
      {
        type: "snapshot",
        entries: messages.map(({ text, operationId }, index) => ({
          id: index + 1,
          conversationId: "root",
          kind: EDITOR_MESSAGE_ENTRY,
          data: { ...ada, operationId },
          model: [{ role: "user", content: text, timestamp: 0 }],
        })),
        tools: [],
        nestedTools: [],
        compactions: [],
        inbox: [],
        // The agent works on the last message, if any.
        ...(messages.length > 0 ? { run: {} } : {}),
      } as never,
    ],
  };
}

/** A studio, on Live unless `draftId` names a draft, recording the drafts it's told to enter. */
async function enteringStudio(t: TestContext, draftId: string | null = null) {
  const entered: string[] = [];
  const opened = await studio(t, draftId, { onEnterDraft: (started) => entered.push(started) });
  return { ...opened, entered };
}

type EnteringStudio = Awaited<ReturnType<typeof enteringStudio>>;

/** Sends `text` from the studio, returning its operation id once the thread accepted it. */
async function sendFrom(studio: EnteringStudio, text: string) {
  await act(async () => studio.thread().send(text));
  const sent = studio.socket().received.at(-1);
  assert.ok(sent?.type === "send");
  await act(async () => studio.socket().reply({ type: "accepted", operationId: sent.operationId }));
  return sent.operationId;
}

/** The thread's events: the editor's message, then the agent on Live's `startDraft` call. */
function handedOff(operationId: string): ThreadServerMessage {
  const card = { draftId: STARTED_DRAFT, name: "New prices" };
  return {
    type: "events",
    events: [
      {
        type: "snapshot",
        entries: [
          {
            id: 1,
            conversationId: "root",
            kind: EDITOR_MESSAGE_ENTRY,
            data: { ...ada, operationId },
            model: [{ role: "user", content: "Raise the price", timestamp: 0 }],
          },
          {
            id: 2,
            conversationId: "root",
            kind: "pi.tool-result",
            model: [
              {
                role: "toolResult",
                toolCallId: "call-1",
                toolName: START_DRAFT_TOOL,
                content: [{ type: "text", text: JSON.stringify(card) }],
                details: card,
                isError: false,
                timestamp: 0,
              },
            ],
          },
        ],
        tools: [],
        nestedTools: [],
        compactions: [],
        inbox: [],
      } as never,
    ],
  };
}

void test("the studio whose message the agent on Live handed off enters the draft, the Live thread staying as it is", async (t) => {
  const live = await enteringStudio(t);
  const operationId = await sendFrom(live, "Raise the price");

  await act(async () => {
    live.socket().reply({
      type: "started-draft",
      startedDraft: { draftId: STARTED_DRAFT, operationIds: [operationId] },
    });
    live.socket().reply(handedOff(operationId));
  });

  assert.deepEqual(live.entered, [STARTED_DRAFT]);
  assert.equal(ThreadSocket.opened.length, 1, "the studio keeps the Live thread");
  assert.equal(new URL(live.socket().url).pathname, "/threads/live/1");
  assert.deepEqual(
    live.thread().view.messages.map(({ from }) => from),
    ["editor", "draft"],
  );
});

void test("another studio on Live stays there, showing the draft's card", async (t) => {
  const live = await enteringStudio(t);
  // This studio asked something earlier; another tab's message was handed off.
  await sendFrom(live, "What do plans cost?");
  const first = live.socket();

  await act(async () => {
    first.reply({
      type: "started-draft",
      startedDraft: { draftId: STARTED_DRAFT, operationIds: ["another-tab"] },
    });
    first.reply(handedOff("another-tab"));
  });

  assert.deepEqual(live.entered, []);
  assert.equal(live.socket(), first, "the studio keeps the Live thread");
  assert.equal(first.readyState, 1);
  assert.deepEqual(live.thread().view.messages.at(-1), {
    id: "2",
    from: "draft",
    draftId: STARTED_DRAFT,
    name: "New prices",
  });
});

void test("the studio shows a card's draft as the thread looks it up: renamed, then ended", async (t) => {
  const live = await enteringStudio(t);
  await act(async () => live.socket().reply(handedOff("another-tab")));

  await act(async () =>
    live
      .socket()
      .reply({ type: "drafts", drafts: { [STARTED_DRAFT]: { name: "Prices for 2027" } } }),
  );
  assert.deepEqual(live.thread().view.messages.at(-1), {
    id: "2",
    from: "draft",
    draftId: STARTED_DRAFT,
    name: "Prices for 2027",
  });

  await act(async () =>
    live.socket().reply({
      type: "drafts",
      drafts: { [STARTED_DRAFT]: { name: "Prices for 2027", ended: "deleted" } },
    }),
  );
  assert.deepEqual(live.thread().view.messages.at(-1), {
    id: "2",
    from: "draft",
    draftId: STARTED_DRAFT,
    name: "Prices for 2027",
    ended: "deleted",
  });
});

void test("a studio no longer on Live isn't told to enter the draft", async (t) => {
  const inDraft = await enteringStudio(t, "019a0000-0000-7000-8000-000000000002");
  const operationId = await sendFrom(inDraft, "Raise the price");

  await act(async () =>
    inDraft.socket().reply({
      type: "started-draft",
      startedDraft: { draftId: STARTED_DRAFT, operationIds: [operationId] },
    }),
  );

  assert.deepEqual(inDraft.entered, []);
});

void test("the studio doesn't reconnect to a draft's thread that ended with the draft", async (t) => {
  const { socket } = await studio(t, "019a0000-0000-7000-8000-000000000000");
  // How long PartySocket takes to reconnect once the socket closed otherwise.
  const dropped = socket();
  const droppedAt = Date.now();
  await act(async () => dropped.close());
  await waitFor(() => socket() !== dropped && socket().readyState === 1, "the studio reconnects");
  const reconnecting = Date.now() - droppedAt;

  const ended = socket();
  await act(async () => ended.end());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 2 * reconnecting));
  });

  assert.ok(socket() === ended, "the studio left the ended thread closed");
});

/** What a script adding a hero block to a page touched. */
const ADDED_HERO: Pick<TouchedBatch, "touches"> = {
  touches: [{ entity: "page", pageId: "page-1", blockId: "block-1", kind: "created" }],
};

void test("the studio reports what a run with one of its messages touched", async (t) => {
  const { thread, socket } = await studio(t, STARTED_DRAFT);
  await act(async () => thread().send("Add a hero"));
  const sent = socket().received.at(-1);
  assert.ok(sent?.type === "send");
  assert.equal(thread().touched, undefined, "nothing is touched yet");

  const touched = { operationIds: ["teammate", sent.operationId], ...ADDED_HERO };
  await act(async () => socket().reply({ type: "touched", touched }));

  assert.deepEqual(thread().touched?.batch, touched);
});

void test("the studio leaves out what teammates' runs touched", async (t) => {
  const { thread, socket } = await studio(t, STARTED_DRAFT);
  await act(async () => thread().send("Add a hero"));
  const sent = socket().received.at(-1);
  assert.ok(sent?.type === "send");
  const ours = { operationIds: [sent.operationId], ...ADDED_HERO };
  await act(async () => socket().reply({ type: "touched", touched: ours }));

  await act(async () =>
    socket().reply({ type: "touched", touched: { operationIds: ["teammate"], ...ADDED_HERO } }),
  );

  assert.deepEqual(thread().touched?.batch, ours, "the studio still shows its own run's");
  assert.equal(thread().touched?.sequence, 1, "the teammate's run reported nothing new");
});

void test("the studio that entered the draft its request was handed off to follows the draft's agent", async (t) => {
  const live = await enteringStudio(t);
  const operationId = await sendFrom(live, "Add a hero");
  await act(async () =>
    live.socket().reply({
      type: "started-draft",
      startedDraft: { draftId: STARTED_DRAFT, operationIds: [operationId] },
    }),
  );
  assert.deepEqual(live.entered, [STARTED_DRAFT]);

  // The studio enters the draft, following its thread instead, where the agent runs on the
  // editor's message.
  const inDraft = await studio(t, STARTED_DRAFT);
  const touched = { operationIds: [operationId], ...ADDED_HERO };
  await act(async () => inDraft.socket().reply({ type: "touched", touched }));

  assert.deepEqual(inDraft.thread().touched?.batch, touched);
});

void test("a studio entering a draft on its own leaves out what the handed-off run touched", async (t) => {
  const live = await enteringStudio(t);
  await act(async () =>
    live.socket().reply({
      type: "started-draft",
      startedDraft: { draftId: STARTED_DRAFT, operationIds: ["another-tab"] },
    }),
  );

  const inDraft = await studio(t, STARTED_DRAFT);
  const touched = { operationIds: ["another-tab"], ...ADDED_HERO };
  await act(async () => inDraft.socket().reply({ type: "touched", touched }));

  assert.equal(inDraft.thread().touched, undefined);
});
