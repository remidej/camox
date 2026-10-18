import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";

void test("the Canvas, shown before the editor loads, shows the Canvas sidebar placeholder and a loading screen over the page", async () => {
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
  const sidebar = () => dom.document.querySelector("[data-canvas-sidebar-skeleton]");
  const page = () => dom.document.querySelector("[data-read-only-page]");
  const loading = () => dom.document.querySelector("[data-canvas-loading]");
  const render = (chrome: boolean) =>
    React.act(async () =>
      root.render(
        <EditingFallbackContext
          value={
            chrome
              ? ({ layoutPage, children }) => (
                  <StudioEditingFallback layoutPage={layoutPage}>{children}</StudioEditingFallback>
                )
              : null
          }
        >
          <EditingFallbackSlot layoutPage={false}>
            <div data-read-only-page />
          </EditingFallbackSlot>
        </EditingFallbackContext>,
      ),
    );

  try {
    await render(false);
    assert.equal(
      page()?.parentElement,
      dom.document.body,
      "without the Studio chrome, a visitor's page shows as it is",
    );

    await render(true);
    const original = page();
    assert.ok(original);
    assert.equal(
      sidebar(),
      null,
      "with the Canvas hidden, the page shows without a Canvas sidebar",
    );
    assert.equal(loading(), null, "with the Canvas hidden, the page shows");

    await React.act(async () => previewStore.send({ type: "showCanvas" }));
    assert.ok(sidebar(), "showing the Canvas makes room for its sidebar right away");
    assert.ok(
      sidebar()!.compareDocumentPosition(page()!) & dom.Node.DOCUMENT_POSITION_FOLLOWING,
      "the Canvas sidebar sits before the page",
    );
    assert.equal(page(), original, "the page's frame is kept, so it never reloads");
    assert.equal(
      loading()?.parentElement,
      page()!.parentElement,
      "a loading screen covers the page, where the Canvas will show",
    );

    await React.act(async () => previewStore.send({ type: "hideCanvas" }));
    assert.equal(sidebar(), null);
    assert.equal(loading(), null);
    assert.equal(page(), original);
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
