import assert from "node:assert/strict";
import { test } from "node:test";

import { DRAFT_SEARCH_PARAM, LOCALE_HEADER } from "@camox/api-contract/drafts";
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
const { LocalePicker } = await import("./LocalePicker");
const { initApiClient } = await import("@/lib/api-client");
const { AuthContext } = await import("@/lib/auth");
const { NavigationProvider } = await import("@/features/navigation/navigation");
const { createDraftScope } = await import("@/lib/draft-scope");
const { StudioScopeProvider } = await import("@/lib/draft-scope.fixtures");
const { ViewLocaleContext } = await import("@/lib/view-locale-context");
const { CamoxAppProvider } = await import("@/features/provider/components/CamoxAppContext");
const { createApp } = await import("@/core/createApp");
const { parseLocalePath } = await import("@/lib/locale-path");

const project = { id: 1, slug: "site", name: "Site" };
const en = { tag: "en", isDefault: true };
const de = { tag: "de", isDefault: false };
/** Each locale's localizations of the site's pages, sharing their original's id. */
const pagesIn: Record<string, { id: string; nickname: string; fullPath: string }[]> = {
  en: [
    { id: "home", nickname: "Home", fullPath: "/" },
    { id: "pricing", nickname: "Pricing", fullPath: "/pricing" },
  ],
  de: [
    { id: "home", nickname: "Startseite", fullPath: "/" },
    { id: "pricing", nickname: "Preise", fullPath: "/preise" },
  ],
  fr: [
    { id: "home", nickname: "Accueil", fullPath: "/" },
    { id: "pricing", nickname: "Tarifs", fullPath: "/tarifs" },
  ],
};

/** An article's record page in each locale: a derived layout's, found by the record's slug. */
const articlePathIn: Record<string, string> = { en: "/articles/hello", de: "/articles/hallo" };
const article = { layoutId: "articles.$slug", recordId: "article-1", runtimeBasePath: "" };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify({ json: body }), {
    status,
    headers: { "content-type": "application/json" },
  });

type Call = { path: string; input: unknown; draft: string | null };

/** The locales the API says the draft has pending translations into. */
let translatingLocales: string[] = [];

