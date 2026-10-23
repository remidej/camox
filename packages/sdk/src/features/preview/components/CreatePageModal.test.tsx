import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test, type TestContext } from "node:test";

import { QueryClient } from "@tanstack/react-query";
import { Window } from "happy-dom";
import * as React from "react";
import { act } from "react";

import { initApiClient } from "@/lib/api-client";

import {
  StudioQueryClientProvider,
  testDraftScope,
  testStudioCache,
} from "../../../lib/draft-scope.fixtures";
import { reads } from "../../../lib/studio-reads";

// The create-page modal over the layouts the API lists, with no code registry. Navigation reads
// the studio's location, so it is stubbed.
registerHooks({
  resolve(specifier, context, nextResolve) {
    let source: string | undefined;
    if (specifier === "@camox/ui/toaster") source = "export const toast = () => {}";
    if (context.parentURL?.endsWith("/CreatePageModal.tsx")) {
      if (specifier === "@/features/navigation/navigation")
        source = "export const useNavigate = () => () => {}";
      if (specifier === "@/lib/view-locale")
        source = "export const useLocalizedPath = () => (path) => path";
    }
    if (source)
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

Object.assign(globalThis, { React, __CAMOX_TELEMETRY_DISABLED__: true });
initApiClient("http://localhost:8788", testDraftScope());

type LayoutRow = { layoutId: string; title: string | null; kind: string };

async function renderModal(t: TestContext, layouts: LayoutRow[]) {
  const window = new Window({ url: "http://localhost/" });
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    MutationObserver: window.MutationObserver,
    getComputedStyle: window.getComputedStyle.bind(window),
    ResizeObserver: window.ResizeObserver,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    localStorage: window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { createRoot } = await import("react-dom/client");
  const { CreatePageModal } = await import("./CreatePageModal");
  const { previewStore } = await import("../previewStore");
  const { AuthContext, createCamoxAuthClient } = await import("@/lib/auth");

  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const cache = testStudioCache(client);
  cache.set(reads.project({ projectUuid: "site" }), { id: 1 });
  cache.set(reads.pageList({ projectUuid: "site" }), []);
  cache.set(reads.layoutList({ projectId: 1 }), layouts);
  previewStore.send({ type: "openCreatePageModal" });

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <StudioQueryClientProvider client={client}>
        <AuthContext.Provider
          value={{
            projectUuid: "site",
            apiUrl: "http://localhost:8788",
            authenticationUrl: "http://localhost:3290",
            authClient: createCamoxAuthClient("http://localhost:8788"),
          }}
        >
          <CreatePageModal />
        </AuthContext.Provider>
      </StudioQueryClientProvider>,
    );
  });
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

  t.after(async () => {
    await act(async () => root.unmount());
    host.remove();
    client.clear();
    previewStore.send({ type: "closeCreatePageModal" });
    await window.happyDOM.close();
  });

  return {
    /** The layout the new page gets, as the layout picker names it. */
    chosenLayout: () =>
      document
        .querySelector('label[for="layoutId"]')
        ?.parentElement?.querySelector('[data-slot="select-value"]')?.textContent,
  };
}

void test("a new page gets the first curated layout the API lists, named by its title", async (t) => {
  const modal = await renderModal(t, [
    { layoutId: "pokedex", title: "Pokédex", kind: "singleton" },
    { layoutId: "default", title: "Marketing page", kind: "curated" },
    { layoutId: "blog", title: "Blog", kind: "curated" },
  ]);

  assert.equal(modal.chosenLayout(), "Marketing page");
});

void test("a layout synced without a title is named by its id", async (t) => {
  const modal = await renderModal(t, [{ layoutId: "default", title: null, kind: "curated" }]);

  assert.equal(modal.chosenLayout(), "default");
});
