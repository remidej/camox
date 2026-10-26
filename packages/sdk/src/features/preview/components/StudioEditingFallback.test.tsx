import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";

void test("before the editor loads, a spinner in the Canvas's background holds the page's place, and the Canvas shown adds its sidebar placeholder", async () => {
  const dom = new Window();
  const globals = {
    React,
    window: dom,
    document: dom.document,
    ResizeObserver: dom.ResizeObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  const { createRoot } = await import("react-dom/client");
  const { EditingFallbackContext, EditingFallbackSlot } =
    await import("../../runtime/editingFallback");
  const { StudioEditingFallback } = await import("./StudioEditingFallback");
  const { previewStore } = await import("../previewStore");
  const root = createRoot(dom.document.body as unknown as HTMLElement);
  const sidebar = () => dom.document.querySelector("[data-content-sidebar-skeleton]");
  const loading = () => dom.document.querySelector("[data-canvas-loading]");
  const status = () => dom.document.querySelector('[role="status"]');
  const render = (chrome: boolean) =>
    React.act(async () =>
      root.render(
        <EditingFallbackContext
          value={
            chrome ? ({ layoutPage }) => <StudioEditingFallback layoutPage={layoutPage} /> : null
          }
        >
          <EditingFallbackSlot layoutPage={false} />
        </EditingFallbackContext>,
      ),
    );

  try {
    await render(false);
    assert.equal(dom.document.body.innerHTML, "", "without the Studio chrome, nothing shows");

    await render(true);
    assert.equal(sidebar(), null, "with the Canvas hidden, there is no Content Sidebar");
    assert.ok(loading()?.className.includes("bg-muted"), "the Canvas's own background");
    assert.equal(status()?.getAttribute("aria-label"), "Loading the page");

    await React.act(async () => previewStore.send({ type: "showCanvas" }));
    assert.ok(sidebar(), "showing the Canvas makes room for its sidebar right away");
    assert.ok(
      sidebar()!.compareDocumentPosition(loading()!) & dom.Node.DOCUMENT_POSITION_FOLLOWING,
      "the Content Sidebar sits before the loading screen",
    );
    assert.ok(status(), "the loading screen stays, where the Canvas will show");

    await React.act(async () => previewStore.send({ type: "hideCanvas" }));
    assert.equal(sidebar(), null);
    assert.equal(status()?.getAttribute("aria-label"), "Loading the page");
  } finally {
    previewStore.send({ type: "hideCanvas" });
    await React.act(async () => root.unmount());
    await dom.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
