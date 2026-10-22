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

async function renderPageTree(t: TestContext, seeded: SeededBlock[]) {
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
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { createRoot } = await import("react-dom/client");
  const { PageTree } = await import("./PageTree");
  const { PreviewEditingOwnerContext } = await import("../previewSelection");
  const { CamoxAppProvider } = await import("../../provider/components/CamoxAppContext");
  const { createApp } = await import("../../../core/createApp");
  const { createBlock } = await import("../../../core/createBlock");

  const definitions = [...new Set(seeded.map((block) => block.type))].map((id) =>
    createBlock({
      id,
      title: id,
      description: "Page tree fixture",
      content: (field) => ({ text: field.string({ default: "" }) }),
      toReact: () => null,
      toMarkdown: () => [],
      toTitle: () => "Block",
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  seeded.forEach((block, index) => {
    testStudioCache(client).set(reads.blockBundle(block.id), {
      block: {
        ...block,
        pageId: "page",
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
      layout: null,
    },
  });

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <StudioQueryClientProvider client={client}>
        <CamoxAppProvider app={createApp({ blocks: definitions as never })}>
          <PreviewEditingOwnerContext.Provider value={{ kind: "page", pageId: "page" } as never}>
            <PageTree />
          </PreviewEditingOwnerContext.Provider>
        </CamoxAppProvider>
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
