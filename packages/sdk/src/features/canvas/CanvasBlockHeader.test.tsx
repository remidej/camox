import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";

import type { Block } from "../../core/createBlock";

void test("a block header shows the title, which selects the block, without its description", async () => {
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
    let selections = 0;
    await React.act(async () =>
      root.render(<CanvasBlockHeader block={block as Block} onSelect={() => selections++} />),
    );
    assert.equal(host.querySelector("h2")?.textContent, "Tabs");

    const title = host.querySelector("h2 > button") as unknown as HTMLElement;
    await React.act(async () => {
      title.focus();
      title.click();
    });
    assert.equal(selections, 1, "the title selects the block");
    assert.doesNotMatch(dom.document.body.textContent, /Tabbed content/, "no description shows");
  } finally {
    await React.act(async () => root.unmount());
    await dom.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
