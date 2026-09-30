import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";

import { canvasStore } from "./canvasStore";
import { CanvasWorkspaceContext, useCanvasZoom } from "./canvasZoom";

void test("canvas zoom subscribers update on scale without rerendering for pan", async () => {
  const window = new Window();
  const globals = {
    React,
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(window.document.body as unknown as HTMLElement);
  const workspaceKey = "comment-indicator-zoom";
  let renders = 0;
  function Probe() {
    renders++;
    return <output>{useCanvasZoom()}</output>;
  }

  try {
    await React.act(async () => {
      root.render(
        <CanvasWorkspaceContext value={{ workspaceKey, zoomAt: () => {} }}>
          <Probe />
        </CanvasWorkspaceContext>,
      );
    });
    assert.equal(window.document.querySelector("output")?.textContent, "0.4");

    await React.act(async () => {
      canvasStore.send({
        type: "rememberView",
        workspaceKey,
        view: { camera: { x: 10, y: 20, scale: 0.5 }, fitted: false },
      });
    });
    assert.equal(window.document.querySelector("output")?.textContent, "0.5");
    const rendersAfterZoom = renders;

    await React.act(async () => {
      canvasStore.send({
        type: "rememberView",
        workspaceKey,
        view: { camera: { x: 30, y: 40, scale: 0.5 }, fitted: false },
      });
    });
    assert.equal(renders, rendersAfterZoom);
  } finally {
    await React.act(async () => root.unmount());
    await window.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
