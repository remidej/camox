import assert from "node:assert/strict";
import { test } from "node:test";

import { DRAFT_SEARCH_PARAM } from "@camox/api-contract/drafts";
import { detectPlatform } from "@tanstack/react-hotkeys";
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
  PointerEvent: window.PointerEvent,
  MouseEvent: window.MouseEvent,
  KeyboardEvent: window.KeyboardEvent,
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
const { toast } = await import("@camox/ui/toaster");
const { DraftPicker } = await import("./DraftsControl");
const { DraftBar, SETTLE_MS } = await import("./DraftBar");
const { initApiClient } = await import("@/lib/api-client");
const { AuthContext } = await import("@/lib/auth");
const { NavigationProvider } = await import("@/features/navigation/navigation");
const { createDraftScope } = await import("@/lib/draft-scope");
const { StudioScopeProvider } = await import("@/lib/draft-scope.fixtures");
/** The draft scope of the rendered control, and whether it runs in dev mode. */
let draftScope: import("@/lib/draft-scope").DraftScope;
const { CommandPalette, useCommandPaletteActions } =
  await import("@/features/provider/components/CommandPalette");
const { useAdminShortcuts } = await import("@/features/provider/useAdminShortcuts");

/** The command palette as the authenticated studio mounts it, opened with its shortcut. */
function Palette() {
  useAdminShortcuts();
  useCommandPaletteActions();
  return <CommandPalette />;
}

const DAY = 24 * 60 * 60 * 1000;
const project = { id: 1, slug: "site", name: "Site" };
const spring = "019a0000-0000-7000-8000-00000000000a";
const adas = "019a0000-0000-7000-8000-00000000000b";
const ada = { id: "user-ada", name: "Ada" };
const remi = { id: "user-remi", name: "Rémi" };

const createdOct13 = new Date(2026, 9, 13, 12).getTime();
const drafts = [
  {
    id: spring,
    name: "Spring campaign",
    createdBy: remi,
    createdAt: Date.now() - 3 * DAY,
    lastChangedAt: Date.now() - DAY,
    changeCount: 4,
    translatingLocales: [],
  },
  {
    id: adas,
    name: null,
    createdBy: ada,
    createdAt: createdOct13,
    lastChangedAt: createdOct13,
    changeCount: 1,
    translatingLocales: [],
  },
];
const list = {
  live: { publishedBy: ada, publishedAt: Date.now() - 2 * DAY, release: false },
  drafts,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify({ json: body }), {
    status,
    headers: { "content-type": "application/json" },
  });

type Call = { path: string; input: unknown; draft: string | null };

function mockApi(
  t: test.TestContext,
  respond: (path: string) => Response | undefined = () => undefined,
) {
  const calls: Call[] = [];
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const path = new URL(request.url).pathname.replace(/^\/rpc\//, "");
    const body = request.method === "GET" ? null : ((await request.json()) as { json: unknown });
    calls.push({ path, input: body?.json, draft: request.headers.get("x-camox-draft") });
    const custom = respond(path);
    if (custom) return custom;
    if (path === "projects/getByUuid") return json(project);
    if (path === "drafts/list") return json(list);
    if (path === "drafts/get") {
      const id = request.headers.get("x-camox-draft");
      return json(drafts.find((draft) => draft.id === id));
    }
    if (path === "drafts/previewPublish") return previewWith({ status: "none" });
    if (path === "locales/list") return json([{ tag: "en", isDefault: true }]);
    if (path === "drafts/delete") {
      const draftId = request.headers.get("x-camox-draft") ?? spring;
      return json({ ended: { draftId, outcome: "deleted", endedBy: remi, endedAt: Date.now() } });
    }
    return json({});
  });
  return calls;
}

