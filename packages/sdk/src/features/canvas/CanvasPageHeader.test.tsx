import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";
import { act } from "react";

import { COMMENT_CURSOR } from "../preview/commentCursor";
import { previewCommentsStore } from "../preview/previewCommentsStore";
import { previewStore, selectIsCommentMode } from "../preview/previewStore";
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
  const originalCommentMode = selectIsCommentMode(previewStore.getSnapshot());
  try {
    for (const page of pages) {
      const originalContext = previewStore.getSnapshot().context.editingContext;
      const pathname = page.pathname ?? "/articles/example";
      let selections = 0;
      const commentSelections: boolean[] = [];
      const hovers: boolean[] = [];
      const render = async (selected: boolean) =>
        act(async () =>
          root.render(
            <CanvasPageHeader
              page={page}
              pathname={pathname}
              selected={selected}
              onSelect={(commenting) => {
                selections++;
                commentSelections.push(commenting);
              }}
              onHoverChange={(hovered) => hovers.push(hovered)}
              onChange={(path) => changes.push(path)}
            />,
          ),
        );
      await render(false);
      const name = mount.querySelector("button")!;
      assert.equal(name.textContent, page.title);
      assert.equal(name.getAttribute("aria-pressed"), "false");
      await act(async () => {
        name.dispatchEvent(new dom.MouseEvent("mouseover", { bubbles: true }));
        name.dispatchEvent(new dom.MouseEvent("mouseout", { bubbles: true }));
      });
      assert.deepEqual(hovers, [true, false]);
      await act(async () => name.click());
      assert.equal(selections, 1);
      assert.deepEqual(commentSelections, [false]);
      assert.equal(previewStore.getSnapshot().context.editingContext, originalContext);
      assert.equal(name.getAttribute("aria-pressed"), "false", "no internal selection state");
      await render(true);
      assert.equal(name.getAttribute("aria-pressed"), "true");
      assert.equal(dom.document.querySelector('[role="dialog"]'), null);
      assert.deepEqual(changes, []);
      assert.equal(dom.location.pathname, "/camox/canvas");
      await act(async () => {
        previewStore.send({ type: "enterEditMode" });
        previewStore.send({ type: "setCommentMode", enabled: true });
      });
      assert.equal(name.style.cursor, COMMENT_CURSOR);
      assert.equal(dom.getComputedStyle(mount.querySelector("[data-canvas-path]")!).cursor, "");
      if (page.pageId != null) {
        // Clicking a nickname must replace a stale target from another page.
        await act(async () => {
          previewStore.send({
            type: "selectTarget",
            kind: "page",
            pageId: 99,
            selection: { type: "block", blockId: 42 },
          });
          name.click();
        });
        assert.deepEqual(commentSelections, [false, true]);
        assert.equal(selectIsCommentMode(previewStore.getSnapshot()), false);
        assert.deepEqual(previewStore.getSnapshot().context.editingContext, {
          kind: "page",
          pageId: page.pageId,
          selection: null,
        });
        const { draft, focusTarget } = previewCommentsStore.getSnapshot().context;
        assert.equal(draft?.pageId, page.pageId);
        assert.deepEqual(draft?.target, { kind: "page" });
        assert.deepEqual(focusTarget, { kind: "page" });
        assert.deepEqual(previewCommentsStore.getSnapshot().context.popover?.target, {
          kind: "page",
        });
        assert.equal(name.style.cursor, "");
        await act(async () => {
          previewStore.send({ type: "clearSelection" });
          previewCommentsStore.send({ type: "clearSelection" });
        });
      }
      await act(async () => previewStore.send({ type: "setCommentMode", enabled: false }));
      assert.equal(name.style.cursor, "");
      await act(async () => previewStore.send({ type: "exitEditMode" }));
      if (page.templateId)
        assert.ok(mount.querySelector('button[aria-label="Edit instance path for Article"]'));
    }
  } finally {
    await act(async () => root.unmount());
    previewStore.send({ type: "activatePage", pageId: null });
    previewCommentsStore.send({ type: "clearSelection" });
    previewStore.send({ type: "setCommentMode", enabled: originalCommentMode });
    await dom.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
