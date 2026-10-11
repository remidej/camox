import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import * as React from "react";

import type { Block } from "../../core/createBlock";

// Render the real frame and block, signed in, without the Camox provider.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith("/BlockErrorBoundary.tsx") && specifier.endsWith("/auth")) {
      const source = "export const useIsAuthenticated = () => true";
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

type ObserverEntry = { isIntersecting: boolean };
type Observer = {
  callback: (entries: ObserverEntry[]) => void;
  options: IntersectionObserverInit | undefined;
  disconnected: boolean;
};

void test("Block Catalog frames mount near the viewport and render a live, non-editable block", async () => {
  const dom = new Window({ url: "http://localhost/about" });
  const frame = new Window({ url: "http://localhost/" });
  const observers: Observer[] = [];
  class TestIntersectionObserver {
    observer: Observer;
    constructor(callback: Observer["callback"], options?: IntersectionObserverInit) {
      this.observer = { callback, options, disconnected: false };
      observers.push(this.observer);
    }
    observe() {}
    disconnect() {
      this.observer.disconnected = true;
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
    IntersectionObserver: TestIntersectionObserver,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  const { createRoot } = await import("react-dom/client");
  const { createBlock } = await import("../../core/createBlock");
  const { BlockEditingRuntimeProvider } = await import("../../core/editing/BlockEditingRuntime");
  const { PreviewDocumentContext } = await import("../runtime/PreviewDocumentContext");
  const { previewStore } = await import("../preview/previewStore");
  const { CanvasBlockFrame } = await import("./CanvasBlockFrame");

  const block = createBlock({
    id: "tabs",
    title: "Tabs",
    description: "Tabbed content",
    content: (field) => ({ heading: field.string({ default: "Default heading" }) }),
    component: function Tabs({ content }) {
      const [tab, setTab] = React.useState("First tab");
      return (
        <div>
          <h3>{content.heading}</h3>
          <button onClick={() => setTab("Second tab")}>Show second tab</button>
          <p data-tab>{tab}</p>
          <a href="/elsewhere">Elsewhere</a>
        </div>
      );
    },
    toMarkdown: (content) => [content.heading],
  });
  // The Canvas runs inside the editing runtime; catalog blocks must not use it.
  const editingRenders: unknown[] = [];
  const editingRuntime = {
    useSetting: () => undefined,
    renderBlock: (_options: object, props: object) => {
      editingRenders.push(props);
      return <div>Editable block</div>;
    },
    renderPrimitive: () => null,
  };
  const siteDocument =
    '<!doctype html><html><head><style>.site { color: red; }</style><script>window.boot = true</script></head><body><div id="root" data-camox-preview-root>Server HTML</div></body></html>';
  const client = new QueryClient();
  const canvas = dom.document.createElement("div");
  canvas.setAttribute("data-camox-canvas", "");
  const host = dom.document.createElement("div");
  canvas.append(host);
  dom.document.body.append(canvas);
  const root = createRoot(host as unknown as HTMLElement);
  previewStore.send({ type: "enterEditMode" });
  try {
    await React.act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <BlockEditingRuntimeProvider runtime={editingRuntime}>
            <PreviewDocumentContext.Provider value={siteDocument}>
              <CanvasBlockFrame
                block={block as unknown as Block}
                runtimeBasePath=""
                width={1000}
                viewportHeight={800}
              />
            </PreviewDocumentContext.Provider>
          </BlockEditingRuntimeProvider>
        </QueryClientProvider>,
      );
    });
    assert.equal(
      host.querySelector("iframe"),
      null,
      "frames wait until they are near the viewport",
    );
    const [observer] = observers;
    assert.ok(observer);
    assert.equal(observer.options?.root, canvas, "nearness is measured against the Canvas");
    assert.ok(observer.options?.rootMargin, "frames mount ahead of entering the viewport");
    await React.act(async () => observer.callback([{ isIntersecting: false }]));
    assert.equal(host.querySelector("iframe"), null);
    await React.act(async () => observer.callback([{ isIntersecting: true }]));
    const iframe = host.querySelector("iframe")!;
    assert.ok(iframe, "frames mount once near the viewport");

    const srcDoc = iframe.getAttribute("srcdoc") ?? "";
    assert.match(srcDoc, /\.site \{ color: red; \}/, "frames keep the site head");
    assert.doesNotMatch(srcDoc, /window\.boot/, "frames never run site scripts");
    assert.doesNotMatch(srcDoc, /Server HTML/, "frames render only the block");

    frame.document.body.innerHTML = "<div data-camox-preview-root></div>";
    const previewRoot = frame.document.querySelector("[data-camox-preview-root]")!;
    previewRoot.getBoundingClientRect = () => new frame.DOMRect(0, 0, 1000, 320);
    Object.defineProperty(iframe, "contentDocument", { value: frame.document });
    await React.act(async () => iframe.dispatchEvent(new dom.Event("load")));
    assert.match(frame.document.body.textContent, /Default heading/, "blocks show default content");
    assert.deepEqual(editingRenders, [], "blocks render through the non-editing view path");
    assert.equal(
      frame.document.documentElement.style.getPropertyValue("--camox-viewport-height"),
      "800px",
      "viewport heights match Page frames",
    );
    assert.equal(iframe.style.height, "320px", "frames are their block's natural height");

    const tabButton = frame.document.querySelector("button")!;
    await React.act(async () => {
      tabButton.dispatchEvent(new frame.PointerEvent("pointerdown", { bubbles: true }));
      tabButton.click();
    });
    assert.equal(frame.document.querySelector("[data-tab]")?.textContent, "Second tab");

    const link = frame.document.querySelector("a")!;
    const click = new frame.MouseEvent("click", { bubbles: true, cancelable: true });
    await React.act(async () => link.dispatchEvent(click));
    assert.equal(click.defaultPrevented, true, "links do not navigate");

    const { context } = previewStore.getSnapshot();
    assert.equal(context.iframeElement, null, "block frames never become the preview iframe");
    assert.equal(context.editingContext, null, "interacting activates no editing owner");

    await React.act(async () => observer.callback([{ isIntersecting: false }]));
    assert.equal(host.querySelector("iframe"), iframe, "frames stay mounted after panning away");
    assert.equal(frame.document.querySelector("[data-tab]")?.textContent, "Second tab");
  } finally {
    await React.act(async () => root.unmount());
    client.clear();
    previewStore.send({ type: "exitEditMode" });
    await frame.happyDOM.close();
    await dom.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
