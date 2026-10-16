import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";

import type { EditingOwner } from "../previewStore";
import type { DerivedLayoutStructure } from "./DerivedLayoutSidebar";

// Keep PageSidebar, the owner context, and the preview store real. Only replace
// its leaf panels, which would otherwise need RPC and router providers.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!context.parentURL?.endsWith("/PageSidebar.tsx")) return nextResolve(specifier, context);
    const name = ["PageInfoSidebar", "PageTree", "DerivedLayoutSidebar", "PageEditorSidebar"].find(
      (candidate) => specifier === `./${candidate}`,
    );
    if (!name) return nextResolve(specifier, context);
    const source = `
      export function ${name}({pageId, layoutId, layout}) {
        return React.createElement("div", {
          "data-panel": "${name}",
          "data-id": pageId ?? layoutId ?? layout?.layoutId,
        });
      }
    `;
    return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
  },
});

const docs = { layoutId: "docs" } as DerivedLayoutStructure;

async function setup() {
  const dom = new Window({ url: "http://localhost/" });
  const globals = {
    React,
    window: dom,
    document: dom.document,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  const { createRoot } = await import("react-dom/client");
  const { PageSidebar } = await import("./PageSidebar");
  const { PreviewEditingOwnerContext } = await import("../previewSelection");
  const { previewStore: store } = await import("../previewStore");
  const mount = dom.document.createElement("div");
  dom.document.body.append(mount);
  const root = createRoot(mount as unknown as HTMLElement);
  return {
    store,
    async render(
      props: React.ComponentProps<typeof PageSidebar>,
      owner: EditingOwner | null = null,
    ) {
      await React.act(async () =>
        root.render(
          <PreviewEditingOwnerContext value={owner}>
            <PageSidebar {...props} />
          </PreviewEditingOwnerContext>,
        ),
      );
    },
    panels() {
      return [...mount.querySelectorAll("[data-panel]")].map((panel) => [
        panel.getAttribute("data-panel"),
        panel.getAttribute("data-id"),
      ]);
    },
    text() {
      return mount.textContent;
    },
    async close() {
      await React.act(async () => root.unmount());
      store.send({ type: "activatePage", pageId: null });
      store.send({ type: "exitEditMode" });
      await dom.happyDOM.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

void test("without a selection, a page shows its blocks, then what's about it", async () => {
  const dom = await setup();
  dom.store.send({ type: "enterEditMode" });
  // Another frame's selection isn't this sidebar's.
  dom.store.send({ type: "setFocusedBlock", kind: "page", pageId: "7", blockId: "42" });
  const snapshot = dom.store.getSnapshot();
  try {
    await dom.render({ pageId: "7" });
    assert.deepEqual(dom.panels(), [
      ["PageTree", null],
      ["PageInfoSidebar", "7"],
    ]);
    await dom.render({ derivedLayout: docs });
    assert.deepEqual(dom.panels(), [["DerivedLayoutSidebar", "docs"]]);
    await dom.render({});
    assert.deepEqual(dom.panels(), []);
    assert.match(dom.text(), /No page blocks/);
    assert.equal(dom.store.getSnapshot(), snapshot, "rendering never changes preview state");
  } finally {
    await dom.close();
  }
});

void test("the active frame owner's selection opens the editor in place of the page's overview", async () => {
  const dom = await setup();
  dom.store.send({ type: "enterEditMode" });
  try {
    for (const [props, owner] of [
      [{ pageId: "7" }, { kind: "page", pageId: "7" }],
      [{ derivedLayout: docs }, { kind: "layout", layoutId: "docs" }],
    ] as const) {
      dom.store.send({ type: "setFocusedBlock", ...owner, blockId: "42" });
      await dom.render(props, owner);
      assert.deepEqual(dom.panels(), [["PageEditorSidebar", null]]);
      await dom.render(props, { kind: "page", pageId: "83" });
      assert.notDeepEqual(dom.panels(), [["PageEditorSidebar", null]]);
    }
  } finally {
    await dom.close();
  }
});

void test("a record page's selected record opens the editor, with no block selected", async () => {
  const dom = await setup();
  dom.store.send({ type: "enterEditMode" });
  const owner = { kind: "layout", layoutId: "docs" } as const;
  try {
    dom.store.send({
      type: "selectTarget",
      ...owner,
      selection: { type: "record", layoutId: "docs", recordId: "article" },
    });
    await dom.render({ derivedLayout: docs }, owner);
    assert.deepEqual(dom.panels(), [["PageEditorSidebar", null]]);
    dom.store.send({ type: "clearSelection" });
    await dom.render({ derivedLayout: docs }, owner);
    assert.equal(dom.panels()[0]?.[0], "DerivedLayoutSidebar");
  } finally {
    await dom.close();
  }
});
