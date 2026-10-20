import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import {
  EDITOR_MESSAGE_ENTRY,
  type ThreadClientMessage,
  type ThreadServerMessage,
  threadViewOf,
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

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    // Node 22 (CI) has no global CloseEvent.
    this.dispatchEvent(Object.assign(new Event("close"), { code: 1006, reason: "" }));
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

void test("in dev mode, the studio follows the development draft's thread", async (t) => {
  const { socket } = await studio(t, "development");

  assert.equal(new URL(socket().url).pathname, "/threads/draft/1/development");
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

type Entered = { draftId: string; messages: string[]; unaccepted: string[] };

/** A studio on Live, recording the drafts it enters with what it carries into them. */
async function liveStudio(t: TestContext) {
  const entered: Entered[] = [];
  const opened = await studio(t, null, {
    onEnterDraft: (draftId, { state, unaccepted }) =>
      entered.push({
        draftId,
        messages: threadViewOf(state).messages.map((message) =>
          "text" in message ? message.text : message.from,
        ),
        unaccepted: [...unaccepted.values()],
      }),
  });
  return { ...opened, entered };
}

type LiveStudio = Awaited<ReturnType<typeof liveStudio>>;

/** Sends `text` from the studio, returning its operation id. */
async function sendFrom(live: LiveStudio, text: string) {
  await act(async () => live.thread().send(text));
  const sent = live.socket().received.at(-1);
  assert.ok(sent?.type === "send");
  return sent.operationId;
}

void test("the studio whose message wrote enters the draft with the thread as it showed it", async (t) => {
  const live = await liveStudio(t);
  const operationId = await sendFrom(live, "Raise the price to $12");
  await act(async () => live.socket().reply({ type: "accepted", operationId }));

  // The thread's last events and the move arrive together.
  await act(async () => {
    live.socket().reply(snapshotOf([{ text: "Raise the price to $12", operationId }]));
    live.socket().reply({
      type: "started-draft",
      startedDraft: { draftId: STARTED_DRAFT, operationIds: [operationId] },
    });
  });

  assert.deepEqual(live.entered, [
    { draftId: STARTED_DRAFT, messages: ["Raise the price to $12"], unaccepted: [] },
  ]);
  assert.equal(ThreadSocket.opened.length, 1, "the studio keeps following the thread");
});

void test("a studio whose messages didn't write moves to the editor's fresh Live thread", async (t) => {
  const live = await liveStudio(t);
  // This studio asked something earlier; another tab's message started the run that wrote.
  const earlier = await sendFrom(live, "What do plans cost?");
  await act(async () => live.socket().reply({ type: "accepted", operationId: earlier }));
  const first = live.socket();
  const startedDraft = { draftId: STARTED_DRAFT, operationIds: ["another-tab"] };

  await act(async () => first.reply({ type: "started-draft", startedDraft }));
  await waitFor(() => live.socket() !== first && live.socket().readyState === 1, "it reconnects");
  await act(async () => {
    live.socket().reply({ type: "continued-in", continuedIn: startedDraft });
    live.socket().reply(snapshotOf([]));
  });

  assert.equal(new URL(live.socket().url).pathname, "/threads/live/1");
  assert.equal(first.readyState, 3, "the studio left the thread that moved into the draft");
  assert.deepEqual(live.entered, []);
  assert.deepEqual(live.thread().view.continuedIn, startedDraft);
  assert.equal(live.thread().view.startedDraft, undefined);
  assert.deepEqual(live.thread().view.messages, []);
});

void test("a studio reconnecting after its message wrote enters the draft, taking what it hasn't sent", async (t) => {
  const live = await liveStudio(t);
  const wrote = await sendFrom(live, "Raise the price to $12");
  await act(async () => {
    live.socket().reply({ type: "accepted", operationId: wrote });
    live.socket().reply(snapshotOf([{ text: "Raise the price to $12", operationId: wrote }]));
  });
  await sendFrom(live, "And add a launch page");
  const first = live.socket();
  await act(async () => first.close());
  await waitFor(() => live.socket() !== first && live.socket().readyState === 1, "it reconnects");

  // Back on Live, the editor's fresh thread says where the last one went.
  await act(async () => {
    live.socket().reply({
      type: "continued-in",
      continuedIn: { draftId: STARTED_DRAFT, operationIds: [wrote] },
    });
    live.socket().reply(snapshotOf([]));
  });

  assert.deepEqual(live.entered, [
    {
      draftId: STARTED_DRAFT,
      messages: ["Raise the price to $12"],
      unaccepted: ["And add a launch page"],
    },
  ]);
  assert.deepEqual(live.socket().received, [], "nothing goes to the fresh Live thread");
});
