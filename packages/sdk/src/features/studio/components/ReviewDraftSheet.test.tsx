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
};

const conflictedPreview = {
  ...emptyPreview,
  conflicts: [
    {
      entity: "block",
      id: blockId,
      label: "Hero",
      owner: home,
      locale: "en",
      liveVersion: 3,
      publishedBy: { id: "user-2", name: "Ada" },
      publishedAt: Date.UTC(2026, 9, 13),
      release: false,
      fields: [] as { field: string; live: string; draft: string }[],
      moreFields: 0,
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

const multilingual = [
  { tag: "en", isDefault: true },
  { tag: "de", isDefault: false },
  { tag: "fr", isDefault: false },
];

/** The website's locales, as the test sets them: multilingual unless it says otherwise. */
let websiteLocales = multilingual;

/**
 * Answers the draft's own summary, its locales and renames; everything else goes to `respond`.
 */
function mockApi(t: test.TestContext, respond: (path: string, calls: Call[]) => Response) {
  const calls: Call[] = [];
  let name: string | null = null;
  drafted = {};
  websiteLocales = multilingual;
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const path = new URL(request.url).pathname.replace(/^\/rpc\//, "");
    const input = ((await request.json()) as { json: unknown }).json;
    calls.push({ path, input });
    if (path === "drafts/get") return json({ ...draft, name, ...drafted });
    if (path === "locales/list") return json(websiteLocales);
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

/** The card titles, in the order the review shows them. */
const cardTitles = () =>
  [...window.document.querySelectorAll('[role="dialog"] [data-card-title]')].map(
    (title) => title.textContent,
  );

/** The status lines' text, in order. */
const statusLines = () =>
  [...window.document.querySelectorAll('[role="dialog"] [data-status-line]')].map(
    (line) => line.textContent,
  );

const publishButton = () => buttonNamed(/^Publish$/);

const danglingOnLive = {
  entity: "block",
  id: "019a0000-0000-7000-8000-000000000020",
  label: "Footer",
  owner: home,
  code: "danglingReference",
  field: "link",
  message: '"Link" points at a page that no longer exists',
};

void test("shows no verdict, change list or warnings about Live, and says the draft includes everything published to Live", async (t) => {
  mockApi(t, () => json({ ...emptyPreview, warnings: [danglingOnLive] }));
  const close = await openReview();
  try {
    assert.doesNotMatch(dialogText(), /Ready to publish/);
    // The draft's changes and the problem already on Live go unmentioned.
    assert.doesNotMatch(dialogText(), /Hero/);
    assert.doesNotMatch(dialogText(), /Footer|points at a page/);
    assert.deepEqual(cardTitles(), []);
    assert.equal(window.document.querySelector('[role="dialog"] [aria-expanded]'), null);
    assert.ok(
      statusLines().includes("Includes everything published to Live since this draft started"),
    );
    assert.equal(publishButton()?.disabled, false);
  } finally {
    await close();
  }
});

void test("says the draft is translated only on a multilingual website", async (t) => {
  mockApi(t, () => json(emptyPreview));
  const close = await openReview();
  try {
    assert.ok(statusLines().includes("Translated into German (de) and French (fr)"));
  } finally {
    await close();
  }
});

void test("says nothing about translations on a website with one language", async (t) => {
  mockApi(t, () => json(emptyPreview));
  websiteLocales = [{ tag: "en", isDefault: true }];
  const close = await openReview();
  try {
    assert.deepEqual(statusLines(), [
      "Includes everything published to Live since this draft started",
    ]);
  } finally {
    await close();
  }
});

void test("says SEO is being written while pages' meta titles are pending, instead of a warning", async (t) => {
  const pending = (id: string) => ({
    entity: "page",
    id,
    label: id,
    owner: null,
    code: "metaTitlePending",
    field: "metaTitle",
    message: "The page's meta title is still being generated",
  });
  mockApi(t, () =>
    json({ ...emptyPreview, warnings: [pending("/pricing"), pending("/about"), danglingOnLive] }),
  );
  const close = await openReview();
  try {
    assert.ok(statusLines().includes("Writing SEO for 2 pages…"));
    assert.doesNotMatch(dialogText(), /still being generated/);
    assert.deepEqual(cardTitles(), []);
  } finally {
    await close();
  }
});

void test("says nothing about SEO when no meta title is pending", async (t) => {
  mockApi(t, () => json(emptyPreview));
  const close = await openReview();
  try {
    assert.doesNotMatch(dialogText(), /Writing SEO/);
  } finally {
    await close();
  }
});

void test("leaves out the line about Live while the draft has conflicts", async (t) => {
  mockApi(t, () => json(conflictedPreview));
  const close = await openReview();
  try {
    assert.doesNotMatch(dialogText(), /Includes everything published to Live/);
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
    await click(publishButton());

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
    await click(publishButton());

    preview = conflictedPreview;
    drafted = { translatingLocales: [] };
    await refreshDraftSummary();

    assert.deepEqual(
      calls.filter((call) => call.path === "drafts/publish"),
      [],
    );
    assert.doesNotMatch(dialogText(), /Publishing once translated/);
    assert.deepEqual(cardTitles(), ["Replaces Ada's edit to the Hero"]);
    assert.equal(publishButton()?.disabled, false);
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
    assert.equal(publishButton()?.disabled, false);
    assert.equal(buttonNamed(/Publish anyway/), undefined);
  } finally {
    await close();
  }
});

void test("shows blockers first, saying what's wrong and where, and disables Publish", async (t) => {
  mockApi(t, () =>
    json({
      ...conflictedPreview,
      lost: [
        {
          entity: "block",
          id: "019a0000-0000-7000-8000-000000000030",
          label: "Testimonial",
          owner: home,
          locale: "en",
          reason: "parentGone",
        },
      ],
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
    assert.deepEqual(cardTitles(), [
      '"Author" is required but empty',
      "Replaces Ada's edit to the Hero",
      "Loses the change to the Testimonial",
    ]);
    assert.match(dialogText(), /"Author" is required but empty\s*Quote · Home/);
    assert.equal(publishButton()?.disabled, true);
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
    assert.equal(publishButton()?.disabled, true);
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
    await click(publishButton());
    await settle();

    assert.match(dialogText(), /Ada/);
    assert.deepEqual(cardTitles(), ["Replaces Ada's edit to the Hero"]);
    assert.equal(new URL(window.location.href).searchParams.get(DRAFT_SEARCH_PARAM), draftId);

    await click(publishButton());

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
    await click(publishButton());

    assert.equal(calls.filter((call) => call.path === "drafts/publish").length, 1);
    assert.equal(new URL(window.location.href).searchParams.get(DRAFT_SEARCH_PARAM), draftId);
    assert.equal(draftScope.current(), draftId);
  } finally {
    await close();
  }
});

/** The text of the card titled `title`. */
const cardText = (title: string) =>
  [...window.document.querySelectorAll('[role="dialog"] [data-card]')].find(
    (card) => card.querySelector("[data-card-title]")?.textContent === title,
  )?.textContent ?? "";

const conflict = conflictedPreview.conflicts[0];

void test("words a conflict as replacing the member's edit, saying where and when Live changed", async (t) => {
  mockApi(t, () => json(conflictedPreview));
  const close = await openReview();
  try {
    assert.deepEqual(cardTitles(), ["Replaces Ada's edit to the Hero"]);
    const text = cardText("Replaces Ada's edit to the Hero");
    assert.match(text, /Home/);
    assert.match(text, /Ada changed it on Live on Oct 13\. Publishing replaces it/);
  } finally {
    await close();
  }
});

void test("words a conflict a release made without naming a person", async (t) => {
  mockApi(t, () =>
    json({ ...conflictedPreview, conflicts: [{ ...conflict, publishedBy: null, release: true }] }),
  );
  const close = await openReview();
  try {
    assert.deepEqual(cardTitles(), ["Replaces a release's change to the Hero"]);
    assert.match(cardText("Replaces a release's change to the Hero"), /A release changed it/);
    assert.doesNotMatch(dialogText(), /Ada's/);
  } finally {
    await close();
  }
});

void test("words a conflict with no known author without a name", async (t) => {
  mockApi(t, () =>
    json({
      ...conflictedPreview,
      conflicts: [{ ...conflict, publishedBy: null, publishedAt: null, release: false }],
    }),
  );
  const close = await openReview();
  try {
    assert.deepEqual(cardTitles(), ["Replaces an edit to the Hero"]);
    assert.match(cardText("Replaces an edit to the Hero"), /Live changed it\./);
  } finally {
    await close();
  }
});

void test("says publishing brings back what Live deleted", async (t) => {
  mockApi(t, () => json({ ...conflictedPreview, conflicts: [{ ...conflict, liveVersion: null }] }));
  const close = await openReview();
  try {
    assert.deepEqual(cardTitles(), ["Brings back the Hero"]);
    assert.match(
      cardText("Brings back the Hero"),
      /Ada deleted it from Live on Oct 13\. Publishing brings it back\./,
    );
  } finally {
    await close();
  }
});

/** The fields a conflict card shows, each as its title, Live's value and the draft's. */
const conflictFields = () =>
  [...window.document.querySelectorAll('[role="dialog"] [data-conflict-field]')].map((field) => ({
    field: field.querySelector("[data-field-title]")?.textContent,
    live: field.querySelector("[data-live-value]")?.textContent,
    liveCrossedOut: !!field.querySelector("del [data-live-value], del[data-live-value]"),
    draft: field.querySelector("[data-draft-value]")?.textContent,
    // Live's value comes first, then the draft's.
    order: [...field.querySelectorAll("[data-live-value], [data-draft-value]")].map((value) =>
      value.hasAttribute("data-live-value") ? "live" : "draft",
    ),
  }));

void test("shows the fields a conflict overwrites, Live's value crossed out above the draft's", async (t) => {
  mockApi(t, () =>
    json({
      ...conflictedPreview,
      conflicts: [
        {
          ...conflict,
          fields: [
            { field: "Title", live: "Welcome back", draft: "Welcome home" },
            { field: "Author", live: "Léo", draft: "Ana" },
          ],
        },
      ],
    }),
  );
  const close = await openReview();
  try {
    const both = { liveCrossedOut: true, order: ["live", "draft"] };
    assert.deepEqual(conflictFields(), [
      { field: "Title", live: "Welcome back", draft: "Welcome home", ...both },
      { field: "Author", live: "Léo", draft: "Ana", ...both },
    ]);
    const text = cardText("Replaces Ada's edit to the Hero");
    assert.match(text, /On Live now · Ada, Oct 13/);
    assert.match(text, /This draft/);
  } finally {
    await close();
  }
});

void test("counts the fields a conflict card doesn't list", async (t) => {
  mockApi(t, () =>
    json({
      ...conflictedPreview,
      conflicts: [
        {
          ...conflict,
          fields: [{ field: "Title", live: "Welcome back", draft: "Welcome home" }],
          moreFields: 2,
        },
      ],
    }),
  );
  const close = await openReview();
  try {
    assert.match(cardText("Replaces Ada's edit to the Hero"), /2 more fields/);
  } finally {
    await close();
  }
});

void test("labels Live's values without a name when a release or no known author made them", async (t) => {
  const fields = [{ field: "Title", live: "Welcome back", draft: "Welcome home" }];
  mockApi(t, () =>
    json({
      ...conflictedPreview,
      conflicts: [{ ...conflict, fields, publishedBy: null, release: true }],
    }),
  );
  const close = await openReview();
  try {
    const text = cardText("Replaces a release's change to the Hero");
    assert.match(text, /On Live now · A release, Oct 13/);
    assert.doesNotMatch(text, /Ada/);
  } finally {
    await close();
  }
});

void test("says publishing deletes anyway what the draft deletes and Live changed", async (t) => {
  mockApi(t, () =>
    json({
      ...conflictedPreview,
      changes: [{ ...emptyPreview.changes[0], change: "deleted" }],
    }),
  );
  const close = await openReview();
  try {
    assert.match(
      cardText("Replaces Ada's edit to the Hero"),
      /This draft deletes it, so publishing deletes it anyway\./,
    );
  } finally {
    await close();
  }
});

void test("explains in plain words why each lost change can't be published", async (t) => {
  const lost = (id: string, label: string, reason: string) => ({
    entity: "block",
    id,
    label,
    owner: home,
    locale: "en",
    reason,
  });
  mockApi(t, () =>
    json({
      ...emptyPreview,
      lost: [
        lost("019a0000-0000-7000-8000-000000000031", "Testimonial", "parentGone"),
        lost(
          "019a0000-0000-7000-8000-000000000032",
          "Added to Pricing after it was deleted",
          "writtenAfterDeletion",
        ),
      ],
    }),
  );
  const close = await openReview();
  try {
    assert.match(
      cardText("Loses the change to the Testimonial"),
      /gone from Live and from this draft/,
    );
    assert.match(
      cardText("Added to Pricing after it was deleted"),
      /This draft deletes what it was added to/,
    );
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
