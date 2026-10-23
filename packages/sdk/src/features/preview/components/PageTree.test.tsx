import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test, type TestContext } from "node:test";

import { QueryClient } from "@tanstack/react-query";
import { Window } from "happy-dom";
import * as React from "react";
import { act } from "react";

import { StudioQueryClientProvider, testStudioCache } from "../../../lib/draft-scope.fixtures";
import { reads } from "../../../lib/studio-reads";

Object.assign(globalThis, { React });

// Render the real page tree over seeded block reads. The previewed page is stubbed, since the
// real hook reads it from the studio's location.
registerHooks({
  resolve(specifier, context, nextResolve) {
    let source: string | undefined;
    if (specifier === "@camox/ui/toaster") source = "export const toast = () => {}";
    if (context.parentURL?.endsWith("/PageTree.tsx")) {
      if (specifier === "../CamoxPreview")
        source = "export const usePreviewedPage = () => globalThis.testPreviewedPage";
      // Block actions reach the Canvas, which only loads in the studio's bundle, and reordering
      // reads the studio's location.
      if (specifier === "./BlockActionsPopover")
        source = "export const BlockActionsPopover = ({ children }) => children";
      if (specifier === "./useUpdateBlockPosition")
        source = "export const useUpdateBlockPosition = () => ({ mutate: () => {} })";
    }
    if (source)
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

type SeededBlock = { id: string; type: string; summary: string; title: string };

/** A block definition as the API lists it, synced from the website's code. */
const definition = (blockId: string, title: string) => ({
  blockId,
  title,
  description: "Page tree fixture",
  contentSchema: { type: "object", properties: { text: { type: "string", fieldType: "String" } } },
  settingsSchema: null,
  defaultContent: { text: "" },
  defaultSettings: {},
  layoutOnly: null,
  synced: false,
});

/**
 * Renders the page tree over seeded block reads and the block definitions the API lists, with
 * no code registry. The layout places `before` and `after` around the page's blocks.
 */
async function renderPageTree(
  t: TestContext,
  seeded: SeededBlock[],
  {
    definitions = [],
    layout,
  }: {
    definitions?: ReturnType<typeof definition>[];
    layout?: { before: SeededBlock[]; after: SeededBlock[] };
  } = {},
) {
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
  const { PageTree } = await import("./PageTree");
  const { PreviewEditingOwnerContext } = await import("../previewSelection");
  const { AuthContext, createCamoxAuthClient } = await import("@/lib/auth");
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const cache = testStudioCache(client);
  cache.set(reads.project({ projectUuid: "site" }), { id: 1 });
  cache.set(reads.blockDefinitionList({ projectId: 1 }), definitions);
  const placed = [
    ...(layout?.before ?? []).map((block) => ({ block, owner: { layoutId: "default" } })),
    ...seeded.map((block) => ({ block, owner: { pageId: "page" } })),
    ...(layout?.after ?? []).map((block) => ({ block, owner: { layoutId: "default" } })),
  ];
  placed.forEach(({ block, owner }, index) => {
    cache.set(reads.blockBundle(block.id), {
      block: {
        ...block,
        ...owner,
        position: `a${index}`,
        content: { text: "" },
        settings: {},
        references: {},
      },
      repeatableItems: [],
      files: [],
    } as never);
  });
  Object.assign(globalThis, {
    testPreviewedPage: {
      page: { id: "page", blockIds: seeded.map((block) => block.id) },
      layout: layout
        ? {
            layoutId: "default",
            beforeBlockIds: layout.before.map((block) => block.id),
            afterBlockIds: layout.after.map((block) => block.id),
          }
        : null,
    },
  });

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
          <PreviewEditingOwnerContext.Provider value={{ kind: "page", pageId: "page" } as never}>
            <PageTree />
          </PreviewEditingOwnerContext.Provider>
        </AuthContext.Provider>
      </StudioQueryClientProvider>,
    );
  });

  t.after(async () => {
    await act(async () => root.unmount());
    host.remove();
    client.clear();
    await window.happyDOM.close();
  });

  return {
    /** The names the tree shows its blocks by, in order. */
    rows: () =>
      [...host.querySelectorAll<HTMLElement>("button[title]")].map((row) => row.textContent),
  };
}

void test("the page tree names each block by its Summary, else its title, else its type", async (t) => {
  const tree = await renderPageTree(t, [
    { id: "hero", type: "hero", summary: "Welcome banner", title: "Ship faster" },
    { id: "faq", type: "faq", summary: "", title: "Shipping questions" },
    { id: "plain", type: "plain", summary: "", title: "" },
  ]);

  assert.deepEqual(tree.rows(), ["Welcome banner", "Shipping questions", "plain"]);
});

void test("the page tree names its layout's blocks by their definitions' titles, which the API lists", async (t) => {
  const tree = await renderPageTree(
    t,
    [{ id: "hero", type: "hero", summary: "Welcome banner", title: "" }],
    {
      definitions: [definition("navbar", "Navigation bar"), definition("hero", "Hero")],
      layout: {
        before: [{ id: "nav", type: "navbar", summary: "", title: "" }],
        // A block whose definition the draft doesn't have is named by its type.
        after: [{ id: "foot", type: "footer", summary: "", title: "" }],
      },
    },
  );

  assert.deepEqual(tree.rows(), ["Navigation bar", "Welcome banner", "footer"]);
});
