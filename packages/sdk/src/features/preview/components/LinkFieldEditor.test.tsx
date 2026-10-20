import assert from "node:assert/strict";
import { test } from "node:test";

import { LOCALE_HEADER } from "@camox/api-contract/drafts";
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
const { LinkFieldEditor } = await import("./LinkFieldEditor");
const { initApiClient } = await import("@/lib/api-client");
const { AuthContext } = await import("@/lib/auth");
const { createDraftScope } = await import("@/lib/draft-scope");
const { StudioScopeProvider } = await import("@/lib/draft-scope.fixtures");
const { ViewLocaleContext } = await import("@/lib/view-locale-context");
const { CamoxAppProvider } = await import("@/features/provider/components/CamoxAppContext");
const { createApp } = await import("@/core/createApp");

// A link's page keeps its id in every locale (ADR 0015). In a locale missing the page, the link
// leads to the default locale's page, so the picker offers it there too.

const project = { id: 1, slug: "site", name: "Site" };
const en = { tag: "en", isDefault: true };
const de = { tag: "de", isDefault: false };
/** Each locale's pages: German translated the pricing page and left out the team page. */
const pagesIn: Record<string, { id: string; nickname: string; fullPath: string }[]> = {
  en: [
    { id: "pricing", nickname: "Pricing", fullPath: "/pricing" },
    { id: "team", nickname: "Team", fullPath: "/team" },
  ],
  de: [{ id: "pricing", nickname: "Preise", fullPath: "/preise" }],
};

const json = (body: unknown) =>
  new Response(JSON.stringify({ json: body }), {
    headers: { "content-type": "application/json" },
  });

function mockApi(t: test.TestContext) {
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const path = new URL(request.url).pathname.replace(/^\/rpc\//, "");
    const locale = request.headers.get(LOCALE_HEADER) ?? "en";
    if (path === "projects/getBySlug") return json(project);
    if (path === "pages/listBySlug") return json({ pages: pagesIn[locale] ?? [] });
    return json({});
  });
}

async function settle() {
  await React.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}

/** The link field editor for a link to `pageId`, viewed in `locale`. */
async function render(t: test.TestContext, locale: typeof en, pageId: string) {
  mockApi(t);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const draftScope = createDraftScope({ queryClient: client, browser: window as never });
  draftScope.adopt({ locale });
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
              <ViewLocaleContext value={{ locale, locales: [en, de] }}>
                <LinkFieldEditor
                  fieldName="cta"
                  linkValue={{ type: "page", pageId, text: "Go", newTab: false }}
                  onSave={() => {}}
                />
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
  const picker = window.document.querySelector('[role="combobox"]') as unknown as HTMLElement;
  return {
    picked: () => picker.textContent,
    /** The pages the picker offers, as their title and path. */
    async offered() {
      await React.act(async () => {
        picker.click();
        await new Promise((resolve) => setTimeout(resolve, 40));
      });
      return [...window.document.querySelectorAll('[data-slot="command-item"]')].map((item) =>
        [...item.querySelectorAll("span")].map((span) => span.textContent),
      );
    },
  };
}

void test("in another locale, the page picker shows a linked page missing from it and offers the default locale's pages it misses", async (t) => {
  const editor = await render(t, de, "team");
  assert.equal(editor.picked(), "Team");
  assert.deepEqual(await editor.offered(), [
    ["Preise", "/preise"],
    ["Team", "/team"],
  ]);
});

void test("in the default locale, the page picker offers the default locale's pages", async (t) => {
  const editor = await render(t, en, "pricing");
  assert.equal(editor.picked(), "Pricing");
  assert.deepEqual(await editor.offered(), [
    ["Pricing", "/pricing"],
    ["Team", "/team"],
  ]);
});
