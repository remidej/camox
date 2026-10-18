import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";
import { createRoot } from "react-dom/client";

import { ViewportContinuity, ViewportContinuityContext } from "../preview/viewportContinuity";
import { canvasMinimumScale, fitCanvasPage } from "./canvasCamera";
import { useCanvasCamera } from "./useCanvasCamera";

void test("real camera handoffs snap to the selected page at the preview's reading point", async () => {
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
      targets: [page],
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
    // The camera measures the Page, whose frame sits at its top.
    Object.defineProperty(content.querySelector("[data-canvas-page]")!, "getBoundingClientRect", {
      value: () => ({ top: 84 + read().y, left: 300 + read().x }),
    });
    Object.defineProperties(iframe, { contentDocument: { value: frameWindow.document } });
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
    assert.equal(captured.anchor?.blockId, "42");
    assert.ok(Math.abs(captured.anchor!.offset - 250) < 1e-8);

    // The selected page is always snapped: an exact checkpoint gives only its
    // reading position, and an anchor wins over it.
    const exact = { x: 15, y: -321.25, scale: 0.5 };
    continuity.canvas!.restore(undefined, exact);
    assert.deepEqual(read(), { ...fit, y: (exact.y * fit.scale) / exact.scale });
    continuity.canvas!.restore({ blockId: "42", offset: 600, y: 1600 }, exact);
    assert.equal(read().scale, fit.scale);
    assert.ok(Math.abs(read().y + 1600 * fit.scale) < 1e-8);
    assert.equal(read().x, fit.x);

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
      // Zooming past the floor springs back to it.
      await window.happyDOM.waitUntilComplete();
      animate(32);
      assert.equal(
        read().scale,
        canvasMinimumScale(size, contentSize),
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

void test("showing a warm Canvas lands on the page selected while it was hidden, without a flight", async () => {
  const window = new Window();
  let resize = () => {};
  let animate: FrameRequestCallback | undefined;
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
    cancelAnimationFrame: () => {
      animate = undefined;
    },
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  Object.defineProperty(window, "matchMedia", { value: () => ({ matches: false }) });
  const root = createRoot(window.document.body as unknown as HTMLElement);
  const continuity = new ViewportContinuity();
  const pages = [
    { key: "a", left: 0, width: 1366 },
    { key: "b", left: 1500, width: 1366 },
  ];
  const size = { width: 900, height: 700 };
  function Canvas({ selected }: { selected: string }) {
    const { viewportRef, contentRef } = useCanvasCamera(
      "warm-continuity-test",
      pages.find(({ key }) => key === selected),
      { targets: pages, width: 2866, onSelect: () => {}, selected },
    );
    return (
      <div ref={viewportRef}>
        <div ref={contentRef}>
          <div data-canvas-page="b" data-canvas-pathname="/b" />
        </div>
      </div>
    );
  }
  const render = (selected: string) =>
    React.act(async () =>
      root.render(
        <ViewportContinuityContext value={continuity}>
          <Canvas selected={selected} />
        </ViewportContinuityContext>,
      ),
    );
  try {
    await render("a");
    const viewport = window.document.body.firstElementChild as unknown as HTMLElement;
    const content = viewport.firstElementChild as HTMLElement;
    Object.defineProperties(viewport, {
      clientWidth: { value: size.width },
      clientHeight: { value: size.height },
      getBoundingClientRect: { value: () => ({ top: 0, left: 0 }) },
    });
    Object.defineProperty(content, "offsetHeight", { value: 4000 });
    resize();
    const read = () => ({
      x: parseFloat(viewport.style.getPropertyValue("--canvas-x")),
      y: parseFloat(viewport.style.getPropertyValue("--canvas-y")),
      scale: Number(viewport.style.getPropertyValue("--canvas-zoom")),
    });
    // Navigating while the Canvas is hidden starts a flight that never plays.
    await render("b");
    assert.ok(animate, "the hidden Canvas starts a flight to the new selection");
    const fit = fitCanvasPage(size, pages[1]!);
    continuity.canvas!.restore(undefined, undefined);
    assert.deepEqual(read(), fit);
    // Play whatever frames are still requested.
    const frame = () => animate;
    for (let time = 16; time < 5000; time += 16) frame()?.(time);
    assert.deepEqual(read(), fit, "no flight replays from the previous page");
    assert.equal(continuity.canvas!.capture().pathname, "/b", "hiding again hands over the page");
  } finally {
    await React.act(async () => root.unmount());
    await window.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
