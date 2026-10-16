import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";

import type { CanvasPage } from "./canvasPages";

// Keep the chat and the preview store real; replace the feedback, which needs RPC.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      context.parentURL?.endsWith("/CanvasRightSidebar.tsx") &&
      specifier === "./CanvasFeedbackSidebar"
    ) {
      const source = `
        export function CanvasFeedbackSidebar({page, pages}) {
          const [count, setCount] = React.useState(0);
          return React.createElement("button", {
            "data-feedback": page?.key ?? "site",
            "data-pages": pages.length,
            onClick: () => setCount(value => value + 1),
          }, String(count));
        }
      `;
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const home: CanvasPage = { key: "page:7", pageId: "7", title: "Home", pathname: "/" };
const pricing: CanvasPage = { key: "page:8", pageId: "8", title: "Pricing", pathname: "/pricing" };
const about: CanvasPage = {
  key: "layout:about",
  layoutId: "about",
  title: "About",
  pathname: "/about",
};
const pages = [home, pricing, about];

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
  const { CanvasRightSidebar } = await import("./CanvasRightSidebar");
  const { previewStore: store } = await import("../preview/previewStore");
  const mount = dom.document.createElement("div");
  dom.document.body.append(mount);
  const root = createRoot(mount as unknown as HTMLElement);
  return {
    mount,
    store,
    async render(page: CanvasPage | undefined, blockSelected = false) {
      await React.act(async () =>
        root.render(<CanvasRightSidebar page={page} pages={pages} blockSelected={blockSelected} />),
      );
    },
    shown() {
      if (mount.querySelector("[data-canvas-chat-sidebar]")) return "chat";
      return mount.querySelector("[data-feedback]")?.getAttribute("data-feedback");
    },
    async close() {
      await React.act(async () => root.unmount());
      store.send({ type: "exitEditMode" });
      await dom.happyDOM.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

void test("the right sidebar is the Canvas's chat, whatever is selected, unless commenting", async () => {
  const dom = await setup();
  dom.store.send({ type: "enterEditMode" });
  try {
    for (const [page, blockSelected] of [
      [undefined, false],
      [home, false],
      [about, false],
      [undefined, true],
    ] as const) {
      await dom.render(page, blockSelected);
      assert.equal(dom.shown(), "chat");
    }
  } finally {
    await dom.close();
  }
});

void test("commenting shows the selected Page's feedback, or every Page's, but never a block's", async () => {
  const dom = await setup();
  dom.store.send({ type: "enterEditMode" });
  dom.store.send({ type: "setCommentMode", enabled: true });
  const snapshot = dom.store.getSnapshot();
  try {
    await dom.render(home);
    assert.equal(dom.shown(), "page:7");
    assert.equal(dom.mount.querySelector("[data-pages]")?.getAttribute("data-pages"), "3");
    await dom.render(about);
    assert.equal(dom.shown(), "layout:about", "the feedback decides what a code page shows");
    await dom.render(undefined);
    assert.equal(dom.shown(), "site");
    await dom.render(undefined, true);
    assert.equal(dom.shown(), "chat", "no feedback targets a block of the Block Catalog");
    assert.equal(dom.store.getSnapshot(), snapshot, "rendering never changes preview state");
  } finally {
    await dom.close();
  }
});

void test("changing the selected Page resets the feedback's local state, but rerendering does not", async () => {
  const dom = await setup();
  dom.store.send({ type: "enterEditMode" });
  dom.store.send({ type: "setCommentMode", enabled: true });
  const button = () => dom.mount.querySelector("button")!;
  try {
    await dom.render(home);
    await React.act(async () => button().click());
    await dom.render(home);
    assert.equal(button().textContent, "1");
    await dom.render(pricing);
    assert.equal(button().textContent, "0");
  } finally {
    await dom.close();
  }
});
