import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import * as React from "react";

import type { PreviewedPage } from "./PageNavigatorSidebar";

Object.assign(globalThis, { React });

const frameCallbacks: Array<(iframe: HTMLIFrameElement) => void> = [];
Object.assign(globalThis, {
  capturePreviewFrameReady: (callback: (iframe: HTMLIFrameElement) => void) =>
    frameCallbacks.push(callback),
});

// Exercise the real panel lifecycle and selection hooks without mounting unrelated chrome
// or a second browser document. The frame still renders its actual preview children.
registerHooks({
  resolve(specifier, context, nextResolve) {
    let source: string | undefined;
    if (specifier === "@camox/ui/toaster") source = "export const toast = () => {}";
    if (context.parentURL?.endsWith("/PreviewPanel.tsx")) {
      const stubs: Record<string, string> = {
        "@camox/ui/panel": "export const PanelContent = ({children}) => children",
        "@/lib/utils":
          "export const cn = (...args) => args.filter(Boolean).join(' '); export const checkIfInputFocused = () => false",
        "./Frame":
          "export const Frame = ({children, onIframeReady}) => { globalThis.capturePreviewFrameReady(onIframeReady); return children }; export const useFrame = () => ({window: null})",
        "./BlockActionsPopover":
          "export const useBlockActionsShortcuts = () => { throw new Error('Read-only preview must not register block shortcuts') }",
      };
      source = stubs[specifier] ?? source;
      for (const name of [
        "FieldToolbar",
        "Overlays",
        "PreviewComments",
        "FieldOverlayStyles",
        "OverlayTracker",
      ]) {
        if (specifier === `./${name}`)
          source = `export const ${name} = () => { throw new Error('Read-only preview must not mount ${name}') }`;
      }
      for (const name of ["MobilePreviewDrawer"]) {
        if (specifier === `./${name}`) source = `export const ${name} = () => null`;
      }
      if (specifier === "./PreviewToolbar")
        source =
          "export const PreviewToolbar = () => React.createElement('aside', {'data-preview-toolbar': true})";
    }
    if (source)
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

void test("retained preview masks editing runtime in every mode without remounting content", async () => {
  const dom = await setup();
  const { PreviewPanel } = await import("./PreviewPanel");
  const { previewStore: store } = await import("../previewStore");
  const { BlockEditingRuntimeProvider, useBlockEditingRuntime } =
    await import("../../../core/editing/BlockEditingRuntime");
  let mounts = 0;
  const runtime = {
    useSetting: () => {
      throw new Error("Unexpected editing setting");
    },
    renderBlock: () => {
      throw new Error("Unexpected editing block");
    },
    renderPrimitive: () => {
      throw new Error("Unexpected editing primitive");
    },
  };
  function Content() {
    assert.equal(useBlockEditingRuntime(), null);
    React.useEffect(() => {
      mounts++;
    }, []);
    return <p>Retained content</p>;
  }
  const render = (active = true, mobile = false) =>
    dom.render(
      <BlockEditingRuntimeProvider runtime={runtime}>
        <PreviewPanel active={active} isMobileExperience={mobile}>
          <Content />
        </PreviewPanel>
      </BlockEditingRuntimeProvider>,
    );
  try {
    store.send({ type: "exitEditMode" });
    await render();
    const content = dom.host.querySelector("p");
    await React.act(async () => store.send({ type: "enterEditMode" }));
    await render(false);
    assert.equal(dom.host.querySelector("p"), content);
    assert.equal(mounts, 1);
    await React.act(async () => store.send({ type: "setCommentMode", enabled: true }));
    assert.equal(store.getSnapshot().context.mode, "commenting-draft");
    await render(false);
    assert.equal(dom.host.querySelector("p"), content);
    assert.equal(mounts, 1);
    await render(false, true);
    assert.equal(dom.host.querySelector("p")?.textContent, "Retained content");
  } finally {
    await dom.close();
    store.send({ type: "exitEditMode" });
  }
});

void test("inactive preview cannot activate owners or register a delayed iframe over Canvas", async () => {
  const dom = await setup();
  const { PreviewPanel } = await import("./PreviewPanel");
  const { previewStore: store } = await import("../previewStore");
  const render = (active: boolean, pageId?: number, layoutId?: number) =>
    dom.render(
      <PreviewPanel
        active={active}
        page={pageId == null ? undefined : ({ id: pageId } as PreviewedPage)}
        layoutId={layoutId}
      >
        <p>Preview</p>
      </PreviewPanel>,
    );
  const outgoingFrame = document.createElement("iframe");
  const canvasFrame = document.createElement("iframe");
  try {
    await render(true, 3);
    assert.ok(dom.host.querySelector("[data-preview-toolbar]"));
    const ready = frameCallbacks.at(-1)!;
    ready(outgoingFrame);
    assert.equal(store.getSnapshot().context.iframeElement, outgoingFrame);
    await render(false, 3);
    store.send({ type: "activatePage", pageId: 10 });
    store.send({ type: "setIframeElement", element: canvasFrame });
    const canvasOwner = store.getSnapshot().context.editingContext;
    await render(false, 4);
    await render(false, undefined, 5);
    ready(outgoingFrame);
    frameCallbacks.at(-1)!(outgoingFrame);
    assert.equal(store.getSnapshot().context.editingContext, canvasOwner);
    assert.equal(store.getSnapshot().context.iframeElement, canvasFrame);
    assert.equal(dom.host.querySelector("[data-preview-toolbar]"), null);
    await dom.render(null);
    ready(outgoingFrame);
    assert.equal(store.getSnapshot().context.iframeElement, canvasFrame);
    await render(false, 6);
    frameCallbacks.at(-1)!(outgoingFrame);
    assert.equal(store.getSnapshot().context.editingContext, canvasOwner);
    assert.equal(store.getSnapshot().context.iframeElement, canvasFrame);
    const retainedContent = dom.host.querySelector("p");
    await render(true, 6);
    assert.equal(dom.host.querySelector("p"), retainedContent);
    assert.equal(
      store.getSnapshot().context.iframeElement,
      outgoingFrame,
      "cancelling preparation restores the already-loaded retained iframe",
    );
    assert.deepEqual(store.getSnapshot().context.editingContext, {
      kind: "page",
      pageId: 6,
      selection: null,
    });
  } finally {
    await dom.close();
    store.send({ type: "activatePage", pageId: null });
    store.send({ type: "setIframeElement", element: null });
  }
});

async function setup() {
  const { Window } = await import("happy-dom");
  const window = new Window();
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { createRoot } = await import("react-dom/client");
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  return {
    host,
    async render(children: React.ReactNode) {
      await React.act(async () => root.render(children));
    },
    async close() {
      await React.act(async () => root.unmount());
      await window.happyDOM.close();
    },
  };
}

void test("panel resolution, navigation and derived layouts synchronize selection without losing same-owner focus", async () => {
  const dom = await setup();
  const { PreviewPanel } = await import("./PreviewPanel");
  const { previewStore: store } = await import("../previewStore");
  const { usePreviewSelection } = await import("../previewSelection");
  const { useFieldSelection } = await import("../../../core/hooks/useFieldSelection");
  const selection = {
    type: "block-field",
    blockId: 7,
    fieldName: "title",
    fieldType: "String",
  } as const;
  function Target() {
    const select = usePreviewSelection();
    const selected = useFieldSelection(7, "title", "String");
    return (
      <button data-selected={selected} onClick={() => select(selection)}>
        Title
      </button>
    );
  }
  const render = (pageId?: number, layoutId?: number, mobile = false) =>
    dom.render(
      <React.StrictMode>
        <PreviewPanel
          page={pageId == null ? undefined : ({ id: pageId } as PreviewedPage)}
          layoutId={layoutId}
          isMobileExperience={mobile}
        >
          <Target />
        </PreviewPanel>
      </React.StrictMode>,
    );
  try {
    store.send({ type: "activatePage", pageId: null });
    store.send({ type: "enterEditMode" });
    await render();
    await React.act(async () => dom.host.querySelector("button")!.click());
    assert.equal(store.getSnapshot().context.editingContext, null);

    await render(3);
    assert.deepEqual(store.getSnapshot().context.editingContext, {
      kind: "page",
      pageId: 3,
      selection: null,
    });
    await React.act(async () => dom.host.querySelector("button")!.click());
    const focused = store.getSnapshot().context.editingContext;
    assert.deepEqual(focused, { kind: "page", pageId: 3, selection });
    await render(3, undefined, true);
    assert.equal(store.getSnapshot().context.editingContext, focused);
    assert.equal(dom.host.querySelector("button")!.getAttribute("data-selected"), "true");

    await render(4);
    assert.deepEqual(store.getSnapshot().context.editingContext, {
      kind: "page",
      pageId: 4,
      selection: null,
    });
    assert.equal(dom.host.querySelector("button")!.getAttribute("data-selected"), "false");

    await React.act(async () =>
      store.send({ type: "selectTarget", kind: "page", pageId: 5, selection }),
    );
    await render(5);
    assert.deepEqual(store.getSnapshot().context.editingContext, {
      kind: "page",
      pageId: 5,
      selection,
    });

    await render(undefined, 5);
    assert.deepEqual(store.getSnapshot().context.editingContext, {
      kind: "layout",
      layoutId: 5,
      selection: null,
    });
    await React.act(async () => dom.host.querySelector("button")!.click());
    assert.deepEqual(store.getSnapshot().context.editingContext, {
      kind: "layout",
      layoutId: 5,
      selection,
    });
    await React.act(async () => store.send({ type: "cycleViewportMode" }));
    assert.equal(dom.host.querySelector("button")!.getAttribute("data-selected"), "true");
    await render(undefined, 6);
    assert.deepEqual(store.getSnapshot().context.editingContext, {
      kind: "layout",
      layoutId: 6,
      selection: null,
    });
    await render();
    assert.equal(store.getSnapshot().context.editingContext, null);
  } finally {
    await dom.close();
    store.send({ type: "activatePage", pageId: null });
    store.send({ type: "setViewportMode", mode: "full" });
    store.send({ type: "exitEditMode" });
  }
});

void test("read-only panel centers responsive viewports and preserves shell selection shortcuts", async () => {
  const dom = await setup();
  const { PreviewPanel } = await import("./PreviewPanel");
  const { previewStore: store } = await import("../previewStore");
  const { actionsStore } = await import("../../provider/actionsStore");
  const clearSelection = {
    id: "clear-selection",
    label: "Shell clear selection",
    groupLabel: "Preview" as const,
    checkIfAvailable: () => true,
    execute: () => {},
    shortcut: { key: "Escape" },
  };
  actionsStore.send({ type: "registerManyActions", actions: [clearSelection] });
  try {
    store.send({ type: "enterEditMode" });
    store.send({ type: "setViewportMode", mode: "tablet" });
    await dom.render(
      <PreviewPanel page={{ id: 3 } as PreviewedPage}>
        <p>Preview content</p>
      </PreviewPanel>,
    );
    assert.ok(dom.host.querySelector(".items-center"));
    assert.equal(dom.host.querySelector(".items-start, .mt-8"), null);
    assert.match(dom.host.innerHTML, /w-\[768px\]/);
    const actions = actionsStore.getSnapshot().context.actions;
    assert.equal(
      actions.find((action) => action.id === "clear-selection"),
      clearSelection,
    );
    await React.act(async () => store.send({ type: "cycleViewportMode" }));
    assert.equal(store.getSnapshot().context.viewportMode, "mobile");
    assert.match(dom.host.innerHTML, /w-\[393px\]/);
    await dom.render(null);
    const remainingActions = actionsStore.getSnapshot().context.actions;
    assert.equal(
      remainingActions.find((action) => action.id === "clear-selection"),
      clearSelection,
    );
    assert.equal(
      remainingActions.some((action) => action.id === "cycle-viewport-mode"),
      false,
    );
  } finally {
    await dom.close();
    actionsStore.send({ type: "unregisterManyActions", ids: ["clear-selection"] });
    store.send({ type: "activatePage", pageId: null });
    store.send({ type: "setViewportMode", mode: "full" });
    store.send({ type: "exitEditMode" });
  }
});

void test("nested preview targets use their containing owner, not the active route or a reused block ID", async () => {
  const dom = await setup();
  const { PreviewPanel } = await import("./PreviewPanel");
  const { previewStore: store } = await import("../previewStore");
  const { PreviewEditingOwnerContext, usePreviewSelection, usePreviewTargetSelection } =
    await import("../previewSelection");
  function Target({ name }: { name: string }) {
    const select = usePreviewSelection();
    const selected = usePreviewTargetSelection();
    return (
      <button
        data-selected={selected?.blockId === 7}
        onClick={() => select({ type: "block", blockId: 7 })}
      >
        {name}
      </button>
    );
  }
  try {
    store.send({ type: "enterEditMode" });
    await dom.render(
      <PreviewPanel page={{ id: 3 } as PreviewedPage}>
        <Target name="Route" />
        <PreviewEditingOwnerContext value={{ kind: "page", pageId: 4 }}>
          <Target name="Other page" />
        </PreviewEditingOwnerContext>
      </PreviewPanel>,
    );
    const buttons = dom.host.querySelectorAll("button");
    await React.act(async () => buttons[1]!.click());
    assert.deepEqual(store.getSnapshot().context.editingContext, {
      kind: "page",
      pageId: 4,
      selection: { type: "block", blockId: 7 },
    });
    assert.equal(buttons[0]!.getAttribute("data-selected"), "false");
    assert.equal(buttons[1]!.getAttribute("data-selected"), "true");
  } finally {
    await dom.close();
    store.send({ type: "activatePage", pageId: null });
    store.send({ type: "exitEditMode" });
  }
});
