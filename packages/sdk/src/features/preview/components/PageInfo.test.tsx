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

// The page info over what the API says of the page and its layouts, with no code registry.
// Navigation reads the studio's location, so it is stubbed, and so are relative times, which
// need a `Temporal` this Node lacks.
registerHooks({
  resolve(specifier, context, nextResolve) {
    let source: string | undefined;
    if (specifier === "@camox/ui/toaster") source = "export const toast = () => {}";
    if (context.parentURL?.endsWith("/PageInfo.tsx")) {
      if (specifier === "@/features/navigation/navigation")
        source = "export const useNavigate = () => () => {}";
      if (specifier === "./Metadata")
        source = [
          "export const Metadata = ({ children }) => children",
          "export const MetadataRow = ({ children }) => children",
          "export const formatRelativeTime = () => ''",
        ].join("\n");
    }
    if (source)
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

Object.assign(globalThis, { React, __CAMOX_TELEMETRY_DISABLED__: true });
initApiClient("http://localhost:8788", testDraftScope());

const page = {
  id: "about",
  nickname: "About",
  fullPath: "/about",
  pathSegment: "about",
  parentPageId: null,
  layoutId: "default",
  metaTitle: null,
  metaDescription: null,
  aiSeo: false,
  customOgImageUrl: null,
  createdAt: 0,
  updatedAt: 0,
  createdBy: null,
};

async function renderPageInfo(t: TestContext, part: "info" | "seo") {
  const window = new Window({ url: "http://localhost/about" });
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
  const { PageInfo, PageSeoContent } = await import("./PageInfo");
  const { AuthContext, createCamoxAuthClient } = await import("@/lib/auth");
  const { createRendererHost } = await import("../../renderer/rendererHost");
  const { RendererHostContext } = await import("../../renderer/RendererFrames");
  const { fakeRenderer } = await import("../../renderer/protocol.fixtures");
  t.mock.method(globalThis, "fetch", async () => Response.json({ json: null }));

  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const cache = testStudioCache(client);
  cache.set(reads.project({ projectUuid: "site" }), { id: 1, name: "Acme" } as never);
  cache.set(reads.pageList({ projectUuid: "site" }), [page] as never);
  cache.set(reads.page({ id: "about" }), page as never);
  cache.set(reads.layoutList({ projectId: 1 }), [
    { layoutId: "default", title: "Marketing page", kind: "curated" },
    { layoutId: "blog", title: null, kind: "curated" },
    { layoutId: "pokedex", title: "Pokédex", kind: "singleton" },
  ] as never);
  const rendererHost = createRendererHost();
  const renderer = fakeRenderer(rendererHost.handle);

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
          <RendererHostContext value={rendererHost}>
            {part === "info" ? (
              <PageInfo pageId="about" aboutOnly />
            ) : (
              <PageSeoContent pageId="about" />
            )}
          </RendererHostContext>
        </AuthContext.Provider>
      </StudioQueryClientProvider>,
    );
  });
  const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  for (let i = 0; i < 3; i++) await settle();

  t.after(async () => {
    await act(async () => root.unmount());
    rendererHost.close();
    host.remove();
    client.clear();
    await window.happyDOM.close();
  });
  return { renderer, settle };
}

void test("the page info names the page's layout by the title the API synced", async (t) => {
  await renderPageInfo(t, "info");
  const layout = [...document.querySelectorAll("label")].find(
    (label) => label.textContent === "Layout",
  );
  const select = layout?.closest(".space-y-2")?.querySelector('[data-slot="select-value"]');
  assert.equal(select?.textContent, "Marketing page");
});

void test("the search preview shows the title the renderer's code gives the page", async (t) => {
  const { renderer, settle } = await renderPageInfo(t, "seo");
  const shown = () =>
    [...document.querySelectorAll("p")].find((p) => p.className.includes("text-blue-600"))
      ?.textContent;
  const [asked] = renderer.all("ask");
  assert.deepEqual(
    {
      type: asked?.question.type,
      layoutId: asked?.question.type === "pageTitle" && asked.question.layoutId,
      projectName: asked?.question.type === "pageTitle" && asked.question.projectName,
    },
    { type: "pageTitle", layoutId: "default", projectName: "Acme" },
  );
  renderer.send({ type: "answer", askId: asked!.askId, value: "About · Acme" });
  await settle();
  assert.equal(shown(), "About · Acme");
});
