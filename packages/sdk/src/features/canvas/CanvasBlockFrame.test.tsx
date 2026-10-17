import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { QueryClient } from "@tanstack/react-query";
import { Window } from "happy-dom";
import * as React from "react";

import type { Block } from "../../core/createBlock";
import {
  StudioQueryClientProvider,
  testDraftScope,
  testStudioCache,
} from "../../lib/draft-scope.fixtures";
import { reads } from "../../lib/studio-reads";

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

/** A Canvas in a DOM whose frame nearness the test controls through `observers`. */
function setUpCanvasDom() {
  const dom = new Window({ url: "http://localhost/about" });
  // happy-dom loads srcdoc frames on its own animation frame, then discards
  // their document on removal. Tests load frames themselves.
  Object.assign(dom, { requestAnimationFrame: () => 1 });
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
    __CAMOX_TELEMETRY_DISABLED__: true,
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  const canvas = dom.document.createElement("div");
  canvas.setAttribute("data-camox-canvas", "");
  dom.document.body.append(canvas);
  const restore = async () => {
    await dom.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  };
  return { dom, observers, canvas, restore };
}

void test("Block Catalog frames mount near the viewport and render a live, non-editable block", async () => {
  const { dom, observers, canvas, restore } = setUpCanvasDom();
  const frame = new Window({ url: "http://localhost/" });
  const { createRoot } = await import("react-dom/client");
  const { createBlock } = await import("../../core/createBlock");
  const { BlockEditingRuntimeProvider } = await import("../../core/editing/BlockEditingRuntime");
  const { PreviewDocumentContext } = await import("../runtime/PreviewDocumentContext");
  const { previewStore } = await import("../preview/previewStore");
  const { CanvasBlockFrame } = await import("./CanvasBlockFrame");
  const { editingFrameHarness } = await import("../preview/editingFrame.fixtures");

  let liveEffects = 0;
  const block = createBlock({
    id: "tabs",
    title: "Tabs",
    description: "Tabbed content",
    content: (field) => ({ heading: field.string({ default: "Default heading" }) }),
    component: function Tabs({ content }) {
      const [tab, setTab] = React.useState("First tab");
      React.useEffect(() => {
        liveEffects++;
        return () => {
          liveEffects--;
        };
      }, []);
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
  const siteDocument = (page: string, styles = "<style>.site { color: red; }</style>") =>
    `<!doctype html><html><head><title>${page}</title>${styles}<script>window.boot = true</script></head><body><div id="root" data-camox-preview-root>${page} server HTML</div></body></html>`;
  const client = new QueryClient();
  let selections = 0;
  const host = dom.document.createElement("div");
  canvas.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const studio = await editingFrameHarness(dom.document as unknown as Document);
  const render = (previewDocument: string, selected = false) =>
    React.act(async () => {
      root.render(
        <StudioQueryClientProvider client={client}>
          <BlockEditingRuntimeProvider runtime={editingRuntime}>
            <PreviewDocumentContext.Provider value={previewDocument}>
              <CanvasBlockFrame
                block={block as unknown as Block}
                projectId={1}
                runtimeBasePath=""
                width={1000}
                viewportHeight={800}
                selected={selected}
                onSelect={() => selections++}
              />
            </PreviewDocumentContext.Provider>
          </BlockEditingRuntimeProvider>
        </StudioQueryClientProvider>,
      );
    });
  previewStore.send({ type: "showCanvas" });
  try {
    await render(siteDocument("Home"));
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
    assert.doesNotMatch(srcDoc, /server HTML/, "frames render only the block");

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
    const isPaused = () => frame.document.documentElement.hasAttribute("data-camox-paused");
    assert.equal(isPaused(), true, "a block near the camera is paused until selected");
    await render(siteDocument("Home"), true);
    assert.equal(isPaused(), false, "the selected block is live");
    await render(siteDocument("Home"));

    const tabButton = frame.document.querySelector("button")!;
    await React.act(async () => {
      tabButton.dispatchEvent(new frame.PointerEvent("pointerdown", { bubbles: true }));
      tabButton.click();
    });
    assert.equal(frame.document.querySelector("[data-tab]")?.textContent, "Second tab");
    assert.ok(selections > 0, "interacting with the block selects it");

    const link = frame.document.querySelector("a")!;
    const click = new frame.MouseEvent("click", { bubbles: true, cancelable: true });
    await React.act(async () => link.dispatchEvent(click));
    assert.equal(click.defaultPrevented, true, "links do not navigate");

    const { context } = previewStore.getSnapshot();
    assert.ok(studio.document === null, "block frames never become the editing frame");
    assert.equal(context.editingContext, null, "interacting activates no editing owner");
    const editingAffordances = [
      "[data-canvas-overlays]",
      "[data-canvas-insertion-seam]",
      "[data-camox-block-id]",
      "[data-camox-field-id]",
    ].join(", ");
    assert.equal(
      host.querySelector(editingAffordances),
      null,
      "no overlays, field toolbar or add-block seams around the frame",
    );
    assert.equal(
      frame.document.querySelector(editingAffordances),
      null,
      "no editable fields or blocks in the frame",
    );

    assert.equal(liveEffects, 1);
    let contentHeight = 320;
    previewRoot.getBoundingClientRect = () => new frame.DOMRect(0, 0, 1000, contentHeight);
    // Hidden content has no height of its own.
    contentHeight = 0;
    await React.act(async () => observer.callback([{ isIntersecting: false }]));
    assert.equal(host.querySelector("iframe"), iframe, "frames stay mounted after panning away");
    assert.equal(frame.document.querySelector("[data-tab]")?.textContent, "Second tab");
    const content = previewRoot.firstElementChild as unknown as HTMLElement;
    assert.equal(content.style.display, "none", "away, the block is hidden");
    assert.equal(liveEffects, 0, "and its effects stop");
    assert.equal(iframe.style.height, "320px", "while the frame keeps its size");

    contentHeight = 400;
    await React.act(async () => observer.callback([{ isIntersecting: true }]));
    assert.notEqual(content.style.display, "none", "back near, the block shows again");
    assert.equal(liveEffects, 1);
    assert.equal(frame.document.querySelector("[data-tab]")?.textContent, "Second tab");
    assert.equal(iframe.style.height, "400px", "and the frame follows its size again");

    await render(siteDocument("About"));
    assert.equal(
      host.querySelector("iframe"),
      iframe,
      "navigating to another Page keeps the frame",
    );
    assert.equal(iframe.getAttribute("srcdoc"), srcDoc);
    assert.equal(frame.document.querySelector("[data-tab]")?.textContent, "Second tab");

    await render(siteDocument("About", "<style>.site { color: blue; }</style>"));
    const rebuilt = host.querySelector("iframe")!;
    assert.match(
      rebuilt.getAttribute("srcdoc") ?? "",
      /\.site \{ color: blue; \}/,
      "a change of the site's styles rebuilds the frame",
    );

    // A frame whose document fails throws to its card's error boundary.
    class Boundary extends React.Component<{ children: React.ReactNode }, { error?: Error }> {
      state: { error?: Error } = {};
      static getDerivedStateFromError(error: Error) {
        return { error };
      }
      render() {
        return this.state.error ? (
          <p role="alert">{this.state.error.message}</p>
        ) : (
          this.props.children
        );
      }
    }
    const brokenHost = dom.document.createElement("div");
    canvas.append(brokenHost);
    const brokenRoot = createRoot(brokenHost as unknown as HTMLElement, {
      onCaughtError: () => {},
    });
    try {
      await React.act(async () =>
        brokenRoot.render(
          <StudioQueryClientProvider client={client}>
            <Boundary>
              <PreviewDocumentContext.Provider value={siteDocument("Home")}>
                <CanvasBlockFrame
                  block={block as unknown as Block}
                  projectId={1}
                  runtimeBasePath=""
                  width={1000}
                  viewportHeight={800}
                  selected={false}
                  onSelect={() => {}}
                />
              </PreviewDocumentContext.Provider>
            </Boundary>
          </StudioQueryClientProvider>,
        ),
      );
      await React.act(async () => observers.at(-1)!.callback([{ isIntersecting: true }]));
      const brokenFrame = new Window({ url: "http://localhost/" });
      const brokenIframe = brokenHost.querySelector("iframe")!;
      Object.defineProperty(brokenIframe, "contentDocument", { value: brokenFrame.document });
      await React.act(async () => brokenIframe.dispatchEvent(new dom.Event("load")));
      await brokenFrame.happyDOM.close();
      assert.match(
        brokenHost.querySelector("[role=alert]")?.textContent ?? "",
        /no content root/,
        "a failing frame reaches its card's error boundary",
      );
    } finally {
      await React.act(async () => brokenRoot.unmount());
    }
  } finally {
    await React.act(async () => root.unmount());
    await studio.close();
    client.clear();
    previewStore.send({ type: "hideCanvas" });
    await frame.happyDOM.close();
    await restore();
  }
});

void test("Synced Blocks show the project's shared content in their Block Catalog frame, and defaults without it", async () => {
  const { dom, observers, canvas, restore } = setUpCanvasDom();
  const { createRoot } = await import("react-dom/client");
  const { createBlock } = await import("../../core/createBlock");
  const { BlockEditingRuntimeProvider } = await import("../../core/editing/BlockEditingRuntime");
  const { initApiClient } = await import("../../lib/api-client");
  const { PreviewDocumentContext } = await import("../runtime/PreviewDocumentContext");
  const { previewStore } = await import("../preview/previewStore");
  const { CanvasBlockFrame } = await import("./CanvasBlockFrame");
  initApiClient("https://api.example.test", testDraftScope());

  const projectId = 7;
  const defineBlock = (id: string, synced: boolean) => {
    const block = createBlock({
      id,
      title: id,
      description: `The ${id}`,
      synced,
      content: (field) => ({ title: field.string({ default: `Default ${id} title` }) }),
      settings: (setting) => ({ dark: setting.boolean({ default: false }) }),
      component: function Shelf({ content }) {
        const dark = block.useSetting("dark");
        return (
          <nav data-theme={dark ? "dark" : "light"}>
            <a href="/">{content.title}</a>
          </nav>
        );
      },
      toMarkdown: (content) => [content.title],
    });
    return block as unknown as Block;
  };
  const navbar = defineBlock("navbar", true);
  const footer = defineBlock("footer", true);
  const banner = defineBlock("banner", false);
  const sharedContent = (type: string, title: string) => ({
    block: {
      id: 41,
      pageId: null,
      layoutId: "default",
      type,
      content: { title },
      settings: { dark: true },
      slot: "before",
      summary: title,
      position: "a0",
      createdAt: 0,
      updatedAt: 0,
      references: {},
    },
    repeatableItems: [],
    files: [],
  });
  const client = new QueryClient();
  // The project has shared content for the navbar, none yet for the footer.
  testStudioCache(client).set(
    reads.syncedContent({ projectId, type: "navbar" }),
    sharedContent("navbar", "Shared navbar title") as never,
  );
  testStudioCache(client).set(reads.syncedContent({ projectId, type: "footer" }), null as never);
  // Placements of a block that isn't synced have their own content, never shared.
  testStudioCache(client).set(
    reads.syncedContent({ projectId, type: "banner" }),
    sharedContent("banner", "Placed banner title") as never,
  );
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
    "<!doctype html><html><head><title>Home</title></head><body><div data-camox-preview-root></div></body></html>";
  const roots: Array<ReturnType<typeof createRoot>> = [];
  const frames: Window[] = [];
  /** Mounts a block's catalog frame near the viewport and loads its document. */
  const showFrame = async (block: Block) => {
    const host = dom.document.createElement("div");
    canvas.append(host);
    const root = createRoot(host as unknown as HTMLElement);
    roots.push(root);
    await React.act(async () =>
      root.render(
        <StudioQueryClientProvider client={client}>
          <BlockEditingRuntimeProvider runtime={editingRuntime}>
            <PreviewDocumentContext.Provider value={siteDocument}>
              <CanvasBlockFrame
                block={block}
                projectId={projectId}
                runtimeBasePath=""
                width={1000}
                viewportHeight={800}
                selected={false}
                onSelect={() => {}}
              />
            </PreviewDocumentContext.Provider>
          </BlockEditingRuntimeProvider>
        </StudioQueryClientProvider>,
      ),
    );
    await React.act(async () => observers.at(-1)!.callback([{ isIntersecting: true }]));
    const frame = new Window({ url: "http://localhost/" });
    frames.push(frame);
    frame.document.body.innerHTML = "<div data-camox-preview-root></div>";
    const iframe = host.querySelector("iframe")!;
    Object.defineProperty(iframe, "contentDocument", { value: frame.document });
    await React.act(async () => iframe.dispatchEvent(new dom.Event("load")));
    return frame;
  };
  previewStore.send({ type: "showCanvas" });
  try {
    const sharedFrame = await showFrame(navbar);
    const shared = sharedFrame.document;
    assert.equal(
      shared.querySelector("a")?.textContent,
      "Shared navbar title",
      "a Synced Block shows the project's shared content",
    );
    assert.equal(
      shared.querySelector("nav")?.getAttribute("data-theme"),
      "dark",
      "a Synced Block shows the project's shared settings",
    );

    const unshared = (await showFrame(footer)).document;
    assert.equal(
      unshared.querySelector("a")?.textContent,
      "Default footer title",
      "a Synced Block without shared content shows its defaults",
    );
    assert.equal(unshared.querySelector("nav")?.getAttribute("data-theme"), "light");

    const independent = (await showFrame(banner)).document;
    assert.equal(
      independent.querySelector("a")?.textContent,
      "Default banner title",
      "a block that isn't synced shows its defaults",
    );

    // Shared content is shown, never edited.
    const link = shared.querySelector("a")!;
    await React.act(async () => {
      link.dispatchEvent(new sharedFrame.PointerEvent("pointerdown", { bubbles: true }));
      link.dispatchEvent(new sharedFrame.MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    assert.deepEqual(
      editingRenders,
      [],
      "shared content renders through the non-editing view path",
    );
    assert.equal(previewStore.getSnapshot().context.editingContext, null);
    assert.equal(
      shared.querySelector(
        "[data-camox-block-id], [data-camox-field-id], [data-camox-overlay-mode], [contenteditable]",
      ),
      null,
      "shared content has no editable fields or Synced Block overlays",
    );
  } finally {
    for (const root of roots) await React.act(async () => root.unmount());
    client.clear();
    previewStore.send({ type: "hideCanvas" });
    for (const frame of frames) await frame.happyDOM.close();
    await restore();
  }
});
