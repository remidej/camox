import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import type { ThreadClientMessage, ThreadServerMessage } from "@camox/api-contract/threads";
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
  await waitFor(() => socket() !== first && socket().received.length > 0, "the studio resends");

  assert.deepEqual(socket().received, [stillOnItsWay]);
});

const STARTED_DRAFT = "019a0000-0000-7000-8000-000000000001";

void test("the studio that messaged its Live thread enters the draft the thread started", async (t) => {
  const entered: string[] = [];
  const { thread, socket } = await studio(t, null, {
    onEnterDraft: (draftId) => entered.push(draftId),
  });
  await act(async () => thread().send("Raise the price to $12"));
  const [sent] = socket().received;
  assert.ok(sent?.type === "send");
  await act(async () => socket().reply({ type: "accepted", operationId: sent.operationId }));

  await act(async () => socket().reply({ type: "started-draft", draftId: STARTED_DRAFT }));

  assert.deepEqual(entered, [STARTED_DRAFT]);
  assert.equal(ThreadSocket.opened.length, 1, "the studio keeps following the thread");
});

void test("another studio on Live moves to the editor's fresh Live thread, continued in the draft", async (t) => {
  const entered: string[] = [];
  const { thread, socket } = await studio(t, null, {
    onEnterDraft: (draftId) => entered.push(draftId),
  });
  const first = socket();

  await act(async () => first.reply({ type: "started-draft", draftId: STARTED_DRAFT }));
  await waitFor(() => socket() !== first && socket().readyState === 1, "the studio reconnects");
  await act(async () => socket().reply({ type: "continued", draftId: STARTED_DRAFT }));

  assert.equal(new URL(socket().url).pathname, "/threads/live/1");
  assert.equal(first.readyState, 3, "the studio left the thread that moved into the draft");
  assert.deepEqual(entered, []);
  assert.equal(thread().view.continuedIn, STARTED_DRAFT);
  assert.equal(thread().view.startedDraft, undefined);
});
