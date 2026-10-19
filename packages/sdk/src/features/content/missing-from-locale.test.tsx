import assert from "node:assert/strict";
import { test } from "node:test";

import { LOCALE_HEADER } from "@camox/api-contract/drafts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import * as React from "react";

import type { MissingFromLocale } from "@/lib/queries";

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
const { ContentSidebar } = await import("./components/ContentSidebar");
const { MissingFromLocaleGroup } = await import("./components/MissingFromLocale");
const { initApiClient } = await import("@/lib/api-client");
const { AuthContext } = await import("@/lib/auth");
const { NavigationProvider } = await import("@/features/navigation/navigation");
const { createDraftScope } = await import("@/lib/draft-scope");
const { StudioScopeProvider } = await import("@/lib/draft-scope.fixtures");
const { ViewLocaleContext } = await import("@/lib/view-locale");

const DRAFT = "019a0000-0000-7000-8000-000000000001";
const project = { id: 1, slug: "site", name: "Site" };
const en = { tag: "en", isDefault: true };
const de = { tag: "de", isDefault: false };
const articles = { collectionId: "articles", title: "Articles", description: "", label: "title" };

type Call = { path: string; input: unknown; locale: string | null };

/** An API whose project misses `missing` from German until it's added back. */
function mockApi(
  t: test.TestContext,
  missing: MissingFromLocale = {
    pages: [{ id: "pricing", fullPath: "/pricing", nickname: "Pricing" }],
    records: [{ id: "hello", collectionId: "articles", label: "Hello" }],
  },
) {
  const calls: Call[] = [];
  let current = missing;
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const path = new URL(request.url).pathname.replace(/^\/rpc\//, "");
    const body = request.method === "GET" ? null : ((await request.json()) as { json: unknown });
    calls.push({ path, input: body?.json, locale: request.headers.get(LOCALE_HEADER) });
    const reply = (value: unknown) => Response.json({ json: value });
    if (path === "projects/getBySlug") return reply(project);
    if (path === "locales/listMissing") return reply(current);
    if (path === "locales/addBack") {
      const { id } = body!.json as { id: string };
      current = {
        pages: current.pages.filter((page) => page.id !== id),
        records: current.records.filter((record) => record.id !== id),
      };
      return reply(body!.json);
    }
    return reply({});
  });
  return calls;
}

async function settle() {
  await React.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}

/** The Content Section's sidebar viewing `locale` in a draft, with `collections` shown. */
async function render(
  t: test.TestContext,
  locale: typeof en,
  collections: (typeof articles)[] = [articles],
) {
  window.history.replaceState(null, "", `/?camox-draft=${DRAFT}`);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const draftScope = createDraftScope({ queryClient: client, browser: window as never });
  draftScope.adopt({ draftId: DRAFT, locale });
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
  const pathname = locale.isDefault
    ? "/camox/content/assets"
    : `/${locale.tag}/camox/content/assets`;
  await React.act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <StudioScopeProvider client={client} draftScope={draftScope}>
          <AuthContext.Provider value={auth}>
            <ViewLocaleContext value={{ locale, locales: [en, de] }}>
              <NavigationProvider
                location={{ href: window.location.href, pathname, search: "", hash: "" }}
                navigate={() => {}}
              >
                <ContentSidebar
                  collections={collections}
                  selectedCollectionId={null}
                  collectionsError={false}
                >
                  <MissingFromLocaleGroup collections={collections} />
                </ContentSidebar>
              </NavigationProvider>
            </ViewLocaleContext>
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
  return host;
}

const missingSection = (host: { querySelectorAll: (selector: string) => Iterable<unknown> }) =>
  [...host.querySelectorAll("section")].find((section) =>
    /Missing from/.test((section as { textContent: string }).textContent),
  ) as HTMLElement | undefined;

void test("lists the pages and records missing from the language viewed, records under their collection", async (t) => {
  const calls = mockApi(t);
  const host = await render(t, de);

  const section = missingSection(host);
  assert.ok(section, "expected a list of what's missing");
  assert.match(section.textContent, /Missing from German \(de\)/);
  assert.match(section.textContent, /Pricing.*\/pricing/);
  assert.match(section.textContent, /Articles.*Hello/);
  assert.deepEqual(calls.find(({ path }) => path === "locales/listMissing")?.locale, "de");
});

void test("adding a page back asks the API in the language viewed, and drops it from the list", async (t) => {
  const calls = mockApi(t);
  const host = await render(t, de);

  const button = host.querySelector('button[aria-label="Add Pricing back to German (de)"]');
  assert.ok(button, "expected an action adding the page back");
  await React.act(async () => {
    (button as unknown as { click: () => void }).click();
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  await settle();

  assert.deepEqual(
    calls.filter(({ path }) => path === "locales/addBack"),
    [
      {
        path: "locales/addBack",
        input: { projectId: 1, entity: "page", id: "pricing" },
        locale: "de",
      },
    ],
  );
  const section = missingSection(host);
  assert.ok(section);
  assert.doesNotMatch(section.textContent, /Pricing/);
  assert.match(section.textContent, /Hello/);
});

void test("adding a record back asks the API in the language viewed, and drops it from the list", async (t) => {
  const calls = mockApi(t);
  const host = await render(t, de);

  const button = host.querySelector('button[aria-label="Add Hello back to German (de)"]');
  assert.ok(button, "expected an action adding the record back");
  await React.act(async () => {
    (button as unknown as { click: () => void }).click();
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  await settle();

  assert.deepEqual(
    calls.filter(({ path }) => path === "locales/addBack"),
    [
      {
        path: "locales/addBack",
        input: { projectId: 1, entity: "record", id: "hello" },
        locale: "de",
      },
    ],
  );
  const section = missingSection(host);
  assert.ok(section);
  assert.doesNotMatch(section.textContent, /Hello/);
  assert.match(section.textContent, /Pricing/);
});

void test("shows no records while collections aren't shown", async (t) => {
  mockApi(t, { pages: [], records: [{ id: "hello", collectionId: "articles", label: "Hello" }] });
  const host = await render(t, de, []);

  assert.equal(missingSection(host), undefined);
  assert.doesNotMatch(host.textContent, /Hello/);
});

void test("the default language misses nothing, so it lists nothing and asks for nothing", async (t) => {
  const calls = mockApi(t);
  const host = await render(t, en);

  assert.equal(missingSection(host), undefined);
  assert.equal(calls.filter(({ path }) => path === "locales/listMissing").length, 0);
});
