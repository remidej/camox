import assert from "node:assert/strict";
import { test } from "node:test";

import { type HTMLButtonElement, Window } from "happy-dom";
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
    [{ id: "7", nickname: "Home", fullPath: "/" }],
    [
      { _internal: { id: "about", kind: "singleton", title: "About" } },
      { _internal: { id: "articles.$slug", kind: "derived", title: "Article" } },
    ],
  );
  const changes: string[] = [];
  try {
    for (const page of pages) {
      const originalContext = previewStore.getSnapshot().context.editingContext;
      const pathname = page.pathname ?? "/articles/example";
      let selections = 0;
      const hovers: boolean[] = [];
      const renames: string[] = [];
      const render = async (selected: boolean) =>
        act(async () =>
          root.render(
            <CanvasPageHeader
              page={page}
              pathname={pathname}
              selected={selected}
              onSelect={() => selections++}
              onHoverChange={(hovered) => hovers.push(hovered)}
              onChange={(path) => changes.push(path)}
              onRename={
                page.kind !== "curated"
                  ? undefined
                  : async (name) => {
                      renames.push(name);
                    }
              }
            />,
          ),
        );
      await render(false);
      const header = mount.querySelector("h2")!;
      assert.equal(header.firstElementChild, mount.querySelector("[data-canvas-path]"));
      assert.ok(header.classList.contains("flex-col"));
      let name = mount.querySelector<HTMLButtonElement>("button[aria-pressed]")!;
      assert.equal(name.textContent, page.title);
      assert.equal(name.getAttribute("aria-pressed"), "false");
      await act(async () => {
        name.dispatchEvent(new dom.MouseEvent("mouseover", { bubbles: true }));
        name.dispatchEvent(new dom.MouseEvent("mouseout", { bubbles: true }));
      });
      assert.deepEqual(hovers, [true, false]);
      await act(async () => name.click());
      assert.equal(selections, 1);
      assert.equal(previewStore.getSnapshot().context.editingContext, originalContext);
      assert.equal(name.getAttribute("aria-pressed"), "false", "no internal selection state");
      await render(true);
      assert.equal(name.getAttribute("aria-pressed"), "true");
      assert.equal(dom.document.querySelector('[role="dialog"]'), null);
      assert.deepEqual(changes, []);
      assert.equal(dom.location.pathname, "/camox/canvas");
      await act(async () => name.dispatchEvent(new dom.MouseEvent("dblclick", { bubbles: true })));
      const input = mount.querySelector('input[aria-label="Page nickname"]');
      if (page.kind === "curated") {
        assert.ok(input);
        assert.equal(dom.document.activeElement, input);
        await act(async () => {
          input.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        });
        assert.equal(mount.querySelector("input"), null);
        assert.deepEqual(renames, []);
        name = mount.querySelector<HTMLButtonElement>("button[aria-pressed]")!;
      } else {
        assert.equal(input, null, "code-defined titles cannot be renamed");
      }
      if (page.kind === "derived")
        assert.ok(mount.querySelector('button[aria-label="Edit page path for Article"]'));
    }
  } finally {
    await act(async () => root.unmount());
    previewStore.send({ type: "activatePage", pageId: null });
    await dom.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