/** A publish preview of a draft with nothing to hold it, and this Draft Overview. */
function previewWith(overview: unknown) {
  return json({
    blockers: [],
    conflicts: [],
    lost: [],
    warnings: [],
    changes: [],
    translating: [],
    findings: [],
    checking: [],
    defaultLocale: "en",
    token: "t",
    overview,
  });
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

const trigger = () =>
  window.document.querySelector('[data-slot="dropdown-menu-trigger"]') as unknown as HTMLElement;
const bar = () => window.document.querySelector('[aria-label="Draft"]');
const barButtons = () => [...(bar()?.querySelectorAll("button") ?? [])];
const barButton = (label: string) =>
  barButtons().find((button) => button.textContent === label) as unknown as
    | HTMLButtonElement
    | undefined;
const menu = () => window.document.querySelector('[role="menu"]');
const menuItems = () =>
  [...window.document.querySelectorAll('[role="menu"] [role^="menuitem"]')].map(
    (item) => item as unknown as HTMLElement,
  );
const itemNamed = (name: RegExp) => menuItems().find((item) => name.test(item.textContent ?? ""));

const palette = () => window.document.querySelector("[cmdk-root]");
const paletteItems = () =>
  [...window.document.querySelectorAll("[cmdk-item]")].map(
    (item) => item as unknown as HTMLElement,
  );
const paletteLabels = () => paletteItems().map((item) => item.textContent);
const paletteItem = (label: string) => paletteItems().find((item) => item.textContent === label);

// Mod is Command where happy-dom reports macOS, Control elsewhere.
const MOD_KEY = detectPlatform() === "mac" ? { metaKey: true } : { ctrlKey: true };

async function togglePalette() {
  await React.act(async () => {
    window.document.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "k", ...MOD_KEY, bubbles: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}

async function openPalette() {
  if (!palette()) await togglePalette();
  assert.ok(palette(), "expected the command palette to open");
}

/** Opens the palette and selects the action with this visible label. */
async function runCommand(label: string) {
  await openPalette();
  await click(paletteItem(label));
}

/** The palette's commands under its Drafts heading. */
const draftsCommands = () => {
  const group = [...window.document.querySelectorAll("[cmdk-group]")].find(
    (candidate) => candidate.querySelector("[cmdk-group-heading]")?.textContent === "Drafts",
  );
  return [...(group?.querySelectorAll("[cmdk-item]") ?? [])].map((item) => item.textContent);
};

/**
 * Types into the palette's search field. React tracks an input's value and ignores an input
 * event whose value it already knows, so assigning `input.value` would be swallowed; setting
 * it through the prototype's native setter bypasses that tracker, and React sees the change.
 */
async function search(text: string) {
  const input = window.document.querySelector("[cmdk-input]") as unknown as HTMLInputElement;
  assert.ok(input, "expected the palette's search field");
  await React.act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!;
    setValue.set!.call(input, text);
    input.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}

const sheetTitle = () =>
  window.document.querySelector('[role="dialog"] [data-slot="sheet-title"]')?.textContent ?? "";

const nameInput = () =>
  window.document.querySelector('[role="dialog"] input[aria-label="Draft name"]') as unknown as
    | HTMLInputElement
    | undefined;

async function render(t: test.TestContext, at: string | null) {
  window.history.replaceState(null, "", at ? `/?${DRAFT_SEARCH_PARAM}=${at}` : "/");
  const navigations: { to: string; draft?: string | null }[] = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  draftScope = createDraftScope({ queryClient: client, browser: window as never });
  draftScope.adopt({ draftId: at ?? undefined });
  initApiClient("http://api.test", draftScope);
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const auth = {
    authClient: {} as never,
    authenticationUrl: "",
    apiUrl: "http://api.test",
    projectUuid: project.slug,
  };
  await React.act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <StudioScopeProvider client={client} draftScope={draftScope}>
          <AuthContext.Provider value={auth}>
            <NavigationProvider navigate={(options) => void navigations.push(options)}>
              <DraftPicker />
              <DraftBar />
              <Palette />
            </NavigationProvider>
          </AuthContext.Provider>
        </StudioScopeProvider>
      </QueryClientProvider>,
    ),
  );
  await settle();
  t.after(async () => {
    if (palette()) await togglePalette();
    await React.act(async () => root.unmount());
    host.remove();
    client.clear();
  });
  return { navigations };
}

/** An API whose answers to these paths never arrive, to see the control while they load. */
function stallingApi(t: test.TestContext, stalled: string[]) {
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const path = new URL(request.url).pathname.replace(/^\/rpc\//, "");
    if (stalled.includes(path)) return new Promise<Response>(() => {});
    if (path === "projects/getByUuid") return json(project);
    if (path === "drafts/list") return json(list);
    if (path === "drafts/get") {
      const id = request.headers.get("x-camox-draft");
      return json(drafts.find((draft) => draft.id === id));
    }
    return json({});
  });
}

void test("on Live, reads Live before anything loads", async (t) => {
  stallingApi(t, ["projects/getByUuid"]);
  await render(t, null);

  assert.equal(trigger()?.textContent, "Live");
});

void test("in a regular draft, shows nothing until the draft loads rather than a placeholder", async (t) => {
  stallingApi(t, ["drafts/get"]);
  await render(t, spring);

  assert.equal(trigger()?.textContent, undefined);
});

void test("on Live, reads Live, says the first edit starts a draft, and shows no draft row", async (t) => {
  mockApi(t);
  await render(t, null);

  assert.equal(trigger().textContent, "Live");
  assert.ok(!bar(), "expected no draft row");
  await click(trigger());

  assert.match(menu()?.textContent ?? "", /Live is read-only/);
  assert.match(menu()?.textContent ?? "", /first edit starts a new draft/);
});

