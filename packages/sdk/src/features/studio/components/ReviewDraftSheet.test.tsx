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
  changes: [
    { entity: "block", id: blockId, label: "Hero", owner: home, locale: "en", change: "changed" },
  ],
  translating: [] as string[],
  defaultLocale: "en",
  token: "token-1",
  overview: { status: "pending" } as
    | { status: "none" | "pending" | "failed" }
    | { status: "ready"; headline: string; bullets: string[] },
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
  translatingLocales: [] as string[],
};

/** What the draft's summary says besides its name, as the test sets it. */
let drafted: Partial<typeof draft> = {};

/**
 * Answers the draft's own summary, its locales and renames; everything else goes to `respond`.
 */
function mockApi(t: test.TestContext, respond: (path: string, calls: Call[]) => Response) {
  const calls: Call[] = [];
  let name: string | null = null;
  drafted = {};
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const path = new URL(request.url).pathname.replace(/^\/rpc\//, "");
    const input = ((await request.json()) as { json: unknown }).json;
    calls.push({ path, input });
    if (path === "drafts/get") return json({ ...draft, name, ...drafted });
    if (path === "locales/list") {
      return json([
        { tag: "en", isDefault: true },
        { tag: "de", isDefault: false },
        { tag: "fr", isDefault: false },
      ]);
    }
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

/** The open review's query client. */
let queryClient: QueryClient;

/** Refreshes the draft's summary, as the project room does when its translations settle. */
async function refreshDraftSummary() {
  await React.act(async () => {
    await queryClient.invalidateQueries({ queryKey: ["camox", "drafts", "get"] });
  });
  await settle();
}

async function openReview() {
  window.history.replaceState(null, "", `/?${DRAFT_SEARCH_PARAM}=${draftId}`);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient = client;
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

const sheetTitle = () =>
  window.document.querySelector('[data-slot="sheet-title"]')?.textContent ?? "";
const sheetDescription = () =>
  window.document.querySelector('[data-slot="sheet-description"]')?.textContent ?? "";
const bullets = () =>
  [...window.document.querySelectorAll('[role="dialog"] [data-overview] li')].map(
    (bullet) => bullet.textContent,
  );

void test("titles the review with the overview's headline, the draft's name and author above it, and lists its bullets", async (t) => {
  mockApi(t, () =>
    json({
      ...emptyPreview,
      overview: {
        status: "ready",
        headline: "Retitles the homepage hero",
        bullets: ["Home: the hero gets a new title", "Files: two images replaced"],
      },
    }),
  );
  drafted = { kind: "development" };
  const close = await openReview();
  try {
    assert.equal(sheetTitle(), "Retitles the homepage hero");
    assert.match(sheetDescription(), /Ada/);
    assert.deepEqual(bullets(), ["Home: the hero gets a new title", "Files: two images replaced"]);
  } finally {
    await close();
  }
});

void test("keeps a regular draft's name renamable above the headline", async (t) => {
  mockApi(t, () =>
    json({ ...emptyPreview, overview: { status: "ready", headline: "Retitles", bullets: [] } }),
  );
  const close = await openReview();
  try {
    assert.equal(sheetTitle(), "Retitles");
    assert.ok(window.document.querySelector('input[aria-label="Draft name"]'));
  } finally {
    await close();
  }
});

void test("says it's summarizing the draft while the overview is pending, titled with the draft's label", async (t) => {
  mockApi(t, () => json({ ...emptyPreview, overview: { status: "pending" } }));
  drafted = { kind: "development" };
  const close = await openReview();
  try {
    assert.match(dialogText(), /Summarizing this draft…/);
    assert.ok(window.document.querySelector('[role="dialog"] [data-slot="skeleton"]'));
    assert.equal(sheetTitle(), "Development draft");
  } finally {
    await close();
  }
});

void test("offers to retry an overview that failed, counting the changes and places meanwhile", async (t) => {
  const record = {
    entity: "record",
    id: "019a0000-0000-7000-8000-000000000010",
    label: "Ada",
    owner: { kind: "collection", name: "authors", title: "Authors" },
    locale: "en",
    change: "created",
  };
  const calls = mockApi(t, (path) => {
    if (path === "drafts/retryOverview") return json(null);
    return json({
      ...emptyPreview,
      changes: [...emptyPreview.changes, record, { ...record, id: `${record.id}1` }],
      overview: { status: "failed" },
    });
  });
  const close = await openReview();
  try {
    assert.match(dialogText(), /Couldn't summarize this draft/);
    assert.match(dialogText(), /3 changes in 2 places/);

    await click(buttonNamed(/Retry/));

    assert.deepEqual(
      calls.filter((call) => call.path === "drafts/retryOverview").map((call) => call.input),
      [{ projectId: 1 }],
    );
  } finally {
    await close();
  }
});

void test("says an empty draft has no changes, with no overview", async (t) => {
  mockApi(t, () => json({ ...emptyPreview, changes: [], overview: { status: "none" } }));
  const close = await openReview();
  try {
    assert.match(dialogText(), /This draft has no changes/);
    assert.doesNotMatch(dialogText(), /Summarizing/);
    assert.deepEqual(bullets(), []);
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

/** The locales, places and changes of the expanded list of changes, in order. */
const listedChanges = () =>
  [
    ...window.document.querySelectorAll(
      '[role="dialog"] [data-change-locale], [role="dialog"] h4, [role="dialog"] [data-change-label]',
    ),
  ].map((element) => {
    if (element.hasAttribute("data-change-locale")) return `locale ${element.textContent}`;
    return `${element.tagName === "H4" ? "place" : "change"} ${element.textContent}`;
  });

void test("groups changes by locale, the default locale first, once the draft changes another locale", async (t) => {
  const block = (locale: string) => ({
    entity: "block",
    id: blockId,
    label: "Hero",
    owner: home,
    locale,
    change: "changed",
  });
  mockApi(t, () =>
    json({
      ...emptyPreview,
      changes: [
        block("de"),
        block("en"),
        {
          entity: "locale",
          id: "locale-fr",
          label: "fr",
          owner: null,
          locale: null,
          change: "created",
        },
      ],
    }),
  );
  const close = await openReview();
  try {
    await expandChanges();
    assert.deepEqual(listedChanges(), [
      "locale English (en)",
      "place Home",
      "change Hero",
      "locale German (de)",
      "place Home",
      "change Hero",
      "place Languages",
      "change French (fr)",
    ]);
  } finally {
    await close();
  }
});

void test("names no locale while every change is in the default locale", async (t) => {
  mockApi(t, () => json(emptyPreview));
  const close = await openReview();
  try {
    await expandChanges();
    assert.deepEqual(listedChanges(), ["place Home", "change Hero"]);
  } finally {
    await close();
  }
});

void test("waits for pending translations, and publishes anyway when asked", async (t) => {
  const calls = mockApi(t, (path) => {
    if (path === "drafts/previewPublish") return json({ ...emptyPreview, translating: ["de"] });
    return json({
      ended: { draftId, outcome: "published", endedBy: { id: "user-1", name: "Me" }, endedAt: 1 },
    });
  });
  drafted = { translatingLocales: ["de"] };
  const close = await openReview();
  try {
    assert.match(dialogText(), /Translating into German \(de\)/);

    await click(buttonNamed(/Publish anyway/));

    assert.deepEqual(
      calls.filter((call) => call.path === "drafts/publish").map((call) => call.input),
      [{ projectId: 1, token: "token-1", publishAnyway: true }],
    );
    assert.equal(draftScope.current(), null);
  } finally {
    await close();
  }
});

void test("publishes once the translations finish, when asked to while they run", async (t) => {
  let preview: unknown = { ...emptyPreview, translating: ["de"] };
  const calls = mockApi(t, (path) => {
    if (path === "drafts/previewPublish") return json(preview);
    return json({
      ended: { draftId, outcome: "published", endedBy: { id: "user-1", name: "Me" }, endedAt: 1 },
    });
  });
  drafted = { translatingLocales: ["de"] };
  const close = await openReview();
  const publishes = () => calls.filter((call) => call.path === "drafts/publish");
  try {
    await click(buttonNamed(/Publish all/));

    assert.deepEqual(publishes(), []);
    assert.match(dialogText(), /Publishing once translated/);
    assert.ok(buttonNamed(/Publish anyway/));

    // The jobs settle, and the project room refreshes the draft's summary.
    preview = { ...emptyPreview, token: "token-3" };
    drafted = { translatingLocales: [] };
    await refreshDraftSummary();

    assert.deepEqual(
      publishes().map((call) => call.input),
      [{ projectId: 1, token: "token-3" }],
    );
    assert.equal(draftScope.current(), null);
  } finally {
    await close();
  }
});

void test("stops waiting to publish when a conflict appears as the translations finish", async (t) => {
  let preview: unknown = { ...emptyPreview, translating: ["de"] };
  const calls = mockApi(t, (path) => {
    if (path === "drafts/previewPublish") return json(preview);
    return json({});
  });
  drafted = { translatingLocales: ["de"] };
  const close = await openReview();
  try {
    await click(buttonNamed(/Publish all/));

    preview = conflictedPreview;
    drafted = { translatingLocales: [] };
    await refreshDraftSummary();

    assert.deepEqual(
      calls.filter((call) => call.path === "drafts/publish"),
      [],
    );
    assert.doesNotMatch(dialogText(), /Publishing once translated/);
    assert.match(dialogText(), /1 Live change will be overwritten/);
    assert.equal(buttonNamed(/Publish all/)?.disabled, false);
  } finally {
    await close();
  }
});

void test("offers to publish once the translations finish", async (t) => {
  let translating = ["de"];
  mockApi(t, (path) => {
    if (path === "drafts/previewPublish") return json({ ...emptyPreview, translating });
    return json({});
  });
  drafted = { translatingLocales: translating };
  const close = await openReview();
  try {
    // The jobs settle, and the project room refreshes the draft's summary.
    translating = [];
    drafted = { translatingLocales: [] };
    await refreshDraftSummary();

    assert.doesNotMatch(dialogText(), /Translating/);
    assert.equal(buttonNamed(/Publish all/)?.disabled, false);
    assert.equal(buttonNamed(/Publish anyway/), undefined);
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

const nameInput = () =>
  window.document.querySelector('input[aria-label="Draft name"]') as unknown as
    | HTMLInputElement
    | undefined;

/** Focuses the name, types over it, then presses `key`. */
async function typeName(value: string, key: "Enter" | "Escape") {
  const input = nameInput();
  assert.ok(input, "expected the name to be editable");
  await React.act(async () => {
    input.focus();
    input.value = value;
    input.dispatchEvent(
      new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }) as never,
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}

void test("names an unnamed draft by its creator and creation date, and renames it in place from the header", async (t) => {
  const calls = mockApi(t, () => json(emptyPreview));
  const close = await openReview();
  try {
    assert.equal(dialogTitle(), "Ada, Oct 13");
    // Unnamed, the name field reads its computed label, and isn't being edited.
    assert.equal(nameInput()?.value, "");
    assert.equal(nameInput()?.placeholder, "Ada, Oct 13");
    assert.notEqual(window.document.activeElement, nameInput());

    await typeName("Spring campaign", "Enter");
    await settle();

    assert.deepEqual(
      calls.filter((call) => call.path === "drafts/rename").map((call) => call.input),
      [{ projectId: 1, name: "Spring campaign" }],
    );
    assert.equal(dialogTitle(), "Spring campaign");
    assert.equal(nameInput()?.value, "Spring campaign");
  } finally {
    await close();
  }
});

void test("leaves the name as it is when editing is cancelled", async (t) => {
  const calls = mockApi(t, () => json(emptyPreview));
  const close = await openReview();
  try {
    await typeName("Never mind", "Escape");
    await settle();

    assert.equal(calls.filter((call) => call.path === "drafts/rename").length, 0);
    assert.equal(dialogTitle(), "Ada, Oct 13");
    assert.equal(nameInput()?.value, "");
  } finally {
    await close();
  }
});
