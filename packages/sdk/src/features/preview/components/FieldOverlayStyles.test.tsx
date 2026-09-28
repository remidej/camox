import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";

const css = readFileSync(new URL("../studio-overlays.css", import.meta.url), "utf8");
registerHooks({
  resolve(specifier, context, nextResolve) {
    let source: string | undefined;
    if (specifier === "@camox/ui/toaster") source = "export const toast = () => {}";
    if (specifier === "virtual:camox-overlay-css") source = `export default ${JSON.stringify(css)}`;
    if (context.parentURL?.endsWith("/FieldOverlayStyles.tsx") && specifier === "./Frame")
      source = "export const useFrame = () => React.useContext(globalThis.TestFrameContext)";
    if (source)
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

void test("edit mode disables all nested iframes, not selection wrappers or the outer page frame", async () => {
  const host = new Window();
  const page = new Window();
  const TestFrameContext = React.createContext({ window: page });
  const globals = {
    React,
    window: host,
    document: host.document,
    TestFrameContext,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  const { createRoot } = await import("react-dom/client");
  const { FieldOverlayStyles } = await import("./FieldOverlayStyles");
  const { previewStore } = await import("../previewStore");
  host.document.body.innerHTML = "<iframe></iframe>";
  page.document.body.innerHTML = `
    <div data-camox-field-type="embed"><iframe></iframe></div>
    <iframe id="raw"></iframe>`;
  const root = createRoot(page.document.head as unknown as HTMLElement);
  const pointerEvents = (element: Parameters<typeof page.getComputedStyle>[0]) =>
    page.getComputedStyle(element).pointerEvents;
  const wrapper = page.document.querySelector("[data-camox-field-type]")!;
  const embedded = wrapper.querySelector("iframe")!;
  const raw = page.document.getElementById("raw")!;
  const frameRoot = page.document.documentElement;
  previewStore.send({ type: "exitEditMode" });
  try {
    await React.act(async () => root.render(<FieldOverlayStyles />));
    assert.equal(frameRoot.hasAttribute("data-camox-edit-mode"), false);
    await React.act(async () => previewStore.send({ type: "enterEditMode" }));
    assert.equal(frameRoot.hasAttribute("data-camox-edit-mode"), true);
    assert.equal(pointerEvents(embedded), "none");
    assert.equal(pointerEvents(raw), "none");
    assert.notEqual(pointerEvents(wrapper), "none");
    assert.notEqual(
      host.getComputedStyle(host.document.querySelector("iframe")!).pointerEvents,
      "none",
    );
    assert.equal(host.document.documentElement.hasAttribute("data-camox-edit-mode"), false);

    // CSS also covers widgets mounted after editing is enabled, without an observer.
    const late = page.document.createElement("iframe");
    page.document.body.appendChild(late);
    assert.equal(pointerEvents(late), "none");
    await React.act(async () => previewStore.send({ type: "exitEditMode" }));
    assert.equal(frameRoot.hasAttribute("data-camox-edit-mode"), false);
    await React.act(async () => previewStore.send({ type: "enterEditMode" }));
    await React.act(async () => root.unmount());
    assert.equal(frameRoot.hasAttribute("data-camox-edit-mode"), false);
  } finally {
    await React.act(async () => root.unmount());
    previewStore.send({ type: "exitEditMode" });
    await page.happyDOM.close();
    await host.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
