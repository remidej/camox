import assert from "node:assert/strict";
import { test } from "node:test";

import { DRAFT_SEARCH_PARAM } from "@camox/api-contract/drafts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import * as React from "react";

// Initialize the DOM before importing UI components, which detect portals at module load.
const window = new Window({ url: "http://localhost:3000/" });
Object.assign(globalThis, {
  React,
  window,
  document: window.document,
  HTMLElement: window.HTMLElement,
  Element: window.Element,
  Node: window.Node,
  Event: window.Event,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  localStorage: window.localStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
  __CAMOX_TELEMETRY_DISABLED__: true,
});
const { createRoot } = await import("react-dom/client");
const { ReviewDraftDialog } = await import("./ReviewDraftDialog");
const { initApiClient } = await import("@/lib/api-client");
const { getCurrentDraftId } = await import("@/lib/studio-draft");

const draftId = "019a0000-0000-7000-8000-000000000001";
const blockId = "019a0000-0000-7000-8000-000000000002";
const home = {
  kind: "page",
  id: "019a0000-0000-7000-8000-000000000003",
  path: "/",
  nickname: "Home",
};

const emptyPreview = {
  blockers: [],
  conflicts: [],
  lost: [],
  warnings: [],
  changes: [{ entity: "block", id: blockId, label: "Hero", owner: home, change: "changed" }],
  token: "token-1",
};

const conflictedPreview = {
  ...emptyPreview,
  conflicts: [
    {
      entity: "block",
      id: blockId,
      label: "Hero",
      owner: home,
      liveVersion: 3,
      publishedBy: { id: "user-2", name: "Ada" },
      publishedAt: Date.UTC(2026, 9, 13),
    },
  ],
  token: "token-2",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify({ json: body }), {
    status,
    headers: { "content-type": "application/json" },
  });

type Call = { path: string; input: unknown };

function mockApi(t: test.TestContext, respond: (path: string, calls: Call[]) => Response) {
  const calls: Call[] = [];
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const path = new URL(request.url).pathname.replace(/^\/rpc\//, "");
    calls.push({ path, input: ((await request.json()) as { json: unknown }).json });
    return respond(path, calls);
  });
  return calls;
}

async function settle() {
  await React.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}

async function click(element: unknown) {
  assert.ok(element, "expected an element to click");
  await React.act(async () => {
    (element as unknown as { click: () => void }).click();
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}

const buttonNamed = (name: RegExp) =>
  [...window.document.querySelectorAll("button")].find((button) =>
    name.test(button.textContent ?? ""),
  ) as unknown as HTMLButtonElement | undefined;

async function openReview() {
  window.history.replaceState(null, "", `/?${DRAFT_SEARCH_PARAM}=${draftId}`);
  initApiClient("http://api.test");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  await React.act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ReviewDraftDialog projectId={1} draftId={draftId} open onOpenChange={() => {}} />
      </QueryClientProvider>,
    ),
  );
  await settle();
  return async () => {
    await React.act(async () => root.unmount());
    host.remove();
    client.clear();
  };
}

const dialogText = () => window.document.querySelector('[role="dialog"]')?.textContent ?? "";

void test("says nothing on Live changed when there's nothing to warn about, and lists the changes by page", async (t) => {
  mockApi(t, () => json(emptyPreview));
  const close = await openReview();
  try {
    assert.match(dialogText(), /Nothing on Live changed since this draft did/);
    assert.match(dialogText(), /Home/);
    assert.match(dialogText(), /Hero/);
    assert.equal(buttonNamed(/Publish all/)?.disabled, false);
  } finally {
    await close();
  }
});

void test("disables Publish all while the draft has blockers", async (t) => {
  mockApi(t, () =>
    json({
      ...emptyPreview,
      blockers: [
        {
          entity: "block",
          id: blockId,
          label: "Quote",
          owner: home,
          code: "emptyRequiredReference",
          field: "author",
          message: '"Author" is required but empty',
        },
      ],
    }),
  );
  const close = await openReview();
  try {
    assert.match(dialogText(), /"Author" is required but empty/);
    assert.equal(buttonNamed(/Publish all/)?.disabled, true);
  } finally {
    await close();
  }
});

void test("shows the new conflicts when Live changed since the preview, then publishes and switches to Live", async (t) => {
  let liveChanged = false;
  const calls = mockApi(t, (path) => {
    if (path === "drafts/previewPublish")
      return json(liveChanged ? conflictedPreview : emptyPreview);
    if (path === "drafts/publish" && !liveChanged) {
      liveChanged = true;
      return json(
        { defined: false, code: "CONFLICTS_CHANGED", status: 409, message: "Live changed" },
        409,
      );
    }
    return json({
      ended: {
        draftId,
        outcome: "published",
        endedBy: { id: "user-1", name: "Me" },
        endedAt: 1,
      },
    });
  });
  const close = await openReview();
  try {
    await click(buttonNamed(/Publish all/));
    await settle();

    assert.match(dialogText(), /Ada/);
    assert.match(dialogText(), /1 Live change will be overwritten/);
    assert.equal(new URL(window.location.href).searchParams.get(DRAFT_SEARCH_PARAM), draftId);

    await click(buttonNamed(/Publish all/));

    const publishes = calls.filter((call) => call.path === "drafts/publish");
    assert.deepEqual(
      publishes.map((call) => call.input),
      [
        { projectId: 1, token: "token-1" },
        { projectId: 1, token: "token-2" },
      ],
    );
    assert.equal(new URL(window.location.href).searchParams.get(DRAFT_SEARCH_PARAM), null);
    assert.equal(getCurrentDraftId(), null);
  } finally {
    await close();
  }
});

void test("discards only after a second confirmation, then switches to Live", async (t) => {
  const calls = mockApi(t, (path) => {
    if (path === "drafts/previewPublish") return json(emptyPreview);
    return json({
      ended: {
        draftId,
        outcome: "discarded",
        endedBy: { id: "user-1", name: "Me" },
        endedAt: 1,
      },
    });
  });
  const close = await openReview();
  try {
    await click(buttonNamed(/Discard draft/));
    assert.equal(calls.filter((call) => call.path === "drafts/discard").length, 0);
    const confirm = window.document.querySelector('[role="alertdialog"]');
    assert.ok(confirm);

    await click(confirm.querySelector('[data-slot="alert-dialog-action"]'));

    assert.deepEqual(
      calls.filter((call) => call.path === "drafts/discard").map((call) => call.input),
      [{ projectId: 1 }],
    );
    assert.equal(new URL(window.location.href).searchParams.get(DRAFT_SEARCH_PARAM), null);
  } finally {
    await close();
  }
});