void test("in a named draft, the picker reads its name and the row its pending changes, to discard or publish", async (t) => {
  mockApi(t);
  await render(t, spring);

  assert.equal(trigger().textContent, "Spring campaign");
  assert.match(bar()?.textContent ?? "", /4 pending changes/);
  assert.deepEqual(
    barButtons().map((button) => button.textContent),
    ["Discard", "Publish…"],
  );
});

void test("in an unnamed draft, the picker reads its creator and date", async (t) => {
  mockApi(t);
  await render(t, adas);

  assert.equal(trigger().textContent, "Ada, Oct 13");
});

void test("a draft without changes can be discarded but has nothing to publish", async (t) => {
  mockApi(t, (path) =>
    path === "drafts/get" ? json({ ...drafts[0], changeCount: 0 }) : undefined,
  );
  await render(t, spring);

  assert.match(bar()?.textContent ?? "", /No changes yet/);
  assert.equal(barButton("Discard")?.disabled, false);
  assert.equal(barButton("Publish…")?.disabled, true);
});

void test("in a draft, the picker offers only switching, not the draft's actions", async (t) => {
  mockApi(t);
  await render(t, spring);
  await click(trigger());

  assert.doesNotMatch(menu()?.textContent ?? "", /Review|Delete|read-only/);
});

void test("Publish… opens a named draft's review", async (t) => {
  mockApi(t);
  await render(t, spring);

  await click(barButton("Publish…"));

  assert.equal(sheetTitle(), "Spring campaign");
  assert.match(window.document.querySelector('[role="dialog"]')?.textContent ?? "", /Delete draft/);
});

void test("lists Live with its last publisher and every open draft with its creator, age and change count", async (t) => {
  mockApi(t);
  await render(t, null);
  await click(trigger());

  assert.match(itemNamed(/^Live/)?.textContent ?? "", /Published 2 days ago by Ada/);
  assert.match(itemNamed(/Spring campaign/)?.textContent ?? "", /Rémi · 3 days ago · 4 changes/);
  assert.match(itemNamed(/Ada, Oct 13/)?.textContent ?? "", /Ada · .* · 1 change/);
});

void test("says a release published Live when a release wrote it last", async (t) => {
  mockApi(t, (path) =>
    path === "drafts/list"
      ? json({ drafts, live: { publishedBy: null, publishedAt: Date.now() - DAY, release: true } })
      : undefined,
  );
  await render(t, null);
  await click(trigger());

  assert.match(itemNamed(/^Live/)?.textContent ?? "", /Published yesterday by a release/);
});

void test("picking a draft or Live navigates there", async (t) => {
  mockApi(t);
  const { navigations } = await render(t, spring);
  await click(trigger());

  await click(itemNamed(/Ada, Oct 13/));
  await click(trigger());
  await click(itemNamed(/^Live/));

  assert.deepEqual(
    navigations.map((navigation) => navigation.draft),
    [adas, null],
  );
});

void test("says Started a new draft when the first edit starts one, without asking for a name", async (t) => {
  mockApi(t);
  const shown = t.mock.method(toast, "success", () => "toast");
  await render(t, null);

  await React.act(async () => {
    draftScope.requestHeaders(true).settle(true);
  });

  assert.deepEqual(
    shown.mock.calls.map((call) => call.arguments[0]),
    ["Started a new draft"],
  );
  assert.equal(window.document.querySelector("input"), null);
});

void test("the palette's Review and publish opens the draft's review", async (t) => {
  mockApi(t);
  await render(t, spring);

  await runCommand("Review and publish");

  assert.equal(palette(), null);
  assert.equal(sheetTitle(), "Spring campaign");
  assert.match(window.document.querySelector('[role="dialog"]')?.textContent ?? "", /Delete draft/);
  assert.notEqual(window.document.activeElement, nameInput());
});

void test("the palette's Delete draft… asks for confirmation without deleting", async (t) => {
  const calls = mockApi(t);
  await render(t, spring);

  await runCommand("Delete draft…");

  const confirm = window.document.querySelector('[role="alertdialog"]');
  assert.match(confirm?.textContent ?? "", /Delete this draft\?/);
  assert.equal(calls.filter((call) => call.path === "drafts/delete").length, 0);
});

void test("the palette's Rename draft… opens the review with the draft's name focused and selected", async (t) => {
  mockApi(t);
  await render(t, spring);

  await runCommand("Rename draft…");

  const input = nameInput();
  assert.equal(input?.value, "Spring campaign");
  assert.equal(window.document.activeElement, input);
  assert.equal(input?.selectionStart, 0);
  assert.equal(input?.selectionEnd, "Spring campaign".length);
});

