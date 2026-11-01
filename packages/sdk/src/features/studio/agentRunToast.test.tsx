import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import type { ThreadMessage, ThreadSender, ThreadView } from "@camox/api-contract/threads";
import { Window } from "happy-dom";
import * as React from "react";

const window = new Window({ url: "http://localhost:3000/" });
Object.assign(globalThis, {
  React,
  window,
  document: window.document,
  HTMLElement: window.HTMLElement,
  Element: window.Element,
  Node: window.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const { createRoot } = await import("react-dom/client");
const { toast } = await import("@camox/ui/toaster");
const { useAgentRunToast } = await import("./agentRunToast");

const sender: ThreadSender = { id: "member-1", name: "Ada", image: null };
const asked: ThreadMessage = { id: "m1", from: "editor", sender, text: "Add a pricing page" };

function Subject({ view, draftId }: { view: ThreadView; draftId: string | null }) {
  useAgentRunToast(view, draftId);
  return null;
}

/** Records what the toasts said, in order, as `kind: message`. */
function recordToasts(t: TestContext) {
  const said: string[] = [];
  for (const kind of ["loading", "success", "error"] as const) {
    t.mock.method(toast, kind, (message: string) => {
      said.push(`${kind}: ${message}`);
      return "toast";
    });
  }
  t.mock.method(toast, "dismiss", () => {
    said.push("dismiss");
    return "toast";
  });
  return said;
}

async function mount(t: TestContext) {
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  t.after(() => React.act(() => root.unmount()));
  return {
    show: (view: ThreadView, draftId: string | null = "draft-1") =>
      React.act(async () => root.render(<Subject view={view} draftId={draftId} />)),
    unmount: () => React.act(async () => root.unmount()),
  };
}

const working: ThreadView = { messages: [asked], running: true };

void test("says the agent is working during a draft's run, then that it's done", async (t) => {
  const said = recordToasts(t);
  const { show } = await mount(t);

  await show({ messages: [], running: false });
  await show(working);
  await show({ messages: [asked, { id: "a1", from: "agent", text: "Done." }], running: false });

  assert.deepEqual(said, ["loading: Agent is working…", "success: Agent is done"]);
});

void test("says the agent couldn't finish when its turn failed", async (t) => {
  const said = recordToasts(t);
  const { show } = await mount(t);

  await show(working);
  await show({ messages: [asked, { id: "m1:failed", from: "failed" }], running: false });

  assert.deepEqual(said, ["loading: Agent is working…", "error: Agent couldn't finish"]);
});

void test("takes the toast away when the run is stopped", async (t) => {
  const said = recordToasts(t);
  const { show } = await mount(t);

  await show(working);
  await show({ messages: [asked, { id: "s1", from: "stopped", sender }], running: false });

  assert.deepEqual(said, ["loading: Agent is working…", "dismiss"]);
});

void test("takes the toast away when the studio leaves the thread mid-run", async (t) => {
  const said = recordToasts(t);
  const { show, unmount } = await mount(t);

  await show(working);
  await unmount();

  assert.deepEqual(said, ["loading: Agent is working…", "dismiss"]);
});

void test("never shows a toast for a run on Live", async (t) => {
  const said = recordToasts(t);
  const { show } = await mount(t);

  await show(working, null);
  await show(
    { messages: [asked, { id: "a1", from: "agent", text: "Done." }], running: false },
    null,
  );

  assert.deepEqual(said, []);
});
