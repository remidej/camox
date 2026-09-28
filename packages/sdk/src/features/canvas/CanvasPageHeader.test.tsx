import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";
import { act } from "react";

import { previewStore } from "../preview/previewStore";
import { CanvasPageHeader } from "./CanvasPageHeader";
import { getCanvasPages } from "./canvasPages";

void test("canvas names report selection without changing preview state or editing the path", async () => {
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
  const mount = dom.document.createElement("div");
  dom.document.body.append(mount);
  const root = createRoot(mount as unknown as HTMLElement);
  const pages = getCanvasPages(
    [{ id: 7, nickname: "Home", fullPath: "/" }],
    [
      { _internal: { id: "about", kind: "singleton", title: "About" } },
      { _internal: { id: "articles.$slug", kind: "derived", title: "Article" } },
    ],
  );
  const changes: string[] = [];
  const originalContext = previewStore.getSnapshot().context.editingContext;
  try {
    for (const page of pages) {
      const pathname = page.pathname ?? "/articles/example";
      let selections = 0;
      const render = async (selected: boolean) =>
        act(async () =>
          root.render(
            <CanvasPageHeader
              page={page}
              pathname={pathname}
              selected={selected}
              onSelect={() => selections++}
              onChange={(path) => changes.push(path)}
            />,
          ),
        );
      await render(false);
      const name = mount.querySelector("button")!;
      assert.equal(name.textContent, page.title);
      assert.equal(name.getAttribute("aria-pressed"), "false");
      await act(async () => name.click());
      assert.equal(selections, 1);
      assert.equal(previewStore.getSnapshot().context.editingContext, originalContext);
      assert.equal(name.getAttribute("aria-pressed"), "false", "no internal selection state");
      await render(true);
      assert.equal(name.getAttribute("aria-pressed"), "true");
      assert.equal(dom.document.querySelector('[role="dialog"]'), null);
      assert.deepEqual(changes, []);
      assert.equal(dom.location.pathname, "/camox/canvas");
      if (page.templateId)
        assert.ok(mount.querySelector('button[aria-label="Edit instance path for Article"]'));
    }
  } finally {
    await act(async () => root.unmount());
    await dom.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