void test("the palette's Switch to Live leaves the draft for the same page", async (t) => {
  mockApi(t);
  const { navigations } = await render(t, spring);

  await runCommand("Switch to Live");

  assert.deepEqual(navigations, [
    { to: `http://localhost:3000/?${DRAFT_SEARCH_PARAM}=${spring}`, draft: null },
  ]);
});

void test("the palette's Switch to draft… lists the other regular drafts and switches to the one picked", async (t) => {
  mockApi(t);
  const { navigations } = await render(t, spring);

  await runCommand("Switch to draft…");
  assert.deepEqual(paletteLabels(), ['Switch to "Ada, Oct 13"']);
  await click(paletteItem('Switch to "Ada, Oct 13"'));

  assert.deepEqual(
    navigations.map((navigation) => navigation.draft),
    [adas],
  );
});

void test("on Live, the palette's only drafts command is Switch to draft…", async (t) => {
  mockApi(t);
  await render(t, null);
  await openPalette();

  assert.deepEqual(draftsCommands(), ["Switch to draft…"]);
});

void test("in a draft, the palette offers the draft's actions and switching", async (t) => {
  mockApi(t);
  await render(t, spring);
  await openPalette();

  assert.deepEqual(draftsCommands(), [
    "Review and publish",
    "Delete draft…",
    "Rename draft…",
    "Switch to Live",
    "Switch to draft…",
  ]);
});

void test("on Live, the palette's Switch to draft… lists every open draft", async (t) => {
  mockApi(t);
  await render(t, null);

  await runCommand("Switch to draft…");

  assert.deepEqual(paletteLabels(), ['Switch to "Spring campaign"', 'Switch to "Ada, Oct 13"']);
});

void test("the palette hides Switch to draft… when no other draft is open", async (t) => {
  mockApi(t, (path) =>
    path === "drafts/list" ? json({ ...list, drafts: [drafts[0]] }) : undefined,
  );
  await render(t, spring);
  await openPalette();

  assert.ok(draftsCommands().includes("Switch to Live"));
  assert.equal(draftsCommands().includes("Switch to draft…"), false);
});

void test("searching the palette for a creator's name finds their draft", async (t) => {
  mockApi(t);
  await render(t, null);
  await openPalette();

  await search("Rémi");

  assert.deepEqual(draftsCommands(), ['Switch to "Spring campaign"']);
});

// --- The Draft Row in an unnamed draft ---

void test("in an unnamed draft, the row offers the same two buttons", async (t) => {
  mockApi(t);
  await render(t, adas);

  assert.match(bar()?.textContent ?? "", /1 pending change/);
  assert.deepEqual(
    barButtons().map((button) => button.textContent),
    ["Discard", "Publish…"],
  );
});

void test("the row waits for the draft's edits to settle before showing", async (t) => {
  const changedAt = Date.now();
  mockApi(t, (path) =>
    path === "drafts/get" ? json({ ...drafts[1], lastChangedAt: changedAt }) : undefined,
  );
  await render(t, adas);
  assert.ok(!bar(), "expected no draft row");

  await React.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, changedAt + SETTLE_MS - Date.now() + 40));
  });
  assert.ok(bar());
});

void test("Publish… opens the draft's review", async (t) => {
  mockApi(t);
  await render(t, adas);

  await click(barButton("Publish…"));

  // An unnamed draft's review discards its changes rather than deletes a draft.
  assert.match(
    window.document.querySelector('[role="dialog"]')?.textContent ?? "",
    /Discard changes/,
  );
});

void test("Discard asks to discard the changes, then discards them and returns to Live", async (t) => {
  const calls = mockApi(t);
  const shown = t.mock.method(toast, "promise", () => ({ unwrap: async () => {} }));
  await render(t, adas);

  await click(barButton("Discard"));
  const confirm = window.document.querySelector('[role="alertdialog"]');
  assert.match(confirm?.textContent ?? "", /Discard these changes\?/);
  assert.equal(calls.filter((call) => call.path === "drafts/delete").length, 0);

  const discard = [...(confirm?.querySelectorAll("button") ?? [])].find(
    (button) => button.textContent === "Discard changes",
  );
  await click(discard);

  assert.equal(calls.filter((call) => call.path === "drafts/delete").length, 1);
  assert.deepEqual(
    shown.mock.calls.map((call) => (call.arguments[1] as { success?: unknown }).success),
    ["Changes discarded. You're now viewing Live."],
  );
});

void test("in an unnamed draft, the palette discards and names rather than deletes and renames", async (t) => {
  mockApi(t);
  await render(t, adas);
  await openPalette();

  assert.ok(draftsCommands().includes("Discard changes…"));
  assert.ok(draftsCommands().includes("Name draft…"));
  assert.equal(draftsCommands().includes("Delete draft…"), false);
  assert.equal(draftsCommands().includes("Rename draft…"), false);
});
