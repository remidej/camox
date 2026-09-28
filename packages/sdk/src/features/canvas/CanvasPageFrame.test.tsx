import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Window } from "happy-dom";
import * as React from "react";

import type { PageRenderInput } from "../runtime/runtime";

// Exercise the real frame/portal and selection context without loading the RPC
// editors. The content probe checks which query cache and owner the frame supplies.
registerHooks({
  resolve(specifier, context, nextResolve) {
    let source: string | undefined;
    if (specifier === "@camox/ui/toaster") source = "export const toast = () => {}";
    if (context.parentURL?.endsWith("/CanvasPageFrame.tsx")) {
      if (specifier.endsWith("/CamoxAppContext")) source = "export const useCamoxApp = () => ({})";
      for (const name of ["EditablePageContent", "DerivedPageContent"]) {
        if (specifier.endsWith(`/${name}`))
          source = `export const ${name} = () => React.createElement(globalThis.CanvasContentProbe)`;
      }
      if (specifier.endsWith("/PreviewPanel"))
        source = "export const PreviewFrameEffects = () => null";
      if (specifier.endsWith("/Overlays")) source = "export const Overlays = () => null";
    }
    if (source)
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

void test("canvas frames share the studio cache, activate their own owner, and forward scaled wheel input", async () => {
  const dom = new Window({ url: "http://localhost/camox/canvas" });
  const frame = new Window();
  // happy-dom's WheelEvent lacks MouseEvent coordinates and modifier keys.
  class TestWheelEvent extends dom.MouseEvent {
    constructor(type: string, init: WheelEventInit) {
      super(type, {
        bubbles: init.bubbles,
        cancelable: init.cancelable,
        clientX: init.clientX,
        clientY: init.clientY,
        ctrlKey: init.ctrlKey,
        metaKey: init.metaKey,
        shiftKey: init.shiftKey,
      });
      Object.assign(this, {
        deltaX: init.deltaX ?? 0,
        deltaY: init.deltaY ?? 0,
        deltaMode: init.deltaMode ?? 0,
      });
    }
  }
  const globals = {
    React,
    window: dom,
    document: dom.document,
    DOMParser: dom.DOMParser,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    WheelEvent: TestWheelEvent,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    IS_REACT_ACT_ENVIRONMENT: true,
    CanvasContentProbe: ContentProbe,
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  const { createRoot } = await import("react-dom/client");
  const { CanvasPageFrame } = await import("./CanvasPageFrame");
  const { usePreviewSelection } = await import("../preview/previewSelection");
  const { previewStore } = await import("../preview/previewStore");
  const client = new QueryClient();
  const clients: QueryClient[] = [];
  function ContentProbe() {
    clients.push(useQueryClient());
    const select = usePreviewSelection();
    return <button onClick={() => select({ type: "block", blockId: 42 })}>Select block</button>;
  }
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const activated: unknown[] = [];
  const input = {
    pathname: "/about",
    href: "http://localhost/about",
    runtimeBasePath: "",
    source: "draft",
    previewDocument: "<html><head></head><body><div data-camox-preview-root></div></body></html>",
    dehydratedState: { queries: [], mutations: [] },
  } as unknown as PageRenderInput;
  previewStore.send({ type: "enterEditMode" });
  try {
    await React.act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <CanvasPageFrame
            input={input}
            pageId={7}
            width={1000}
            viewportHeight={800}
            onActivate={(owner) => activated.push(owner)}
          />
        </QueryClientProvider>,
      );
    });
    const iframe = host.querySelector("iframe")!;
    assert.equal(iframe.inert, false);
    assert.equal(iframe.hasAttribute("aria-hidden"), false);
    assert.equal(iframe.style.pointerEvents, "");
    frame.document.body.innerHTML = "<div data-camox-preview-root></div>";
    Object.defineProperty(iframe, "contentDocument", { value: frame.document });
    Object.defineProperty(iframe, "offsetWidth", { value: 1000 });
    iframe.getBoundingClientRect = () => new dom.DOMRect(50, 80, 500, 400);
    await React.act(async () => iframe.dispatchEvent(new dom.Event("load")));
    assert.ok(clients.length);
    assert.ok(
      clients.every((value) => value === client),
      "edits must reach the studio cache",
    );
    const button = frame.document.querySelector("button")!;
    await React.act(async () => {
      button.dispatchEvent(new frame.PointerEvent("pointerdown", { bubbles: true }));
      button.click();
    });
    assert.deepEqual(activated, [{ kind: "page", pageId: 7 }]);
    assert.deepEqual(previewStore.getSnapshot().context.editingContext, {
      kind: "page",
      pageId: 7,
      selection: { type: "block", blockId: 42 },
    });
    assert.equal(previewStore.getSnapshot().context.iframeElement, iframe);
    let forwarded: unknown;
    host.addEventListener("wheel", (event) => {
      const wheel = event as unknown as WheelEvent;
      forwarded = [wheel.clientX, wheel.clientY, wheel.deltaY, wheel.ctrlKey];
    });
    const wheel = new TestWheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: 200,
      clientY: 300,
      deltaY: -20,
      ctrlKey: true,
    });
    button.dispatchEvent(wheel);
    assert.equal(wheel.defaultPrevented, true);
    assert.deepEqual(forwarded, [150, 230, -20, true]);
  } finally {
    await React.act(async () => root.unmount());
    assert.equal(previewStore.getSnapshot().context.iframeElement, null);
    await frame.happyDOM.close();
    client.clear();
    previewStore.send({ type: "activatePage", pageId: null });
    previewStore.send({ type: "setIframeElement", element: null });
    previewStore.send({ type: "exitEditMode" });
    await dom.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
