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
    if (specifier === "virtual:camox-overlay-css") source = "export default ''";
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
  const { previewCommentsStore } = await import("../preview/previewCommentsStore");
  const client = new QueryClient();
  const clients: QueryClient[] = [];
  function ContentProbe() {
    clients.push(useQueryClient());
    const select = usePreviewSelection();
    return (
      <button onClick={(event) => select({ type: "block", blockId: 42 }, event)}>
        Select block
      </button>
    );
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
  previewStore.send({ type: "setCommentMode", enabled: true });
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
    assert.equal(previewStore.getSnapshot().context.mode, "commenting-draft");
    assert.match(frame.document.head.textContent, /cursor:/);
    assert.equal(
      (host.querySelector("[data-canvas-overlays]") as unknown as HTMLElement).style.display,
      "none",
    );
    await React.act(async () => previewStore.send({ type: "setCommentMode", enabled: false }));
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
    assert.deepEqual(activated, [
      { kind: "page", pageId: 7 },
      { kind: "page", pageId: 7 },
    ]);
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

    // Keyboard/assistive clicks have no preceding pointerdown. Activation must
    // still precede the semantic target handler, even with another page active.
    await React.act(async () => {
      previewStore.send({ type: "activatePage", pageId: 99 });
      previewStore.send({ type: "setIframeElement", element: null });
      previewStore.send({ type: "setCommentMode", enabled: true });
    });
    await React.act(async () => button.click());
    assert.equal(previewStore.getSnapshot().context.iframeElement, iframe);
    assert.deepEqual(previewStore.getSnapshot().context.editingContext, {
      kind: "page",
      pageId: 7,
      selection: { type: "block", blockId: 42 },
    });
    const draft = previewCommentsStore.getSnapshot().context.draft!;
    assert.equal(draft.pageId, 7);
    assert.deepEqual(draft.target, { kind: "block", blockId: 42 });
    assert.equal(
      previewStore.getSnapshot().context.mode,
      "editing-draft",
      "placing a comment retains the existing reveal-in-editor behavior",
    );
  } finally {
    await React.act(async () => root.unmount());
    assert.equal(previewStore.getSnapshot().context.iframeElement, null);
    await frame.happyDOM.close();
    client.clear();
    previewStore.send({ type: "activatePage", pageId: null });
    previewStore.send({ type: "setIframeElement", element: null });
    previewStore.send({ type: "exitEditMode" });
    previewCommentsStore.send({ type: "clearSelection" });
    await dom.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

void test("selected ready frames own editing without a click and follow URL selection only on transitions", async () => {
  const dom = new Window({
    url: "http://localhost/camox/preview/about",
  });
  let resolveContent!: () => void;
  const contentPending = new Promise<void>((resolve) => {
    resolveContent = resolve;
  });
  let resolveOtherContent!: () => void;
  const otherContentPending = new Promise<void>((resolve) => {
    resolveOtherContent = resolve;
  });
  let suspended = true;
  let otherSuspended = true;
  const globals = {
    React,
    window: dom,
    document: dom.document,
    DOMParser: dom.DOMParser,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    IS_REACT_ACT_ENVIRONMENT: true,
    CanvasContentProbe: () => {
      const { pathname } = useLocation();
      if (pathname === "/about" && suspended) throw contentPending;
      if (pathname === "/contact" && otherSuspended) throw otherContentPending;
      return <button>Frame content</button>;
    },
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  const { createRoot } = await import("react-dom/client");
  const { CanvasPageFrame } = await import("./CanvasPageFrame");
  const { previewStore } = await import("../preview/previewStore");
  const { PreviewPreparationContext } = await import("../preview/previewPreparation");
  const { useLocation } = await import("../navigation/navigation");
  const client = new QueryClient();
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const activations: unknown[] = [];
  let readyCount = 0;
  const preparation = {
    ready: () => {
      assert.ok(
        host.querySelector("iframe")?.contentDocument?.querySelector("button"),
        "ready requires committed content in the selected iframe",
      );
      readyCount++;
    },
    fail: (error: Error) => assert.fail(error.message),
  };
  const paths = ["/about", "/contact"];
  function Workspace({ pathname }: { pathname: string }) {
    // Activation updates the parent, giving every frame a new callback. This
    // must not trigger another automatic activation or an update-depth loop.
    const [, setActive] = React.useState<unknown>(null);
    return (
      <PreviewPreparationContext value={preparation}>
        <QueryClientProvider client={client}>
          {paths.map((path, index) => (
            <CanvasPageFrame
              key={path}
              input={
                {
                  pathname: path,
                  href: `http://localhost${path}`,
                  runtimeBasePath: "",
                  source: "draft",
                  previewDocument:
                    "<html><head></head><body><div data-camox-preview-root></div></body></html>",
                  dehydratedState: { queries: [], mutations: [] },
                } as unknown as PageRenderInput
              }
              pageId={index + 1}
              selected={pathname === path}
              width={1000}
              viewportHeight={800}
              onActivate={(owner, source) => {
                activations.push({ owner, source });
                setActive({ owner });
              }}
            />
          ))}
        </QueryClientProvider>
      </PreviewPreparationContext>
    );
  }
  previewStore.send({ type: "enterEditMode" });
  try {
    await React.act(async () => root.render(<Workspace pathname="/about" />));
    const iframes = [...host.querySelectorAll("iframe")];
    assert.equal(readyCount, 0, "iframe onLoad and mount readiness are not content readiness");
    assert.match(iframes[0]!.contentDocument!.body.textContent, /Loading page/);
    await React.act(async () => {
      suspended = false;
      resolveContent();
      await contentPending;
    });
    assert.equal(readyCount, 1, "selected readiness does not wait for other frames");
    assert.match(iframes[1]!.contentDocument!.body.textContent, /Loading page/);
    await React.act(async () => {
      otherSuspended = false;
      resolveOtherContent();
      await otherContentPending;
    });
    assert.equal(readyCount, 1, "unselected content commit must not signal readiness");
    assert.ok(iframes[0]!.contentDocument!.querySelector("button"), "selected document is ready");
    assert.deepEqual(activations, [{ owner: { kind: "page", pageId: 1 }, source: "selection" }]);
    assert.equal(previewStore.getSnapshot().context.iframeElement, iframes[0]);
    assert.deepEqual(previewStore.getSnapshot().context.editingContext, {
      kind: "page",
      pageId: 1,
      selection: null,
    });

    // Clicking B owns editing immediately, while its navigation is still
    // pending and the URL continues selecting A.
    await React.act(async () => iframes[1]!.contentDocument!.querySelector("button")!.click());
    assert.equal(previewStore.getSnapshot().context.iframeElement, iframes[1]);
    assert.deepEqual(activations[1], { owner: { kind: "page", pageId: 2 }, source: "interaction" });
    await React.act(async () => {
      previewStore.send({ type: "setCommentMode", enabled: true });
      root.render(<Workspace pathname="/about" />);
    });
    assert.equal(activations.length, 2, "old URL selection must not reclaim ownership");
    assert.equal(previewStore.getSnapshot().context.iframeElement, iframes[1]);

    await React.act(async () => root.render(<Workspace pathname="/contact" />));
    assert.deepEqual(activations[2], { owner: { kind: "page", pageId: 2 }, source: "selection" });
    await React.act(async () => root.render(<Workspace pathname="/about" />));
    assert.deepEqual(activations[3], { owner: { kind: "page", pageId: 1 }, source: "selection" });
    assert.equal(previewStore.getSnapshot().context.iframeElement, iframes[0]);
    assert.equal(activations.length, 4);
  } finally {
    await React.act(async () => root.unmount());
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
