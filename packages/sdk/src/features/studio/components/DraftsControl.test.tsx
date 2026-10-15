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
const { getDraftRequestHeaders, readDraftFromUrl } = await import("@/lib/studio-draft");

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
  },
  {
    id: adas,
    kind: "regular",
    name: null,
    createdBy: ada,
    createdAt: createdOct13,
    lastChangedAt: createdOct13,
    changeCount: 1,
  },
  {
    id: development,
    kind: "development",
    name: null,
    createdBy: remi,
    createdAt: Date.now(),
    lastChangedAt: null,
    changeCount: 2,
  },
];
const list = { live: { publishedBy: ada, publishedAt: Date.now() - 2 * DAY }, drafts };

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
      return json({ blockers: [], conflicts: [], lost: [], warnings: [], changes: [], token: "t" });
    }
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

async function render(t: test.TestContext, at: string | null) {
  window.history.replaceState(null, "", at ? `/?${DRAFT_SEARCH_PARAM}=${at}` : "/");
  readDraftFromUrl();
  initApiClient("http://api.test");
  const navigations: { to: string; draft?: string | null }[] = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
        <AuthContext.Provider value={auth}>
          <NavigationProvider navigate={(options) => void navigations.push(options)}>
            <DraftsControl />
          </NavigationProvider>
        </AuthContext.Provider>
      </QueryClientProvider>,
    ),
  );
  await settle();
  t.after(async () => {
    await React.act(async () => root.unmount());
    host.remove();
    client.clear();
  });
  return { navigations };
}

void test("on Live, reads Viewing Live and says the first edit starts a draft", async (t) => {
  mockApi(t);
  await render(t, null);

  assert.equal(trigger().textContent, "Viewing Live");
  await click(trigger());

  assert.match(menu()?.textContent ?? "", /Live is read-only/);
  assert.match(menu()?.textContent ?? "", /first edit starts a new draft/);
  assert.equal(itemNamed(/Review and publish/), undefined);
});

void test("in a draft, reads its label and the change count its publish preview lists", async (t) => {
  mockApi(t);
  await render(t, spring);

  assert.equal(trigger().textContent, "Spring campaign · 4 changes");
});

void test("labels an unnamed draft with its creator and creation date", async (t) => {
  mockApi(t);
  await render(t, adas);

  assert.equal(trigger().textContent, "Ada, Oct 13 · 1 change");
});

void test("in a draft, the menu starts with Review and publish and Discard draft, without repeating the name", async (t) => {
  mockApi(t);
  await render(t, spring);
  await click(trigger());

  const [first, second] = menuItems();
  assert.match(first?.textContent ?? "", /Review and publish/);
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

void test("says Started a new draft when the first edit starts one, without asking for a name", async (t) => {
  mockApi(t);
  const shown = t.mock.method(toast, "success", () => "toast");
  await render(t, null);

  await React.act(async () => {
    getDraftRequestHeaders(["blocks", "create"]).settle(true);
  });

  assert.deepEqual(
    shown.mock.calls.map((call) => call.arguments[0]),
    ["Started a new draft"],
  );
  assert.equal(window.document.querySelector("input"), null);
});
