import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";
import { createRoot } from "react-dom/client";

import { ViewportContinuity, ViewportContinuityContext } from "../preview/viewportContinuity";
import { fitCanvas, fitCanvasPage } from "./canvasCamera";
import { useCanvasCamera } from "./useCanvasCamera";

void test("real camera handoffs use held snaps, preserve exact overview returns, and accept moved preview anchors", async () => {
  const window = new Window();
  const frameWindow = new Window();
  let resize = () => {};
  let animate: FrameRequestCallback = () => {};
  const globals = {
    React,
    window,
    document: window.document,
    Element: window.Element,
    IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      animate = callback;
      return 1;
    },
    cancelAnimationFrame: () => {},
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  Object.defineProperty(window, "matchMedia", { value: () => ({ matches: true }) });
  const root = createRoot(window.document.body as unknown as HTMLElement);
  const continuity = new ViewportContinuity();
  const page = { key: "page", left: 0, width: 1366 };
  const size = { width: 900, height: 700 };
  const contentSize = { width: 1366, height: 8000 };
  function Canvas() {
    const { viewportRef, contentRef } = useCanvasCamera("continuity-test", page, {
      pages: [page],
      onSelect: () => {},
    });
    return (
      <div ref={viewportRef}>
        <div ref={contentRef}>
          <div data-canvas-page="page" data-canvas-pathname="/a">
            <iframe title="fixture" />
          </div>
        </div>
      </div>
    );
  }
  try {
    await React.act(async () =>
      root.render(
        <ViewportContinuityContext value={continuity}>
          <Canvas />
        </ViewportContinuityContext>,
      ),
    );
    const viewport = window.document.body.firstElementChild as unknown as HTMLElement;
    const content = viewport.firstElementChild as HTMLElement;
    const iframe = content.querySelector("iframe")!;
    const read = () => ({
      x: parseFloat(viewport.style.getPropertyValue("--canvas-x")),
      y: parseFloat(viewport.style.getPropertyValue("--canvas-y")),
      scale: Number(viewport.style.getPropertyValue("--canvas-zoom")),
    });
    Object.defineProperties(viewport, {
      clientWidth: { value: size.width },
      clientHeight: { value: size.height },
      getBoundingClientRect: { value: () => ({ top: 84, left: 300 }) },
    });
    Object.defineProperties(content, {
      offsetWidth: { get: () => contentSize.width },
      offsetHeight: { get: () => contentSize.height },
    });
    Object.defineProperties(iframe, {
      contentDocument: { value: frameWindow.document },
      getBoundingClientRect: { value: () => ({ top: 84 + read().y, left: 300 + read().x }) },
    });
    frameWindow.document.body.innerHTML = '<div data-camox-viewport-block="42"></div>';
    Object.defineProperty(frameWindow.document.body.firstElementChild, "getBoundingClientRect", {
      value: () => ({ top: 1000, bottom: 3000, height: 2000 }),
    });
    resize();
    const fit = fitCanvasPage(size, page);
    continuity.canvas!.restore({ blockId: "42", offset: 250, y: 1250 }, undefined);
    assert.equal(read().scale, fit.scale);
    assert.ok(Math.abs(read().y + 1250 * fit.scale) < 1e-8);
    const captured = continuity.canvas!.capture();
    assert.equal(captured.pathname, "/a");
    assert.equal(captured.snappedKey, "page");
    assert.equal(captured.anchor?.blockId, "42");
    assert.ok(Math.abs(captured.anchor!.offset - 250) < 1e-8);

    // Being visibly close to a page is not enough: an exact unsnapped camera
    // checkpoint must not silently acquire a detent during restoration.
    continuity.canvas!.restore(undefined, read(), undefined);
    assert.equal(continuity.canvas!.capture().anchor, undefined);
    const exact = { x: 15, y: -321.25, scale: 0.5 };
    continuity.canvas!.restore(undefined, exact);
    assert.deepEqual(read(), exact);
    continuity.canvas!.restore({ blockId: "42", offset: 600, y: 1600 }, exact);
    assert.equal(read().scale, exact.scale);
    assert.equal(read().y, -800);
    assert.equal(read().x, size.width / 2 - (page.width / 2) * exact.scale);

    // Iframes can publish their full height synchronously during restoration,
    // before the observer delivers the already-consumed geometry change.
    for (const observeBeforeZoom of [false, true]) {
      contentSize.height = 768;
      resize();
      contentSize.height = 8000;
      continuity.canvas!.restore({ blockId: "42", offset: 250, y: 1250 }, undefined);
      if (observeBeforeZoom) resize();
      const wheel = new window.MouseEvent("wheel", {
        ctrlKey: true,
        clientX: 750,
        clientY: 434,
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperties(wheel, {
        deltaX: { value: 0 },
        deltaY: { value: 10000 },
        deltaMode: { value: 0 },
      });
      viewport.dispatchEvent(wheel as unknown as Event);
      animate(16);
      assert.equal(
        read().scale,
        fitCanvas(size, contentSize).scale,
        `restoration refreshes the zoom floor ${observeBeforeZoom ? "after" : "before"} observer delivery`,
      );
    }
  } finally {
    await React.act(async () => root.unmount());
    await window.happyDOM.close();
    await frameWindow.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
