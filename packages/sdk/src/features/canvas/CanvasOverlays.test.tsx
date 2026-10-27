import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";

registerHooks({
  resolve(specifier, context, nextResolve) {
    let source: string | undefined;
    if (specifier === "virtual:camox-overlay-css") source = "export default ''";
    if (specifier === "@camox/ui/toaster") source = "export const toast = () => {}";
    if (specifier === "@/hooks/use-page-destinations")
      source =
        "export const usePageDestinations = () => []; export const useLinkDestinations = () => []";
    if (source)
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

void test("outlines and interactive controls live above the frame, not in the page", async () => {
  const host = new Window();
  const page = new Window();
  const globals = {
    React,
    window: host,
    document: host.document,
    HTMLElement: host.HTMLElement,
    Element: host.Element,
    Node: host.Node,
    navigator: host.navigator,
    getComputedStyle: host.getComputedStyle.bind(host),
    requestAnimationFrame: host.requestAnimationFrame.bind(host),
    cancelAnimationFrame: host.cancelAnimationFrame.bind(host),
    ResizeObserver: host.ResizeObserver,
    MutationObserver: host.MutationObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const { createRoot } = await import("react-dom/client");
  const { CanvasOverlays, CanvasOverlaysShownContext } = await import("./CanvasOverlays");
  const { previewStore } = await import("../preview/previewStore");
  const { editingFrameHarness } = await import("../preview/editingFrame.fixtures");
  const studio = await editingFrameHarness(host.document as unknown as Document);
  const target = page.document.createElement("div");
  target.setAttribute("data-camox-block-id", "42");
  target.setAttribute("data-camox-focused", "");
  target.setAttribute(
    "data-camox-block-insertion",
    JSON.stringify({
      position: "a0",
      before: false,
      after: true,
    }),
  );
  target.getBoundingClientRect = () => new page.DOMRect(20, 40, 300, 100);
  target.getClientRects = () =>
    Object.assign([target.getBoundingClientRect()], {
      item: () => target.getBoundingClientRect(),
    });
  page.document.body.append(target);
  const sibling = page.document.createElement("div");
  sibling.setAttribute("data-camox-block-id", "43");
  sibling.setAttribute(
    "data-camox-block-insertion",
    JSON.stringify({
      position: "a1",
      before: true,
      after: true,
    }),
  );
  sibling.getBoundingClientRect = () => new page.DOMRect(20, 140, 300, 100);
  page.document.body.append(sibling);
  const root = createRoot(host.document.body as unknown as HTMLElement);
  let activations = 0;
  const requests: unknown[] = [];
  host.parent!.postMessage = (message: unknown) => requests.push({ message, activations });
  const overlays = (shown: boolean) => (
    <CanvasOverlaysShownContext value={shown}>
      <CanvasOverlays
        document={page.document as unknown as Document}
        activate={() => activations++}
        canAddBlocks
      >
        <iframe title="page" />
      </CanvasOverlays>
    </CanvasOverlaysShownContext>
  );
  previewStore.send({ type: "showCanvas" });
  try {
    await React.act(async () => {
      root.render(overlays(true));
      await page.happyDOM.waitUntilComplete();
    });
    assert.equal(page.document.querySelector("button"), null);
    assert.equal(page.document.querySelector(".camox-canvas-outline"), null);
    const layer = host.document.querySelector("[data-canvas-overlays]")!;
    assert.ok(layer.querySelector(".camox-canvas-outline"));
    assert.equal(layer.querySelectorAll("[data-canvas-insertion-seam]").length, 2);
    assert.ok(layer.querySelector("[data-canvas-insertion-seam='42:43']"));
    const button = layer.querySelector("button")!;
    await React.act(async () => {
      button.click();
    });
    assert.equal(activations, 1);
    assert.deepEqual(requests, [
      {
        activations: 1,
        message: { type: "CAMOX_ADD_BLOCK_REQUEST", blockPosition: "a0", insertPosition: "after" },
      },
    ]);
    await React.act(async () => {
      target.removeAttribute("data-camox-focused");
      await page.happyDOM.waitUntilComplete();
    });
    assert.equal(layer.querySelector(".camox-canvas-outline"), null);
    assert.equal(
      layer.querySelectorAll("button").length,
      2,
      "seams do not depend on block hover or selection",
    );
    await React.act(async () => {
      root.render(overlays(false));
    });
    assert.equal(
      (layer as unknown as HTMLElement).style.display,
      "none",
      "without a selection, the Canvas shows no overlays",
    );
    await React.act(async () => previewStore.send({ type: "hideCanvas" }));
    assert.equal(layer.querySelector("button"), null);
    assert.equal((layer as unknown as HTMLElement).style.display, "none");

    // Derived/layout-owned pages do not offer page insertion.
    await React.act(async () => {
      previewStore.send({ type: "showCanvas" });
      root.render(
        <CanvasOverlaysShownContext value={true}>
          <CanvasOverlays document={page.document as unknown as Document} activate={() => {}}>
            <iframe title="layout" />
          </CanvasOverlays>
        </CanvasOverlaysShownContext>,
      );
    });
    assert.equal(host.document.querySelector("button"), null);

    // The selected frame owns its text toolbar, in the same unscaled overlay layer.
    await studio.claimElsewhere(null, page.document as unknown as Document);
    assert.equal(layer.querySelector("[data-canvas-page-outline]"), null);
    await React.act(async () => {
      previewStore.send({ type: "setFocusedBlock", kind: "page", pageId: "7", blockId: "42" });
    });
    assert.equal(layer.querySelector("[data-canvas-page-outline]"), null);
    await React.act(async () => {
      page.dispatchEvent(new page.MessageEvent("message", { data: { type: "CAMOX_HOVER_PAGE" } }));
    });
    assert.ok(layer.querySelector("[data-canvas-page-outline]"));
    assert.equal(
      layer
        .querySelector("[data-canvas-page-outline]")!
        .hasAttribute("data-camox-highlight-focused"),
      false,
    );
    await React.act(async () => {
      page.dispatchEvent(
        new page.MessageEvent("message", { data: { type: "CAMOX_HOVER_PAGE_END" } }),
      );
    });
    assert.equal(layer.querySelector("[data-canvas-page-outline]"), null);
    await React.act(async () => previewStore.send({ type: "clearSelection" }));
    assert.equal(layer.querySelector("[data-canvas-page-outline]"), null);
    const text = page.document.createElement("span");
    text.contentEditable = "true";
    text.textContent = "Selected text";
    page.document.body.append(text);
    const range = page.document.createRange();
    range.selectNodeContents(text);
    range.getBoundingClientRect = () => new page.DOMRect(20, 80, 120, 24);
    const selection = page.document.getSelection()!;
    await React.act(async () => {
      selection.addRange(range);
    });
    assert.equal(selection.getRangeAt(0), range, "selection retains the measured range");
    const selectionMessage = {
      type: "CAMOX_TEXT_SELECTION_STATE",
      hasSelection: true,
      activeFormats: 1,
      linkTarget: null,
      selectedText: "Selected text",
    };
    await React.act(async () => {
      host.dispatchEvent(new host.MessageEvent("message", { data: selectionMessage }));
    });
    assert.equal(host.document.querySelector("[role=toolbar]"), null);
    await React.act(async () => {
      page.dispatchEvent(new page.MessageEvent("message", { data: selectionMessage }));
    });
    const toolbar = host.document.querySelector("[role=toolbar]")!;
    assert.ok(toolbar);
    assert.ok(toolbar.closest("[data-canvas-overlays]"));
    assert.equal(page.document.querySelector("[role=toolbar]"), null);
    assert.ok(toolbar.hasAttribute("data-canvas-overlay-control"));
    const bold = toolbar.querySelector("[aria-label=Bold]")!;
    const mouseDown = new host.MouseEvent("mousedown", { bubbles: true, cancelable: true });
    bold.dispatchEvent(mouseDown);
    assert.equal(mouseDown.defaultPrevented, true, "formatting must not steal selection focus");

    await React.act(async () => {
      page.dispatchEvent(
        new page.MessageEvent("message", {
          data: {
            type: "CAMOX_OPEN_TEXT_LINK_POPOVER",
            target: "https://example.com",
            text: "Selected text",
          },
        }),
      );
    });
    await React.act(async () => {
      selection.removeAllRanges();
      page.document.dispatchEvent(new page.Event("selectionchange"));
    });
    assert.ok(
      host.document.querySelector("[role=toolbar]"),
      "the toolbar stays anchored while the link popover owns focus",
    );

    // Zooming out of the Canvas lets the frame go, and its toolbar with it.
    await studio.releaseElsewhere();
    assert.equal(host.document.querySelector("[role=toolbar]"), null);
  } finally {
    await React.act(async () => root.unmount());
    await studio.close();
    previewStore.send({ type: "hideCanvas" });
    await page.happyDOM.close();
    await host.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
