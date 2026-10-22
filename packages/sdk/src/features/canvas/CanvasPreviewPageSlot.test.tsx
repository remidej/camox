import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";

Object.assign(globalThis, { React });

// The overlays only draw in a real Canvas; the slot's own lifecycle is under test.
registerHooks({
  resolve(specifier, context, nextResolve) {
    let source: string | undefined;
    if (specifier === "virtual:camox-overlay-css") source = "export default ''";
    if (
      context.parentURL?.endsWith("/CanvasPreviewPageSlot.tsx") &&
      specifier === "./CanvasOverlays"
    )
      source = "export const CanvasOverlays = () => null";
    if (source)
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

void test("the selected Page's slot hands its place to the Preview page frame and activates it once", async () => {
  const dom = new Window();
  const globals = {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  const { createRoot } = await import("react-dom/client");
  const { CanvasPreviewPageSlot } = await import("./CanvasPreviewPageSlot");
  const { PreviewPageFrame, PreviewPageFrameContext } = await import("../preview/previewPageFrame");
  const { PreviewPreparationContext } = await import("../preview/previewPreparation");
  const { ViewportContinuityContext, ViewportContinuity } =
    await import("../preview/viewportContinuity");
  const frame = new PreviewPageFrame();
  const continuity = new ViewportContinuity();
  let restores = 0;
  continuity.restoreCanvas = () => {
    restores++;
  };
  const readiness: unknown[] = [];
  const activations: unknown[] = [];
  const host = dom.document.createElement("div");
  host.setAttribute("data-camox-canvas", "");
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  // The Canvas passes new callbacks on every render, as CamoxCanvas does.
  const render = (revealed: boolean, selected = true) =>
    React.act(async () =>
      root.render(
        <PreviewPageFrameContext value={{ frame, revealed }}>
          <ViewportContinuityContext value={continuity}>
            <PreviewPreparationContext
              value={{ ready: (options) => readiness.push(options), fail: () => {} }}
            >
              <CanvasPreviewPageSlot
                pageId="page-1"
                width={1366}
                viewportHeight={768}
                selected={selected}
                hovered={false}
                onActivate={(owner, source) => activations.push([owner, source])}
              />
            </PreviewPreparationContext>
          </ViewportContinuityContext>
        </PreviewPageFrameContext>,
      ),
    );
  const slot = () =>
    host.querySelector("[data-canvas-preview-page-slot]") as unknown as HTMLElement;
  try {
    await render(false);
    assert.equal(frame.getSnapshot().slot?.width, 1366, "the slot hands over its device");
    assert.deepEqual(readiness, [{ restore: false }], "laid out, the Canvas can show");
    assert.equal(restores, 0, "the camera waits for the frame to be measured here");
    assert.equal(activations.length, 0);

    await render(true);
    await React.act(async () => frame.setHeight(2400));
    assert.equal(slot().style.height, "2400px", "the slot takes the frame's height");
    assert.equal(restores, 1, "placed and measured, the handed-over view is restored");
    assert.deepEqual(activations, [[{ kind: "page", pageId: "page-1" }, "selection"]]);

    for (let count = 0; count < 3; count++) await render(true);
    assert.equal(activations.length, 1, "rerenders never take ownership again");
    assert.equal(restores, 1);

    frame.getSnapshot().slot!.onInteract();
    assert.deepEqual(activations.at(-1), [{ kind: "page", pageId: "page-1" }, "interaction"]);

    const placedSlot = slot();
    await render(true, false);
    assert.equal(slot(), placedSlot, "deselected, the Page keeps the frame");
    assert.equal(frame.getSnapshot().slot?.mode, "paused", "and pauses it, like a Canvas frame");
    assert.equal(activations.length, 2, "deselecting never takes ownership");
    await render(true);
    assert.equal(frame.getSnapshot().slot?.mode, "live");
    assert.deepEqual(activations.at(-1), [{ kind: "page", pageId: "page-1" }, "selection"]);

    await React.act(async () => root.unmount());
    assert.equal(frame.getSnapshot().slot, null, "leaving the slot releases the frame");
  } finally {
    host.remove();
    await dom.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

void test("a singleton page's slot activates its layout, which owns its blocks", async () => {
  const dom = new Window();
  const globals = {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  const { createRoot } = await import("react-dom/client");
  const { CanvasPreviewPageSlot } = await import("./CanvasPreviewPageSlot");
  const { PreviewPageFrame, PreviewPageFrameContext } = await import("../preview/previewPageFrame");
  const { PreviewPreparationContext } = await import("../preview/previewPreparation");
  const { ViewportContinuityContext, ViewportContinuity } =
    await import("../preview/viewportContinuity");
  const frame = new PreviewPageFrame();
  const activations: unknown[] = [];
  const host = dom.document.createElement("div");
  host.setAttribute("data-camox-canvas", "");
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  try {
    // A singleton has no page row, and no derived layout either: only its layout.
    await React.act(async () =>
      root.render(
        <PreviewPageFrameContext value={{ frame, revealed: true }}>
          <ViewportContinuityContext value={new ViewportContinuity()}>
            <PreviewPreparationContext value={{ ready: () => {}, fail: () => {} }}>
              <CanvasPreviewPageSlot
                layoutId="about"
                width={1366}
                viewportHeight={768}
                selected
                hovered={false}
                onActivate={(owner, source) => activations.push([owner, source])}
              />
            </PreviewPreparationContext>
          </ViewportContinuityContext>
        </PreviewPageFrameContext>,
      ),
    );
    await React.act(async () => frame.setHeight(2400));
    assert.deepEqual(activations, [[{ kind: "layout", layoutId: "about" }, "selection"]]);
    await React.act(async () => root.unmount());
  } finally {
    host.remove();
    await dom.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