/** An API reading each request's locale, whose project has `locales`. */
function mockApi(t: test.TestContext, locales: { tag: string; isDefault: boolean }[]) {
  const calls: Call[] = [];
  translatingLocales = [];
  t.mock.method(globalThis, "fetch", async (request: Request | URL, init?: RequestInit) => {
    // The runtime's route discovery finds the article's page by its slug in each locale.
    if (request instanceof URL) {
      const locale = new Headers(init?.headers).get(LOCALE_HEADER) ?? "en";
      calls.push({ path: request.pathname, input: locale, draft: null });
      return Response.json({ path: articlePathIn[locale] ?? null });
    }
    const path = new URL(request.url).pathname.replace(/^\/rpc\//, "");
    const body = request.method === "GET" ? null : ((await request.json()) as { json: unknown });
    const input = body?.json as { tag?: string } | undefined;
    calls.push({ path, input, draft: request.headers.get("x-camox-draft") });
    const locale = request.headers.get(LOCALE_HEADER) ?? "en";
    if (path === "projects/getBySlug") return json(project);
    if (path === "locales/list") return json(locales);
    if (path === "pages/listBySlug") return json({ pages: pagesIn[locale] ?? [] });
    if (path === "locales/add") return json({ tag: input?.tag, isDefault: false });
    if (path === "locales/remove") return json({ tag: input?.tag, isDefault: false });
    if (path === "drafts/get") {
      const id = request.headers.get("x-camox-draft");
      return json({ id, kind: "regular", name: null, changeCount: 1, translatingLocales });
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
const menuItems = () =>
  [...window.document.querySelectorAll('[role="menu"] [role^="menuitem"]')].map(
    (item) => item as unknown as HTMLElement,
  );
const itemNamed = (name: RegExp) => menuItems().find((item) => name.test(item.textContent ?? ""));

/**
 * Opens the studio's locale picker at `pathname`, in draft `draft` or on Live, on the record page
 * `recordPage` names, if any.
 */
async function render(
  t: test.TestContext,
  pathname: string,
  locales: { tag: string; isDefault: boolean }[],
  draft: string | null = null,
  recordPage?: typeof article,
) {
  const search = draft ? `?${DRAFT_SEARCH_PARAM}=${draft}` : "";
  window.history.replaceState(null, "", `${pathname}${search}`);
  const navigations: string[] = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = { locale: parseLocalePath(pathname, locales).locale, locales };
  const draftScope = createDraftScope({ queryClient: client, browser: window as never });
  draftScope.adopt({ draftId: draft ?? undefined, locale: view.locale });
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
            <CamoxAppProvider app={createApp({ blocks: [] })}>
              <ViewLocaleContext value={view}>
                <NavigationProvider
                  location={{
                    href: window.location.href,
                    pathname,
                    search,
                    hash: "",
                  }}
                  navigate={(options) => void navigations.push(options.to)}
                >
                  <LocalePicker recordPage={recordPage} />
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
  return { navigations, client };
}

void test("names the locale viewed, and lists the project's locales, the default first", async (t) => {
  mockApi(t, [en, de]);
  await render(t, "/de/preise", [en, de]);

  assert.match(trigger().textContent ?? "", /German \(de\)/);
  await click(trigger());
  assert.deepEqual(
    menuItems().map((item) => item.textContent),
    ["English (en)Default language", "German (de)", "Add language…", "Remove German (de)…"],
  );
});

void test("shows the draft translating while it has pending translations, and clears once they finish", async (t) => {
  mockApi(t, [en, de]);
  translatingLocales = ["de"];
  const { client } = await render(t, "/pricing", [en, de], "d1");

  assert.match(trigger().textContent ?? "", /translating…/i);

  // The jobs finish: the API's realtime invalidation refreshes the draft's summary.
  translatingLocales = [];
  await React.act(() => client.invalidateQueries());
  await settle();
  assert.doesNotMatch(trigger().textContent ?? "", /translating/i);
});

void test("shows nothing translating on Live", async (t) => {
  const calls = mockApi(t, [en, de]);
  translatingLocales = ["de"];
  await render(t, "/pricing", [en, de]);

  assert.doesNotMatch(trigger().textContent ?? "", /translating/i);
  assert.equal(calls.filter((call) => call.path === "drafts/get").length, 0);
});

void test("switching locales keeps the page shown, at its path in the other locale", async (t) => {
  mockApi(t, [en, de]);
  const { navigations } = await render(t, "/pricing", [en, de]);

  await click(trigger());
  await click(itemNamed(/^German/));

  assert.deepEqual(navigations, ["/de/preise"]);
});

void test("switching locales on a record page keeps the record, at its path in the other locale", async (t) => {
  mockApi(t, [en, de]);
  const { navigations } = await render(t, "/articles/hello", [en, de], null, article);

  await click(trigger());
  await click(itemNamed(/^German/));

  assert.deepEqual(navigations, ["/de/articles/hallo"]);
});

void test("the default locale has nothing to remove", async (t) => {
  mockApi(t, [en, de]);
  await render(t, "/pricing", [en, de]);

  await click(trigger());

  assert.equal(itemNamed(/^Remove/), undefined);
});

void test("removes the viewed locale only after a confirmation that its content goes for good once published", async (t) => {
  const calls = mockApi(t, [en, de]);
  const { navigations } = await render(t, "/de/preise", [en, de], "d1");
  await click(trigger());

  await click(itemNamed(/^Remove German/));
  const confirm = window.document.querySelector('[role="alertdialog"]');
  assert.match(confirm?.textContent ?? "", /content will be gone for good/);
  assert.equal(calls.filter((call) => call.path === "locales/remove").length, 0);
  await click(confirm?.querySelector('[data-slot="alert-dialog-action"]'));

  assert.deepEqual(
    calls
      .filter((call) => call.path === "locales/remove")
      .map(({ input, draft }) => ({ input, draft })),
    [{ input: { projectId: 1, tag: "de" }, draft: "d1" }],
  );
  assert.deepEqual(
    navigations,
    ["/pricing?camox-draft=d1"],
    "the studio moves to the default locale, in the draft",
  );
});

void test("adding a locale on Live starts a draft with it, and switches to it on the same page", async (t) => {
  const calls = mockApi(t, [en]);
  const { navigations } = await render(t, "/pricing", [en]);
  await click(trigger());
  await click(itemNamed(/^Add language/));

  const submit = () =>
    window.document.querySelector(
      '[role="dialog"] button[type="submit"]',
    ) as unknown as HTMLButtonElement;
  assert.ok(submit().disabled, "nothing is added before a language is picked");

  const input = window.document.querySelector("#camox-locale-tag") as unknown as HTMLInputElement;
  const search = (text: string) =>
    React.act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!;
      setValue.set!.call(input, text);
      input.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
  const options = () =>
    [...window.document.querySelectorAll('[role="option"]')].map((option) => option.textContent);
  await React.act(async () => {
    input.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }) as unknown as Event,
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  await search("english");
  assert.ok(options().includes("British English (en-GB)"), "the search matches languages by name");
  assert.ok(!options().includes("English (en)"), "the project's languages aren't offered");
  await search("fren");
  await click(
    [...window.document.querySelectorAll('[role="option"]')].find(
      (option) => option.textContent === "French (fr)",
    ),
  );
  await click(submit());

  const added = calls.find((call) => call.path === "locales/add");
  assert.deepEqual(added?.input, { projectId: 1, tag: "fr" });
  assert.ok(added?.draft, "the write names the draft it starts");
  assert.equal(new URL(window.location.href).searchParams.get(DRAFT_SEARCH_PARAM), added.draft);
  assert.deepEqual(navigations, ["/fr/tarifs"]);
});
