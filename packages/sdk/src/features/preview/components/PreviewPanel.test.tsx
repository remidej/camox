import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import * as React from "react";

import type { PreviewedPage } from "./PageNavigatorSidebar";

Object.assign(globalThis, { React });

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
          "export const Frame = ({children}) => children; export const useFrame = () => ({window: null})",
        "./BlockActionsPopover": "export const useBlockActionsShortcuts = () => {}",
      };
      source = stubs[specifier] ?? source;
      for (const name of [
        "FieldOverlayStyles",
        "FieldToolbar",
        "MobilePreviewDrawer",
        "Overlays",
        "OverlayTracker",
        "PreviewComments",
        "PreviewToolbar",
      ]) {
        if (specifier === `./${name}`) source = `export const ${name} = () => null`;
      }
    }
    if (source)
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
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

void test("nested preview targets use their containing owner, not the active route or shared block ID", async () => {
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
