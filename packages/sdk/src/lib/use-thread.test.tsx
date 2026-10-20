import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import {
  THREAD_ENDED_CLOSE_CODE,
  type ThreadClientMessage,
  type ThreadServerMessage,
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
async function studio(t: TestContext, draftId: string | null = null) {
  const NativeWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = ThreadSocket as never;
  ThreadSocket.opened = [];
  let thread!: ReturnType<typeof useThread>;
  function Studio() {
    thread = useThread("http://api.localhost:8787", 1, draftId);
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

void test("in dev mode, the studio moves on to the development draft's new thread", async (t) => {
  const { socket } = await studio(t, "development");
  const ended = socket();

  await act(async () => ended.end());

  await waitFor(() => socket() !== ended && socket().readyState === 1, "the studio reconnects");
  assert.equal(new URL(socket().url).pathname, "/threads/draft/1/development");
});
