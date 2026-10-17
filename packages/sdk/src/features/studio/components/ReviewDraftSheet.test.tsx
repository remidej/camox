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
const { ReviewDraftSheet } = await import("./ReviewDraftSheet");
const { initApiClient } = await import("@/lib/api-client");
const { createDraftScope } = await import("@/lib/draft-scope");
const { StudioScopeProvider } = await import("@/lib/draft-scope.fixtures");
/** The draft scope the open review runs in. */
let draftScope: import("@/lib/draft-scope").DraftScope;

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
      release: false,
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

const draft = {
  id: draftId,
  kind: "regular",
  name: null as string | null,
  createdBy: { id: "user-2", name: "Ada" },
  createdAt: new Date(2026, 9, 13, 12).getTime(),
  lastChangedAt: null,
  changeCount: 1,
};

/** Answers the draft's own summary and renames; everything else goes to `respond`. */
function mockApi(t: test.TestContext, respond: (path: string, calls: Call[]) => Response) {
  const calls: Call[] = [];
  let name: string | null = null;
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const path = new URL(request.url).pathname.replace(/^\/rpc\//, "");
    const input = ((await request.json()) as { json: unknown }).json;
    calls.push({ path, input });
    if (path === "drafts/get") return json({ ...draft, name });
    if (path === "drafts/rename") {
      name = (input as { name: string }).name.trim() || null;
      return json({ ...draft, name });
    }
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  draftScope = createDraftScope({
    queryClient: client,
    browser: window as never,
    developmentMode: false,
  });
  draftScope.adopt({ draftId });
  initApiClient("http://api.test", draftScope);
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  await React.act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <StudioScopeProvider client={client} draftScope={draftScope}>
          <ReviewDraftSheet projectId={1} draftId={draftId} open onOpenChange={() => {}} />
        </StudioScopeProvider>
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

/** Opens the list of the draft's changes, which starts collapsed. */
async function expandChanges() {
  await click(window.document.querySelector('[role="dialog"] button[aria-expanded="false"]'));
}

void test("says nothing on Live changed when there's nothing to warn about, and lists the changes by page once expanded", async (t) => {
  mockApi(t, () => json(emptyPreview));
  const close = await openReview();
  try {
    assert.match(dialogText(), /Ready to publish/);
    assert.match(dialogText(), /Nothing on Live changed since this draft did/);
    assert.doesNotMatch(dialogText(), /Hero/);

    await expandChanges();

    assert.match(dialogText(), /Home/);
    assert.match(dialogText(), /Hero/);
    assert.equal(buttonNamed(/Publish all/)?.disabled, false);
  } finally {
    await close();
  }
});

void test("groups record changes by collection, after the pages", async (t) => {
  const authors = { kind: "collection", name: "authors", title: "Authors" };
  const record = (id: string, label: string) => ({
    entity: "record",
    id,
    label,
    owner: authors,
    change: "changed",
  });
  mockApi(t, () =>
    json({
      ...emptyPreview,
      changes: [
        record("019a0000-0000-7000-8000-000000000010", "Ada"),
        ...emptyPreview.changes,
        record("019a0000-0000-7000-8000-000000000011", "Grace"),
      ],
    }),
  );
  const close = await openReview();
  try {
    await expandChanges();
    const groups = [...window.document.querySelectorAll('[role="dialog"] h4')].map((section) => [
      section.textContent,
      ...[...(section.parentElement?.querySelectorAll("[data-change-label]") ?? [])].map(
        (label) => label.textContent,
      ),
    ]);
    assert.deepEqual(groups, [
      ["Home", "Hero"],
      ["Authors", "Ada", "Grace"],
    ]);
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
    assert.match(dialogText(), /Not ready to publish/);
    assert.match(dialogText(), /"Author" is required but empty/);
    assert.equal(buttonNamed(/Publish all/)?.disabled, true);
  } finally {
    await close();
  }
});

void test("names a definition that differs from Live's as a blocker of its own, without a place to find it", async (t) => {
  mockApi(t, () =>
    json({
      ...emptyPreview,
      blockers: [
        {
          entity: "definition",
          id: "hero",
          label: "Hero",
          owner: null,
          code: "definitionsDiffer",
          field: "",
          message: "its definition differs from Live's",
        },
      ],
    }),
  );
  const close = await openReview();
  try {
    assert.match(dialogText(), /its definition differs from Live's/);
    assert.doesNotMatch(dialogText(), /Elsewhere/);
    assert.equal(buttonNamed(/Publish all/)?.disabled, true);
  } finally {
    await close();
  }
});

void test("folds problems sharing a message into one item naming each", async (t) => {
  const definition = (id: string) => ({
    entity: "definition",
    id,
    label: `Block "${id}"`,
    owner: null,
    code: "definitionsDiffer",
    field: "",
    message: "Only in your local code: release it before publishing",
  });
  mockApi(t, () =>
    json({
      ...emptyPreview,
      blockers: ["hero", "footer", "quote"].map(definition),
    }),
  );
  const close = await openReview();
  try {
    assert.equal(dialogText().match(/Only in your local code/g)?.length, 1);
    assert.match(dialogText(), /Block "hero".*Block "footer".*Block "quote"/);
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
    assert.equal(draftScope.current(), null);
  } finally {
    await close();
  }
});

void test("stays in the draft when publishing finds nothing to publish", async (t) => {
  const calls = mockApi(t, (path) => {
    if (path === "drafts/previewPublish") return json(emptyPreview);
    return json({ empty: true, ended: null });
  });
  const close = await openReview();
  try {
    await click(buttonNamed(/Publish all/));

    assert.equal(calls.filter((call) => call.path === "drafts/publish").length, 1);
    assert.equal(new URL(window.location.href).searchParams.get(DRAFT_SEARCH_PARAM), draftId);
    assert.equal(draftScope.current(), draftId);
  } finally {
    await close();
  }
});

void test("shows a conflict a release made as changed by a release", async (t) => {
  mockApi(t, () =>
    json({
      ...conflictedPreview,
      conflicts: [{ ...conflictedPreview.conflicts[0], publishedBy: null, release: true }],
    }),
  );
  const close = await openReview();
  try {
    assert.match(dialogText(), /Ready, with 1 thing to know/);
    assert.match(dialogText(), /Hero.*Changed by a release/);
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

const dialogTitle = () =>
  window.document.querySelector('[role="dialog"] [data-slot="sheet-title"]')?.textContent ?? "";

async function typeName(value: string, key: "Enter" | "Escape") {
  const input = window.document.querySelector('input[aria-label="Draft name"]');
  assert.ok(input, "expected the name to become editable");
  await React.act(async () => {
    // Through the prototype's setter, so React sees the change.
    Reflect.set(window.HTMLInputElement.prototype, "value", value, input);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}

void test("names an unnamed draft by its creator and creation date, and renames it from the header", async (t) => {
  const calls = mockApi(t, () => json(emptyPreview));
  const close = await openReview();
  try {
    assert.equal(dialogTitle(), "Ada, Oct 13");

    await click(window.document.querySelector('[data-slot="sheet-title"] button'));
    await typeName("Spring campaign", "Enter");
    await settle();

    assert.deepEqual(
      calls.filter((call) => call.path === "drafts/rename").map((call) => call.input),
      [{ projectId: 1, name: "Spring campaign" }],
    );
    assert.equal(dialogTitle(), "Spring campaign");
  } finally {
    await close();
  }
});

void test("leaves the name as it is when editing is cancelled", async (t) => {
  const calls = mockApi(t, () => json(emptyPreview));
  const close = await openReview();
  try {
    await click(window.document.querySelector('[data-slot="sheet-title"] button'));
    await typeName("Never mind", "Escape");

    assert.equal(calls.filter((call) => call.path === "drafts/rename").length, 0);
    assert.equal(dialogTitle(), "Ada, Oct 13");
  } finally {
    await close();
  }
});
