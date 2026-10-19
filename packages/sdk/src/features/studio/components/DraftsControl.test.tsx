import assert from "node:assert/strict";
import { test } from "node:test";

import { DEVELOPMENT_DRAFT, DRAFT_SEARCH_PARAM } from "@camox/api-contract/drafts";
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
const { DraftsControl } = await import("./DraftsControl");
const { initApiClient } = await import("@/lib/api-client");
const { AuthContext } = await import("@/lib/auth");
const { NavigationProvider } = await import("@/features/navigation/navigation");
const { createDraftScope } = await import("@/lib/draft-scope");
const { StudioScopeProvider } = await import("@/lib/draft-scope.fixtures");
/** The draft scope of the rendered control, and whether it runs in dev mode. */
let draftScope: import("@/lib/draft-scope").DraftScope;
let developmentMode = false;
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
const development = "019a0000-0000-7000-8000-00000000000c";
const ada = { id: "user-ada", name: "Ada" };
const remi = { id: "user-remi", name: "Rémi" };

const createdOct13 = new Date(2026, 9, 13, 12).getTime();
const drafts = [
  {
    id: spring,
    kind: "regular",
    name: "Spring campaign",
    createdBy: remi,
    createdAt: Date.now() - 3 * DAY,
    lastChangedAt: Date.now() - DAY,
    changeCount: 4,
    translatingLocales: [],
  },
  {
    id: adas,
    kind: "regular",
    name: null,
    createdBy: ada,
    createdAt: createdOct13,
    lastChangedAt: createdOct13,
    changeCount: 1,
    translatingLocales: [],
  },
  {
    id: development,
    kind: "development",
    name: null,
    createdBy: remi,
    createdAt: Date.now(),
    lastChangedAt: null,
    changeCount: 2,
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
    if (path === "projects/getBySlug") return json(project);
    if (path === "drafts/list") return json(list);
    if (path === "drafts/get") {
      const id = request.headers.get("x-camox-draft");
      return json(drafts.find((draft) => draft.id === id));
    }
    if (path === "drafts/previewPublish") {
      return json({
        blockers: [],
        conflicts: [],
        lost: [],
        warnings: [],
        changes: [],
        translating: [],
        token: "t",
      });
    }
    if (path === "locales/list") return json([{ tag: "en", isDefault: true }]);
    if (path === "drafts/discard") {
      return json({
        ended: { draftId: spring, outcome: "discarded", endedBy: remi, endedAt: Date.now() },
      });
    }
    return json({});
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

const trigger = () =>
  window.document.querySelector('[data-slot="dropdown-menu-trigger"]') as unknown as HTMLElement;
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

async function togglePalette() {
  await React.act(async () => {
    window.document.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
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
  draftScope = createDraftScope({ queryClient: client, browser: window as never, developmentMode });
  draftScope.adopt({ draftId: at ?? undefined });
  initApiClient("http://api.test", draftScope);
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const auth = {
    authClient: {} as never,
    authenticationUrl: "",
    apiUrl: "http://api.test",
    projectSlug: project.slug,
  };
  await React.act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <StudioScopeProvider client={client} draftScope={draftScope}>
          <AuthContext.Provider value={auth}>
            <NavigationProvider navigate={(options) => void navigations.push(options)}>
              <DraftsControl />
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
    if (path === "projects/getBySlug") return json(project);
    if (path === "drafts/list") return json(list);
    if (path === "drafts/get") {
      const id = request.headers.get("x-camox-draft");
      return json(drafts.find((draft) => draft.id === id));
    }
    return json({});
  });
}

void test("on Live, reads Viewing Live before anything loads", async (t) => {
  stallingApi(t, ["projects/getBySlug"]);
  await render(t, null);

  assert.equal(trigger()?.textContent, "Viewing Live");
});

void test("in a regular draft, shows nothing until the draft loads rather than a placeholder", async (t) => {
  stallingApi(t, ["drafts/get"]);
  await render(t, spring);

  assert.equal(trigger()?.textContent, undefined);
});

void test("the localhost studio reads Development draft before anything loads", async (t) => {
  developmentMode = true;
  t.after(() => {
    developmentMode = false;
  });
  stallingApi(t, ["projects/getBySlug", "drafts/get"]);
  await render(t, development);

  assert.equal(trigger()?.textContent, "Development draft");
});

void test("on Live, reads Viewing Live and says the first edit starts a draft", async (t) => {
  mockApi(t);
  await render(t, null);

  assert.equal(trigger().textContent, "Viewing Live");
  await click(trigger());

  assert.match(menu()?.textContent ?? "", /Live is read-only/);
  assert.match(menu()?.textContent ?? "", /first edit starts a new draft/);
  assert.equal(itemNamed(/Review and publish/), undefined);
});

void test("in a named draft, reads only its name", async (t) => {
  mockApi(t);
  await render(t, spring);

  assert.equal(trigger().textContent, "Spring campaign");
});

void test("in an unnamed draft, reads only its pending change count", async (t) => {
  mockApi(t);
  await render(t, adas);

  assert.equal(trigger().textContent, "1 pending change");
});

void test("in a draft, the menu starts with Review and publish, counting the changes, and Discard draft, without repeating the name", async (t) => {
  mockApi(t);
  await render(t, spring);
  await click(trigger());

  const [first, second] = menuItems();
  assert.equal(first?.textContent, "Review 4 changes and publish");
  assert.match(second?.textContent ?? "", /Discard draft…/);
  const beforeSwitch = (menu()?.textContent ?? "").split("Switch to")[0];
  assert.doesNotMatch(beforeSwitch, /Spring campaign/);
});

void test("lists Live with its last publisher and every open regular draft with its creator, age and change count", async (t) => {
  mockApi(t);
  await render(t, null);
  await click(trigger());

  const switchTo = (menu()?.textContent ?? "").split("Switch to")[1] ?? "";
  assert.match(itemNamed(/^Live/)?.textContent ?? "", /Published 2 days ago by Ada/);
  assert.match(itemNamed(/Spring campaign/)?.textContent ?? "", /Rémi · 3 days ago · 4 changes/);
  assert.match(itemNamed(/Ada, Oct 13/)?.textContent ?? "", /Ada · .* · 1 change/);
  assert.doesNotMatch(switchTo, /Development draft/);
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

void test("discards the draft only after a second confirmation, then switches to Live", async (t) => {
  const calls = mockApi(t);
  await render(t, spring);
  await click(trigger());

  await click(itemNamed(/Discard draft…/));
  assert.equal(calls.filter((call) => call.path === "drafts/discard").length, 0);
  const confirm = window.document.querySelector('[role="alertdialog"]');
  await click(confirm?.querySelector('[data-slot="alert-dialog-action"]'));

  assert.deepEqual(
    calls.filter((call) => call.path === "drafts/discard").map((call) => call.draft),
    [spring],
  );
  assert.equal(new URL(window.location.href).searchParams.get(DRAFT_SEARCH_PARAM), null);
});

/** The localhost studio: dev mode, whose API answers for the caller's development draft. */
function devMode(t: test.TestContext) {
  developmentMode = true;
  t.after(() => {
    developmentMode = false;
  });
  const developmentDraft = drafts.find((draft) => draft.kind === "development");
  return mockApi(t, (path) => {
    if (path === "drafts/get") return json(developmentDraft);
    if (path === "drafts/discard") return json({ ended: null });
    return undefined;
  });
}

void test("the localhost studio shows only its development draft, with nothing to switch to", async (t) => {
  const calls = devMode(t);
  await render(t, spring);

  assert.equal(trigger().textContent, "Development draft");
  await click(trigger());

  assert.deepEqual(
    menuItems().map((item) => item.textContent),
    ["Review 2 changes and publish", "Discard draft…"],
  );
  assert.doesNotMatch(menu()?.textContent ?? "", /Switch to|Live|Spring campaign/);
  assert.equal(calls.filter((call) => call.path === "drafts/list").length, 0);
  assert.deepEqual([...new Set(calls.map((call) => call.draft))], [DEVELOPMENT_DRAFT]);
});

void test("the localhost studio stays in its development draft after discarding it", async (t) => {
  const shown = t.mock.method(toast, "success", () => "toast");
  const calls = devMode(t);
  await render(t, null);
  await click(trigger());

  await click(itemNamed(/Discard draft…/));
  const confirm = window.document.querySelector('[role="alertdialog"]');
  await click(confirm?.querySelector('[data-slot="alert-dialog-action"]'));

  assert.deepEqual(
    calls.filter((call) => call.path === "drafts/discard").map((call) => call.draft),
    [DEVELOPMENT_DRAFT],
  );
  assert.equal(new URL(window.location.href).searchParams.has(DRAFT_SEARCH_PARAM), false);
  assert.match(trigger().textContent ?? "", /^Development draft/);
  assert.equal(shown.mock.callCount(), 0);
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
  assert.match(window.document.querySelector('[role="dialog"]')?.textContent ?? "", /Publish all/);
  assert.equal(window.document.querySelector('input[aria-label="Draft name"]'), null);
});

void test("the palette's Discard draft… asks for confirmation without discarding", async (t) => {
  const calls = mockApi(t);
  await render(t, spring);

  await runCommand("Discard draft…");

  const confirm = window.document.querySelector('[role="alertdialog"]');
  assert.match(confirm?.textContent ?? "", /Discard this draft\?/);
  assert.equal(calls.filter((call) => call.path === "drafts/discard").length, 0);
});

void test("the palette's Rename draft… opens the review with the draft's name being edited", async (t) => {
  mockApi(t);
  await render(t, spring);

  await runCommand("Rename draft…");

  assert.equal(nameInput()?.value, "Spring campaign");
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
    "Discard draft…",
    "Rename draft…",
    "Switch to Live",
    "Switch to draft…",
  ]);
});

void test("on Live, the palette's Switch to draft… lists every regular draft, not the development draft", async (t) => {
  mockApi(t);
  await render(t, null);

  await runCommand("Switch to draft…");

  assert.deepEqual(paletteLabels(), ['Switch to "Spring campaign"', 'Switch to "Ada, Oct 13"']);
});

void test("the palette hides Switch to draft… when no other draft is open", async (t) => {
  mockApi(t, (path) =>
    path === "drafts/list" ? json({ ...list, drafts: [drafts[0], drafts[2]] }) : undefined,
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

void test("the localhost studio's palette offers its development draft's review and discard, without switching", async (t) => {
  devMode(t);
  await render(t, null);
  await openPalette();

  assert.deepEqual(draftsCommands(), ["Review and publish", "Discard draft…"]);
});
