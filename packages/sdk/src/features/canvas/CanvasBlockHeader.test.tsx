import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";

import type { Block } from "../../core/createBlock";

void test("a block header shows the title, with the description in a tooltip", async () => {
  const dom = new Window({ url: "http://localhost/" });
  const globals = {
    React,
    window: dom,
    document: dom.document,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    Node: dom.Node,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  const { createRoot } = await import("react-dom/client");
  const { CanvasBlockHeader } = await import("./CanvasBlockHeader");
  const block = { _internal: { title: "Tabs", description: "Tabbed content" } };
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  try {
    await React.act(async () => root.render(<CanvasBlockHeader block={block as Block} />));
    assert.equal(host.querySelector("h2")?.textContent, "Tabs");
    assert.doesNotMatch(
      dom.document.body.textContent,
      /Tabbed content/,
      "the tooltip starts hidden",
    );

    const title = host.querySelector("h2 > *") as unknown as HTMLElement;
    await React.act(async () => title.focus());
    const tooltip = dom.document.querySelector('[data-slot="tooltip-content"]');
    assert.equal(tooltip?.textContent, "Tabbed content", "the description shows in a tooltip");
  } finally {
    await React.act(async () => root.unmount());
    await dom.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
