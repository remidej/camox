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
  analytics: { ga4: null, posthog: null },
  updatedAt: 1,
};
const en = { tag: "en", isDefault: true };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify({ json: body }), {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * Serves the studio's reads, with `overrides` on the project, and returns the analytics changes the
 * studio asks to save.
 */
function mockApi(t: test.TestContext, overrides: Partial<typeof project> = {}) {
  const analyticsSaves: unknown[] = [];
  const projectUpdates: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (request: Request | URL) => {
    if (request instanceof URL) return Response.json({});
    const path = new URL(request.url).pathname.replace(/^\/rpc\//, "");
    if (path === "projects/updateAnalytics") {
      analyticsSaves.push(((await request.json()) as { json: unknown }).json);
      return json({});
    }
    if (path === "projects/update") {
      projectUpdates.push(((await request.json()) as { json: unknown }).json);
      return json({});
    }
    if (path === "projects/getByUuid") return json({ ...project, ...overrides });
    if (path === "locales/list") return json([en]);
    if (path === "pages/listBySlug") return json({ pages: [] });
    if (path === "drafts/list") return json({ live: null, drafts: [] });
    return json({});
  });
  return { analyticsSaves, projectUpdates };
}

/** Lets the studio work until `check` holds, failing with `message` if it never does. */
async function waitFor(check: () => unknown, message: string) {
  for (let i = 0; i < 200 && !check(); i++) {
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  assert.ok(check(), message);
}

async function click(element: unknown) {
  assert.ok(element, "expected an element to click");
  await React.act(async () => {
    (element as unknown as { click: () => void }).click();
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
  await waitFor(
    () => draftPicker() && localePicker() && (!isSettings || analyticsPart()),
    "the studio never finished loading",
  );
  t.after(async () => {
    await React.act(async () => root.unmount());
    host.remove();
    client.clear();
  });
}

void test("the navbar lists only Website and Content, neither current in the Settings Section", async (t) => {
  mockApi(t);
  await render(t, "/camox/settings");

  assert.deepEqual(
    navbarLinks().map((link) => link.textContent),
    ["Website", "Content"],
  );
  assert.deepEqual(
    navbarLinks().map((link) => link.getAttribute("aria-current")),
    [null, null],
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
    await waitFor(isMenuOpen, `${picker.textContent} opened no menu`);
    await React.act(async () => {
      window.document.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await waitFor(() => !isMenuOpen(), `${picker.textContent}'s menu never closed`);
  }
});

/** The Settings Section's Analytics part. */
const analyticsPart = () =>
  window.document.querySelector('section[aria-labelledby="camox-settings-analytics"]');
const analyticsButton = (name: RegExp) =>
  [...(analyticsPart()?.querySelectorAll("button") ?? [])].find((button) =>
    name.test(button.textContent ?? ""),
  );

void test("with no provider set, the Analytics part offers to add Google Analytics 4 and PostHog", async (t) => {
  mockApi(t);
  await render(t, "/camox/settings");

  assert.ok(analyticsButton(/^Add Google Analytics 4$/), "no button to add Google Analytics 4");
  assert.ok(analyticsButton(/^Add PostHog$/), "no button to add PostHog");
});

async function type(input: HTMLInputElement | null, value: string) {
  assert.ok(input, "expected an input to type in");
  await React.act(async () => {
    // React tracks the value it last rendered, so set the new one through the native setter.
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
  });
}
const inputById = (id: string) =>
  window.document.getElementById(id) as unknown as HTMLInputElement | null;
const measurementIdInput = () => inputById("camox-ga4-measurement-id");

void test("a GA4 measurement ID is saved in upper case", async (t) => {
  const { analyticsSaves } = mockApi(t);
  await render(t, "/camox/settings");

  await click(analyticsButton(/^Add Google Analytics 4$/));
  await waitFor(measurementIdInput, "no measurement ID to fill in");
  await type(measurementIdInput(), " g-a1b2c3 ");
  await click(analyticsButton(/^Save$/));
  await waitFor(() => analyticsSaves.length, "nothing was saved");

  assert.deepEqual(analyticsSaves, [{ id: project.id, ga4: { measurementId: "G-A1B2C3" } }]);
});

void test("a GA4 measurement ID that isn't one is refused before saving", async (t) => {
  const { analyticsSaves } = mockApi(t);
  await render(t, "/camox/settings");

  await click(analyticsButton(/^Add Google Analytics 4$/));
  await waitFor(measurementIdInput, "no measurement ID to fill in");
  await type(measurementIdInput(), "UA-12345");
  await click(analyticsButton(/^Save$/));
  await waitFor(
    () => measurementIdInput()?.getAttribute("aria-invalid") === "true",
    "the measurement ID wasn't refused",
  );

  assert.deepEqual(analyticsSaves, []);
});

void test("a provider being added can be cancelled without saving", async (t) => {
  const { analyticsSaves } = mockApi(t);
  await render(t, "/camox/settings");

  await click(analyticsButton(/^Add PostHog$/));
  await waitFor(() => !analyticsButton(/^Add PostHog$/), "PostHog is still offered to add");
  await click(analyticsButton(/^Cancel$/));

  await waitFor(() => analyticsButton(/^Add PostHog$/), "PostHog isn't offered to add again");
  assert.deepEqual(analyticsSaves, []);
});

void test("the saved providers show in the Analytics part, each removable", async (t) => {
  const { analyticsSaves } = mockApi(t, {
    analytics: {
      ga4: { measurementId: "G-SAVED1" },
      posthog: { projectApiKey: "phc_saved", region: "eu" },
    } as never,
  });
  await render(t, "/camox/settings");

  assert.equal(measurementIdInput()?.value, "G-SAVED1");
  assert.equal(inputById("camox-posthog-project-api-key")?.value, "phc_saved");
  assert.match(analyticsPart()?.textContent ?? "", /EU Cloud/);

  await click(analyticsButton(/^Remove PostHog$/));
  await waitFor(() => analyticsSaves.length, "nothing was saved");
  assert.deepEqual(analyticsSaves, [{ id: project.id, posthog: null }]);
});

const projectNameInput = () => inputById("camox-project-name");
const projectNameSave = () =>
  [
    ...(window.document
      .querySelector('section[aria-labelledby="camox-settings-project-name"]')
      ?.querySelectorAll("button") ?? []),
  ].find((button) => /^Save changes$/.test(button.textContent ?? ""));

void test("a project name is saved without its surrounding spaces", async (t) => {
  const { projectUpdates } = mockApi(t);
  await render(t, "/camox/settings");

  await type(projectNameInput(), "  New name  ");
  await click(projectNameSave());
  await waitFor(() => projectUpdates.length, "nothing was saved");

  assert.deepEqual(projectUpdates, [{ id: project.id, name: "New name" }]);
});

void test("a project name that only differs by surrounding spaces can't be saved", async (t) => {
  mockApi(t);
  await render(t, "/camox/settings");

  await type(projectNameInput(), ` ${project.name} `);

  assert.equal(projectNameSave()?.disabled, true);
});
