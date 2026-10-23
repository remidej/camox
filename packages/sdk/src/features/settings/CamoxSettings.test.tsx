import assert from "node:assert/strict";
import { test } from "node:test";

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
  HTMLInputElement: window.HTMLInputElement,
  NodeFilter: window.NodeFilter,
  Element: window.Element,
  Node: window.Node,
  Event: window.Event,
  Image: window.Image,
  PointerEvent: window.PointerEvent,
  MouseEvent: window.MouseEvent,
  KeyboardEvent: window.KeyboardEvent,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  getComputedStyle: window.getComputedStyle.bind(window),
  matchMedia: window.matchMedia.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  localStorage: window.localStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
  __CAMOX_TELEMETRY_DISABLED__: true,
});
const { createRoot } = await import("react-dom/client");
const { Navbar } = await import("@/features/studio/components/Navbar");
const { CamoxSettings } = await import("./CamoxSettings");
const { initApiClient } = await import("@/lib/api-client");
const { AuthContext } = await import("@/lib/auth");
const { NavigationProvider } = await import("@/features/navigation/navigation");
const { createDraftScope } = await import("@/lib/draft-scope");
const { StudioScopeProvider } = await import("@/lib/draft-scope.fixtures");
const { ViewLocaleContext } = await import("@/lib/view-locale-context");
const { CamoxAppProvider } = await import("@/features/provider/components/CamoxAppContext");
const { createApp } = await import("@/core/createApp");

const project = {
  id: 1,
  uuid: "site",
  slug: "site",
  name: "Site",
  organizationSlug: "team",
  socialProfiles: [],
  updatedAt: 1,
};
const en = { tag: "en", isDefault: true };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify({ json: body }), {
    status,
    headers: { "content-type": "application/json" },
  });

function mockApi(t: test.TestContext) {
  t.mock.method(globalThis, "fetch", async (request: Request | URL) => {
    if (request instanceof URL) return Response.json({});
    const path = new URL(request.url).pathname.replace(/^\/rpc\//, "");
    if (path === "projects/getByUuid") return json(project);
    if (path === "locales/list") return json([en]);
    if (path === "pages/listBySlug") return json({ pages: [] });
    if (path === "drafts/list") return json({ live: null, drafts: [] });
    return json({});
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

/** The navbar's links to the studio's sections, in order. */
const navbarLinks = () =>
  [...window.document.querySelectorAll("nav ul a")].map((link) => link as unknown as HTMLElement);
const triggerNamed = (name: RegExp) =>
  [...window.document.querySelectorAll('[data-slot="dropdown-menu-trigger"]')].find((trigger) =>
    name.test(trigger.textContent ?? ""),
  ) as unknown as HTMLElement | undefined;
const draftPicker = () => triggerNamed(/^Live/);
const localePicker = () => triggerNamed(/English/);
const isMenuOpen = () => !!window.document.querySelector('[role="menu"]');

/** The studio's navbar above the Settings Section, as the studio shows them at `pathname`. */
async function render(t: test.TestContext, pathname: string) {
  window.history.replaceState(null, "", pathname);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = { locale: en, locales: [en] };
  const draftScope = createDraftScope({ queryClient: client, browser: window as never });
  draftScope.adopt({ locale: en });
  initApiClient("http://api.test", draftScope);
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const auth = {
    // Signed out as far as the user button goes: the API serves the studio's reads anyway.
    authClient: {
      $store: {
        atoms: { session: { value: { data: null, isPending: false }, listen: () => () => {} } },
      },
    } as never,
    authenticationUrl: "",
    apiUrl: "http://api.test",
    projectUuid: project.uuid,
  };
  const isSettings = pathname.startsWith("/camox/settings");
  await React.act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <StudioScopeProvider client={client} draftScope={draftScope}>
          <AuthContext.Provider value={auth}>
            <CamoxAppProvider app={createApp({ blocks: [] })}>
              <ViewLocaleContext value={view}>
                <NavigationProvider
                  location={{ href: window.location.href, pathname, search: "", hash: "" }}
                  navigate={() => {}}
                >
                  <Navbar isWebsite={!isSettings} />
                  {isSettings && <CamoxSettings />}
                </NavigationProvider>
              </ViewLocaleContext>
            </CamoxAppProvider>
          </AuthContext.Provider>
        </StudioScopeProvider>
      </QueryClientProvider>,
    ),
  );
  await settle();
  t.after(async () => {
    await React.act(async () => root.unmount());
    host.remove();
    client.clear();
  });
}

void test("the navbar lists Website, Content and Settings, Settings current in the Settings Section", async (t) => {
  mockApi(t);
  await render(t, "/camox/settings");

  assert.deepEqual(
    navbarLinks().map((link) => link.textContent),
    ["Website", "Content", "Settings"],
  );
  assert.deepEqual(
    navbarLinks().map((link) => link.getAttribute("aria-current")),
    [null, null, "page"],
  );
});

void test("the Settings Section warns that changes apply to Live and every draft right away", async (t) => {
  mockApi(t);
  await render(t, "/camox/settings");

  assert.match(
    window.document.querySelector('[role="alert"]')?.textContent ?? "",
    /live website and every draft/,
  );
});

void test("the draft and language pickers show but are disabled in the Settings Section", async (t) => {
  mockApi(t);
  await render(t, "/camox/settings");

  for (const picker of [draftPicker(), localePicker()]) {
    assert.ok(picker, "expected the picker to be rendered");
    await click(picker);
    assert.equal(isMenuOpen(), false, `${picker.textContent} opened a menu`);
  }
});

void test("the draft and language pickers work outside the Settings Section", async (t) => {
  mockApi(t);
  await render(t, "/");

  for (const picker of [draftPicker(), localePicker()]) {
    assert.ok(picker, "expected the picker to be rendered");
    await click(picker);
    assert.ok(isMenuOpen(), `${picker.textContent} opened no menu`);
    await React.act(async () => {
      window.document.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
  }
});
