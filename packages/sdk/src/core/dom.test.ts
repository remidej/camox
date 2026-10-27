import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";

import { getElementContext, usePreviewPaused } from "./dom";

void test("missing elements are safe without browser globals", () => {
  assert.equal(getElementContext(null), null);
  assert.equal(getElementContext(undefined), null);
});

void test("resolves each element's own document and window, even before attachment", () => {
  const host = new Window();
  const preview = new Window();
  const thumbnail = new Window();

  for (const view of [host, preview, thumbnail]) {
    const element = view.document.createElement("div");
    const context = getElementContext(element as unknown as Element);
    assert.equal(context?.document, view.document);
    assert.equal(context?.window, view);
  }
});

void test("documents without a browsing context do not fall back to globals", () => {
  const view = new Window();
  const document = view.document.implementation.createHTMLDocument();
  assert.equal(document.defaultView, null);
  assert.equal(getElementContext(document.createElement("div") as unknown as Element), null);
});

void test("blocks follow whether Camox paused their own preview document", async (t) => {
  const host = new Window();
  const preview = new Window();
  const globals = { window: host, document: host.document, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  t.after(async () => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    await host.happyDOM.close();
    await preview.happyDOM.close();
  });
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const states: boolean[] = [];
  function Shader() {
    const ref = React.useRef<HTMLCanvasElement>(null);
    states.push(usePreviewPaused(ref));
    return React.createElement("canvas", { ref });
  }
  // The component runs in the studio, but renders into the preview's document.
  const container = preview.document.createElement("div");
  preview.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  await React.act(async () => root.render(React.createElement(Shader)));
  assert.equal(states.at(-1), false);

  host.document.documentElement.setAttribute("data-camox-paused", "");
  await React.act(async () => preview.happyDOM.waitUntilComplete());
  assert.equal(states.at(-1), false, "the studio's own document does not count");

  await React.act(async () => {
    preview.document.documentElement.setAttribute("data-camox-paused", "");
    await preview.happyDOM.waitUntilComplete();
  });
  assert.equal(states.at(-1), true, "a paused preview pauses the block");
  await React.act(async () => {
    preview.document.documentElement.removeAttribute("data-camox-paused");
    await preview.happyDOM.waitUntilComplete();
  });
  assert.equal(states.at(-1), false, "and resuming it resumes the block");
  await React.act(async () => root.unmount());
});
