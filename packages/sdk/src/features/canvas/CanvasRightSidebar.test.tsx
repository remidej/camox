import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";

import type { Layout } from "../../core/createLayout";
import type { EditingOwner } from "../preview/previewStore";
import { getCanvasPages } from "./canvasPages";
import { selectedCanvasPage, selectedCanvasPath } from "./canvasSelection";

// Keep RightSidebar, the owner context, and the preview store real. Only replace
// its expensive leaf editors, which would otherwise need RPC and router providers.
registerHooks({
  resolve(specifier, context, nextResolve) {
    let source: string | undefined;
    if (specifier === "@camox/ui/toaster") source = "export const toast = () => {}";
    if (context.parentURL?.endsWith("/RightSidebar.tsx")) {
      for (const name of [
        "PageInfoSidebar",
        "DerivedPageInfoSidebar",
        "PageEditorSidebar",
        "CommentSidebar",
      ]) {
        if (specifier !== `./${name}`) continue;
        source = `
          export function ${name}({pageId, layoutId}) {
            const [count, setCount] = React.useState(0);
            return React.createElement("button", {
              "data-editor": "${name}",
              "data-page-id": pageId,
              "data-layout-id": layoutId,
              onClick: () => setCount(value => value + 1),
            }, String(count));
          }
        `;
      }
    }
    if (source)
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const layouts = [
  { _internal: { id: "about", kind: "singleton", title: "About" } },
  { _internal: { id: "articles.$slug", kind: "derived", title: "Article" } },
] as Layout[];

function select(url: string) {
  const pages = getCanvasPages(
    [
      { id: 7, nickname: "Home", fullPath: "/" },
      { id: 83, nickname: "Special article", fullPath: "/articles/special" },
    ],
    layouts,
  );
  return selectedCanvasPage(pages, layouts, selectedCanvasPath(url));
}

async function setup() {
  const dom = new Window({ url: "http://localhost/camox/canvas" });
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
  const { CanvasRightSidebar } = await import("./CanvasRightSidebar");
  const { PreviewEditingOwnerContext } = await import("../preview/previewSelection");
  const { previewStore: store } = await import("../preview/previewStore");
  const mount = dom.document.createElement("div");
  dom.document.body.append(mount);
  const root = createRoot(mount as unknown as HTMLElement);
  return {
    mount,
    store,
    async render(url: string, owner?: EditingOwner) {
      await React.act(async () =>
        root.render(
          <React.StrictMode>
            <PreviewEditingOwnerContext value={{ kind: "page", pageId: 7 }}>
              <CanvasRightSidebar page={select(url)} owner={owner} />
            </PreviewEditingOwnerContext>
          </React.StrictMode>,
        ),
      );
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

void test("canvas URL selection targets page or layout info without inheriting stale preview selection", async () => {
  const dom = await setup();
  const { store } = dom;
  store.send({ type: "enterEditMode" });
  store.send({ type: "setFocusedBlock", kind: "page", pageId: 7, blockId: 42 });
  const snapshot = store.getSnapshot();
  const observed: unknown[] = [];
  const subscription = store.subscribe((state) => observed.push(state));
  try {
    for (const [url, editor, pageId, layoutId] of [
      ["/camox/canvas", "PageInfoSidebar", "7", null],
      // A concrete page wins over a matching derived template.
      ["/camox/canvas/articles/special", "PageInfoSidebar", "83", null],
      ["/camox/canvas/about", "DerivedPageInfoSidebar", null, "about"],
      ["/camox/canvas/articles/hello%20world", "DerivedPageInfoSidebar", null, "articles.$slug"],
      ["/camox/canvas/missing", null, null, null],
    ] as const) {
      await dom.render(url);
      const leaf = dom.mount.querySelector("[data-editor]");
      assert.equal(leaf?.getAttribute("data-editor") ?? null, editor, url);
      assert.equal(leaf?.getAttribute("data-page-id") ?? null, pageId, url);
      assert.equal(leaf?.getAttribute("data-layout-id") ?? null, layoutId, url);
      assert.equal(dom.mount.querySelectorAll("aside").length, editor ? 1 : 0, url);
      assert.equal(dom.mount.querySelector('[data-editor="PageEditorSidebar"]'), null);
      assert.equal(store.getSnapshot(), snapshot, "canvas rendering must not change preview state");
    }
    assert.equal(dom.mount.innerHTML, "", "an unmatched URL renders no sidebar");
    assert.deepEqual(observed, [], "canvas navigation must not send preview-store events");
  } finally {
    subscription.unsubscribe();
    await dom.close();
  }
});

void test("changing the selected canvas page resets sidebar-local state, but rerendering does not", async () => {
  const dom = await setup();
  try {
    await dom.render("/camox/canvas");
    await React.act(async () => dom.mount.querySelector("button")!.click());
    await dom.render("/camox/canvas");
    assert.equal(dom.mount.querySelector("button")!.textContent, "1");
    await dom.render("/camox/canvas/articles/special");
    assert.equal(dom.mount.querySelector("button")!.textContent, "0");
    assert.equal(dom.mount.querySelector("button")!.getAttribute("data-page-id"), "83");

    await dom.render("/camox/canvas/about");
    await React.act(async () => dom.mount.querySelector("button")!.click());
    await dom.render("/camox/canvas/articles/example");
    assert.equal(dom.mount.querySelector("button")!.textContent, "0");
    assert.equal(
      dom.mount.querySelector("button")!.getAttribute("data-layout-id"),
      "articles.$slug",
    );
  } finally {
    await dom.close();
  }
});

void test("canvas uses the active frame owner to edit selected page and layout blocks", async () => {
  const dom = await setup();
  dom.store.send({ type: "enterEditMode" });
  try {
    for (const [url, owner] of [
      ["/camox/canvas", { kind: "page", pageId: 7 }],
      ["/camox/canvas/about", { kind: "layout", layoutId: 21 }],
    ] as const) {
      dom.store.send({ type: "setFocusedBlock", ...owner, blockId: 42 });
      await dom.render(url, owner);
      assert.ok(dom.mount.querySelector('[data-editor="PageEditorSidebar"]'));
      await dom.render(url, { kind: "page", pageId: 83 });
      assert.equal(dom.mount.querySelector('[data-editor="PageEditorSidebar"]'), null);
    }
  } finally {
    await dom.close();
  }
});

void test("comment mode targets the selected persisted page and keeps code layouts on layout info", async () => {
  const dom = await setup();
  dom.store.send({ type: "enterEditMode" });
  dom.store.send({ type: "setCommentMode", enabled: true });
  const snapshot = dom.store.getSnapshot();
  try {
    await dom.render("/camox/canvas/articles/special");
    const comments = dom.mount.querySelector('[data-editor="CommentSidebar"]');
    assert.ok(comments);
    assert.equal(comments.getAttribute("data-page-id"), "83");
    for (const url of ["/camox/canvas/about", "/camox/canvas/articles/example"]) {
      await dom.render(url);
      assert.ok(dom.mount.querySelector('[data-editor="DerivedPageInfoSidebar"]'));
      assert.equal(dom.mount.querySelector('[data-editor="CommentSidebar"]'), null);
    }
    await dom.render("/camox/canvas/missing");
    assert.equal(dom.mount.innerHTML, "");
    assert.equal(dom.store.getSnapshot(), snapshot);
  } finally {
    await dom.close();
  }
});
