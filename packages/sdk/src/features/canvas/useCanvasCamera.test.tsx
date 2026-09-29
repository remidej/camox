import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { constrainCanvasCamera, fitCanvas, fitCanvasPage } from "./canvasCamera";
import { canvasStore } from "./canvasStore";
import { useCanvasCamera } from "./useCanvasCamera";

void test("page-fit gestures snap, escape, and assist only vertical scrolling without recentering", async () => {
  const dom = new Window({ url: "http://localhost/camox/canvas" });
  const callbacks = new Map<number, FrameRequestCallback>();
  let resize = () => {};
  let sequence = 0;
  let time = 1000;
  const globals = {
    React,
    window: dom,
    document: dom.document,
    Element: dom.Element,
    IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callbacks.set(++sequence, callback);
      return sequence;
    },
    cancelAnimationFrame: (id: number) => callbacks.delete(id),
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  const mount = dom.document.createElement("div");
  dom.document.body.append(mount);
  const root = createRoot(mount as unknown as HTMLElement);
  const size = { width: 900, height: 800 };
  const page = { left: 1606, width: 1366 };
  const sibling = { left: 3212, width: 1366 };
  const selections: string[] = [];
  function Fixture() {
    const { viewportRef, contentRef } = useCanvasCamera("page-fit-gestures", page, {
      pages: [
        { ...page, key: "page" },
        { ...sibling, key: "sibling" },
      ],
      onSelect: (key) => selections.push(key),
    });
    return (
      <div ref={viewportRef}>
        <div ref={contentRef} />
      </div>
    );
  }
  try {
    await act(async () => root.render(<Fixture />));
    const viewport = mount.querySelector("div")!;
    Object.defineProperties(viewport, {
      clientWidth: { get: () => size.width },
      clientHeight: { get: () => size.height },
      getBoundingClientRect: { value: () => ({ left: 0, top: 0 }) },
      setPointerCapture: { value: () => {} },
    });
    Object.defineProperties(viewport.querySelector("div")!, {
      offsetWidth: { get: () => 6000 },
      offsetHeight: { get: () => 30000 },
    });
    resize();
    const read = () => ({
      x: parseFloat(viewport.style.getPropertyValue("--canvas-x")),
      y: parseFloat(viewport.style.getPropertyValue("--canvas-y")),
      scale: Number(viewport.style.getPropertyValue("--canvas-zoom")),
    });
    const flush = (check = () => {}) => {
      for (let count = 0; callbacks.size && count < 100; count++) {
        const batch = [...callbacks.values()];
        callbacks.clear();
        batch.forEach((callback) => callback(count * 16 + 16));
        assert.equal(
          viewport.style.getPropertyValue("--canvas-overlays-display"),
          read().scale < 0.3 ? "none" : "block",
        );
        check();
      }
      assert.equal(callbacks.size, 0);
    };
    const wheel = (
      dx: number,
      dy: number,
      modifiers: { ctrlKey?: boolean; shiftKey?: boolean } = {},
    ) => {
      const event = new dom.MouseEvent("wheel", {
        clientX: 400,
        clientY: 300,
        cancelable: true,
        ...modifiers,
      });
      time += 16;
      Object.defineProperties(event, {
        deltaX: { value: dx },
        deltaY: { value: dy },
        deltaMode: { value: 0 },
        timeStamp: { value: time },
      });
      viewport.dispatchEvent(event);
      assert.equal(event.defaultPrevented, true);
    };
    const pan = (
      dx: number,
      dy: number,
      expectedX: number,
      expectedY: number,
      shiftKey = false,
    ) => {
      const before = read();
      wheel(dx, dy, { shiftKey });
      flush();
      assert.ok(Math.abs(read().x - (before.x - expectedX)) < 1e-8);
      assert.ok(Math.abs(read().y - (before.y - expectedY)) < 1e-8);
    };
    const fitted = read();
    pan(10, 90, 0, 90);
    pan(10, 90, 0, 90);
    pan(60, 90, 0, 90); // Wider release band tolerates substantial drift.
    pan(3, 1, 0, 1); // Low-magnitude startup/tail noise does not release.
    pan(60, 60, 60, 60); // Diagonal intent releases the vertical rail immediately.
    pan(10, 90, 10, 90); // Its momentum tail remains free.
    time += 200;
    pan(90, 10, 90, 10); // Never lock horizontally.
    pan(3, 20, 3, 20); // A horizontal gesture's mostly vertical tail remains free.
    time += 200;
    pan(3, 0.5, 3, 0.5); // Noisy startup stays undecided, not permanently free.
    pan(-2, 4, -2, 4);
    pan(4, 16, 0, 16); // Magnitude-weighted evidence engages within 32ms.
    pan(40, 70, 0, 70);
    pan(6, 6, 0, 6);
    pan(6, 6, 0, 6);
    pan(6, 6, 6, 6); // Sustained low-amplitude diagonal input releases too.
    pan(1, 12, 1, 12);
    time += 200;
    pan(10, 90, 0, 90); // A new vertical gesture can acquire the rail.
    pan(0, 40, 40, 0, true); // Explicit Shift-scroll bypasses it.
    pan(10, 90, 10, 90); // Releasing Shift cannot lock the same gesture's tail.
    time += 200;
    pan(10, 90, 10, 90, true); // Shift also bypasses with native two-axis input.

    const beforeDrag = read();
    const pointer = (type: string, pointerId: number, clientX: number, clientY: number) => {
      const event = new dom.PointerEvent(type, { pointerId, button: 0, clientX, clientY });
      time += 16;
      Object.defineProperty(event, "timeStamp", { value: time });
      viewport.dispatchEvent(event);
    };
    pointer("pointerdown", 1, 400, 300);
    pointer("pointermove", 1, 390, 210);
    viewport.dispatchEvent(new dom.PointerEvent("pointerup", { pointerId: 1 }));
    assert.equal(read().x, beforeDrag.x - 10);
    assert.equal(read().y, beforeDrag.y - 90);

    assert.deepEqual(selections, [], "ordinary pan never selects");
    const partial = read();
    wheel(0, -1, { ctrlKey: true });
    flush();
    assert.ok(read().scale > partial.scale, "a partial-width page cannot capture the detent");
    assert.deepEqual(selections, []);
    // Restore the fit scale without a eligible page, then bring it wholly into view.
    time += 200;
    wheel(0, 1, { ctrlKey: true });
    flush();
    assert.ok(Math.abs(read().scale - fitted.scale) < 1e-8);
    pointer("pointerdown", 1, 400, 300);
    pointer("pointermove", 1, 400 + fitted.x + 10 - read().x, 300);
    pointer("pointerup", 1, 400, 300);
    const beforeSnap = read();
    wheel(0, -1, { ctrlKey: true });
    flush();
    assert.deepEqual(selections, ["page"]);
    assert.equal(read().x, fitted.x, "snap entry centers horizontally");
    assert.equal(read().y, beforeSnap.y, "entry retains vertical reading position");
    // Horizontal panning within visibility does not repeatedly center/select.
    pan(10, 0, 10, 0);
    const beforeZoom = read();
    const checkAnchor = () => {
      const next = read();
      assert.ok(
        Math.abs((400 - next.x) / next.scale - (400 - beforeZoom.x) / beforeZoom.scale) < 1e-8,
      );
      assert.ok(
        Math.abs((300 - next.y) / next.scale - (300 - beforeZoom.y) / beforeZoom.scale) < 1e-8,
      );
    };
    for (let count = 0; count < 8; count++) wheel(0, -1, { ctrlKey: true });
    flush(checkAnchor);
    assert.deepEqual(read(), beforeZoom, "small zoom input is held without recentering");
    assert.deepEqual(selections, ["page"], "held snap never repeats selection");
    for (let count = 0; count < 8; count++) wheel(0, -1, { ctrlKey: true });
    flush(checkAnchor);
    assert.ok(read().scale > fitted.scale, "accumulated gentle input escapes");
    pan(10, 90, 10, 90); // Outside snap, even overwhelmingly vertical motion is free.

    wheel(0, 14, { ctrlKey: true }); // Page is wider than viewport: no capture from above.
    flush();
    assert.notEqual(read().scale, fitted.scale);
    assert.deepEqual(selections, ["page"]);
    wheel(0, 40, { ctrlKey: true });
    flush();
    assert.ok(read().scale < fitted.scale, "strong input passes through the detent");
    time += 200;
    wheel(0, -40, { ctrlKey: true });
    flush();
    assert.equal(read().scale, fitted.scale, "capture also works from below");
    assert.equal(read().x, fitted.x);
    assert.deepEqual(selections, ["page", "page"]);

    const beforeSibling = read();
    pan(
      (sibling.left - page.left) * fitted.scale - 10,
      0,
      (sibling.left - page.left) * fitted.scale - 10,
      0,
    );
    assert.deepEqual(selections, ["page", "page"], "panning to a sibling does not select");
    wheel(0, -1, { ctrlKey: true });
    flush();
    assert.equal(read().x, fitCanvasPage(size, sibling).x);
    assert.equal(read().y, beforeSibling.y);
    assert.deepEqual(selections, ["page", "page", "sibling"]);

    pan(
      -(sibling.left - page.left) * fitted.scale,
      0,
      -(sibling.left - page.left) * fitted.scale,
      0,
    );
    const beforeTouchSnap = read();
    pointer("pointerdown", 1, 300, 300);
    pointer("pointerdown", 2, 500, 300);
    pointer("pointermove", 2, 502, 300);
    assert.equal(read().x, fitted.x, "touch entry centers without the pinch translation offset");
    assert.equal(read().y, beforeTouchSnap.y);
    assert.deepEqual(selections, ["page", "page", "sibling", "page"]);
    pointer("pointerup", 1, 300, 300);
    pointer("pointerup", 2, 502, 300);

    const beforePinch = read();
    pointer("pointerdown", 1, 300, 300);
    pointer("pointerdown", 2, 500, 300);
    for (let step = 1; step <= 14; step++) {
      pointer("pointermove", 2, 500 + step * 2, 300);
      if (step < 12) assert.equal(read().scale, fitted.scale);
      const next = read();
      assert.ok(
        Math.abs((400 + step - next.x) / next.scale - (400 - beforePinch.x) / beforePinch.scale) <
          1e-8,
      );
      assert.ok(
        Math.abs((300 - next.y) / next.scale - (300 - beforePinch.y) / beforePinch.scale) < 1e-8,
      );
    }
    assert.ok(read().scale > fitted.scale, "touch pinch accumulates small movements too");
    pointer("pointerup", 1, 300, 300);
    pointer("pointerup", 2, 528, 300);

    wheel(0, -10000, { ctrlKey: true });
    flush();
    assert.equal(read().scale, 2);
    wheel(0, 1, { ctrlKey: true });
    flush();
    assert.ok(read().scale < 2, "zoom limit does not retain excess intended input");
  } finally {
    await act(async () => root.unmount());
    await dom.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

void test("the default camera fits the selected page through loading and viewport resizing", async () => {
  const dom = new Window({ url: "http://localhost/camox/canvas/about" });
  let resize = () => {};
  const globals = {
    React,
    window: dom,
    document: dom.document,
    Element: dom.Element,
    IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
    cancelAnimationFrame: () => {},
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  const mount = dom.document.createElement("div");
  dom.document.body.append(mount);
  const root = createRoot(mount as unknown as HTMLElement);
  const page = { left: 1606, width: 1366 };
  const size = { width: 900, height: 800 };
  let height = 900;
  function Fixture() {
    const { viewportRef, contentRef } = useCanvasCamera("initial-selected-page", page);
    return (
      <div ref={viewportRef}>
        <div ref={contentRef} />
      </div>
    );
  }
  try {
    await act(async () => root.render(<Fixture />));
    const viewport = mount.querySelector("div")!;
    Object.defineProperties(viewport, {
      clientWidth: { get: () => size.width },
      clientHeight: { get: () => size.height },
    });
    Object.defineProperties(viewport.querySelector("div")!, {
      offsetWidth: { get: () => 4578 },
      offsetHeight: { get: () => height },
    });
    const assertCamera = () => {
      const expected = fitCanvasPage(size, page);
      assert.equal(parseFloat(viewport.style.getPropertyValue("--canvas-x")), expected.x);
      assert.equal(parseFloat(viewport.style.getPropertyValue("--canvas-y")), expected.y);
      assert.equal(Number(viewport.style.getPropertyValue("--canvas-zoom")), expected.scale);
    };
    resize();
    assertCamera();
    height = 30000;
    resize();
    assertCamera();
    size.width = 1100;
    resize();
    assertCamera();
    assert.equal(canvasStore.getSnapshot().context.views["initial-selected-page"], undefined);
  } finally {
    await act(async () => root.unmount());
    await dom.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

void test("canvas gestures own the camera, reveal keyboard controls, and clean up animation", async () => {
  const dom = new Window({ url: "http://localhost/camox/canvas" });
  const callbacks = new Map<number, FrameRequestCallback>();
  let resized = () => {};
  let disconnected = false;
  const observed = new Set<Element>();
  const viewportSize = { width: 1200, height: 800 };
  const contentSize = { width: 6000, height: 3000 };
  let sequence = 0;
  const globals = {
    React,
    window: dom,
    document: dom.document,
    Element: dom.Element,
    IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe(element: Element) {
        observed.add(element);
      }
      disconnect() {
        disconnected = true;
      }
    },
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callbacks.set(++sequence, callback);
      return sequence;
    },
    cancelAnimationFrame: (id: number) => callbacks.delete(id),
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  const rootStyle = dom.document.documentElement.style;
  rootStyle.setProperty("overscroll-behavior-x", "contain", "important");
  const mount = dom.document.createElement("div");
  dom.document.body.append(mount);
  const root = createRoot(mount as unknown as HTMLElement);
  let time = 0;
  const flush = (afterFrame = () => {}) => {
    for (let count = 0; callbacks.size && count < 100; count++) {
      const batch = [...callbacks.values()];
      callbacks.clear();
      time += 16;
      batch.forEach((callback) => callback(time));
      afterFrame();
    }
    assert.equal(callbacks.size, 0, "camera animation settles");
  };
  function Fixture() {
    const { viewportRef, contentRef } = useCanvasCamera("camera-gestures");
    return (
      <div ref={viewportRef} tabIndex={0}>
        <div ref={contentRef} />
        <input aria-label="Instance" />
        <button type="button">
          <span>Page name</span>
        </button>
      </div>
    );
  }

  try {
    await act(async () => root.render(<Fixture />));
    assert.equal(rootStyle.getPropertyValue("overscroll-behavior-x"), "none");
    const outsideSwipe = () => {
      const event = new dom.WheelEvent("wheel", {
        deltaX: -120,
        bubbles: true,
        cancelable: true,
      });
      dom.document.body.dispatchEvent(event);
      return event;
    };
    assert.equal(
      outsideSwipe().defaultPrevented,
      true,
      "horizontal gestures starting outside the viewport cannot trigger browser history",
    );
    const verticalScroll = new dom.WheelEvent("wheel", {
      deltaY: 120,
      bubbles: true,
      cancelable: true,
    });
    dom.document.body.dispatchEvent(verticalScroll);
    assert.equal(
      verticalScroll.defaultPrevented,
      false,
      "other UI keeps native vertical scrolling",
    );
    const viewport = mount.querySelector("div")!;
    Object.defineProperties(viewport, {
      clientWidth: { get: () => viewportSize.width },
      clientHeight: { get: () => viewportSize.height },
      getBoundingClientRect: { value: () => ({ left: 0, top: 0, right: 1200, bottom: 800 }) },
      setPointerCapture: { value: () => {} },
    });
    Object.defineProperties(viewport.querySelector("div")!, {
      offsetWidth: { get: () => contentSize.width },
      offsetHeight: { get: () => contentSize.height },
    });
    resized();
    assert.equal(observed.size, 2, "both the viewport and full document extent are observed");
    const style = viewport.style;
    const initialScale = Number(style.getPropertyValue("--canvas-zoom"));
    assert.equal(initialScale, fitCanvas(viewportSize, contentSize).scale);
    const initialX = parseFloat(style.getPropertyValue("--canvas-x"));
    const anchor = (500 - initialX) / initialScale;
    const anchorY = (300 - parseFloat(style.getPropertyValue("--canvas-y"))) / initialScale;
    // happy-dom's WheelEvent omits MouseEvent coordinates/modifiers.
    const wheel = new dom.MouseEvent("wheel", {
      clientX: 500,
      clientY: 300,
      ctrlKey: true,
      cancelable: true,
    });
    Object.defineProperties(wheel, {
      deltaX: { value: 0 },
      deltaY: { value: -50 },
      deltaMode: { value: 0 },
    });
    viewport.dispatchEvent(wheel);
    assert.equal(wheel.defaultPrevented, true);
    flush(() => {
      const currentScale = Number(style.getPropertyValue("--canvas-zoom"));
      const currentX = parseFloat(style.getPropertyValue("--canvas-x"));
      const currentY = parseFloat(style.getPropertyValue("--canvas-y"));
      assert.ok(Math.abs((500 - currentX) / currentScale - anchor) < 0.0001);
      assert.ok(Math.abs((300 - currentY) / currentScale - anchorY) < 0.0001);
    });
    const scale = Number(style.getPropertyValue("--canvas-zoom"));
    const x = parseFloat(style.getPropertyValue("--canvas-x"));
    assert.ok(scale > initialScale);
    assert.ok(Math.abs((500 - x) / scale - anchor) < 0.0001);

    const input = viewport.querySelector("input")!;
    const inputWheel = new dom.WheelEvent("wheel", {
      deltaY: 100,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(inputWheel);
    assert.equal(
      inputWheel.defaultPrevented,
      true,
      "wheel gestures over controls belong to the canvas",
    );

    Object.defineProperty(input, "getBoundingClientRect", {
      value: () => ({ left: 1100, top: 20, right: 1300, bottom: 48 }),
    });
    input.dispatchEvent(new dom.FocusEvent("focusin", { bubbles: true }));
    assert.equal(parseFloat(style.getPropertyValue("--canvas-x")), x - 116);
    assert.equal(viewport.scrollLeft, 0, "focus uses the camera rather than native scrolling");

    const pageName = viewport.querySelector("button span")!;
    const beforeSwipe = parseFloat(style.getPropertyValue("--canvas-x"));
    for (const deltaX of [20, 100_000, 100_000, -100_000, -100_000]) {
      const swipe = new dom.WheelEvent("wheel", {
        deltaX,
        deltaY: 0,
        bubbles: true,
        cancelable: true,
      });
      pageName.dispatchEvent(swipe);
      assert.equal(swipe.defaultPrevented, true, "swipes stay consumed at both camera bounds");
      flush();
      if (deltaX === 20)
        assert.equal(parseFloat(style.getPropertyValue("--canvas-x")), beforeSwipe - 20);
    }

    contentSize.height = 30000;
    resized();
    assert.equal(
      Number(style.getPropertyValue("--canvas-zoom")),
      scale,
      "content growth preserves a zoomed-in view",
    );
    viewport.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Home" }));
    flush();
    assert.equal(
      Number(style.getPropertyValue("--canvas-zoom")),
      fitCanvas(viewportSize, contentSize).scale,
    );
    assert.ok(
      Number(style.getPropertyValue("--canvas-zoom")) < 0.05,
      "very tall pages can fit below 5%",
    );
    contentSize.height = 6000;
    viewportSize.width = 1000;
    resized();
    assert.equal(
      Number(style.getPropertyValue("--canvas-zoom")),
      fitCanvas(viewportSize, contentSize).scale,
      "overview follows document and viewport resizing",
    );

    const beforeKey = style.getPropertyValue("--canvas-zoom");
    input.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "-", bubbles: true }));
    assert.equal(
      style.getPropertyValue("--canvas-zoom"),
      beforeKey,
      "typing cannot zoom the canvas",
    );
    viewport.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "-" }));
    assert.ok(callbacks.size > 0);
    await act(async () => root.unmount());
    assert.equal(rootStyle.getPropertyValue("overscroll-behavior-x"), "contain");
    assert.equal(rootStyle.getPropertyPriority("overscroll-behavior-x"), "important");
    assert.equal(outsideSwipe().defaultPrevented, false, "leaving canvas restores native gestures");
    assert.equal(callbacks.size, 0, "unmount cancels the outstanding animation");
    assert.equal(disconnected, true, "unmount disconnects size observation");
    viewport.dispatchEvent(wheel);
    assert.equal(callbacks.size, 0, "unmount removes gesture handlers");
  } finally {
    await act(async () => root.unmount());
    await dom.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

void test("workspace cameras survive route remounts and delayed iframe sizing", async () => {
  const dom = new Window({ url: "http://localhost/camox/canvas" });
  const viewportSize = { width: 1200, height: 800 };
  const contentSize = { width: 6000, height: 30000 };
  const callbacks = new Map<number, FrameRequestCallback>();
  let sequence = 0;
  let time = 0;
  let resized = () => {};
  const globals = {
    React,
    window: dom,
    document: dom.document,
    Element: dom.Element,
    IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callbacks.set(++sequence, callback);
      return sequence;
    },
    cancelAnimationFrame: (id: number) => callbacks.delete(id),
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  const mount = dom.document.createElement("div");
  dom.document.body.append(mount);
  const root = createRoot(mount as unknown as HTMLElement);
  const tick = () => {
    const batch = [...callbacks.values()];
    callbacks.clear();
    time += 16;
    batch.forEach((callback) => callback(time));
  };
  const flush = () => {
    for (let count = 0; callbacks.size && count < 100; count++) tick();
    assert.equal(callbacks.size, 0);
  };
  function Fixture({ workspaceKey }: { workspaceKey: string }) {
    const { viewportRef, contentRef } = useCanvasCamera(workspaceKey);
    React.useLayoutEffect(() => {
      Object.defineProperties(viewportRef.current!, {
        clientWidth: { configurable: true, get: () => viewportSize.width },
        clientHeight: { configurable: true, get: () => viewportSize.height },
      });
      Object.defineProperties(contentRef.current!, {
        offsetWidth: { configurable: true, get: () => contentSize.width },
        offsetHeight: { configurable: true, get: () => contentSize.height },
      });
    }, [viewportRef, contentRef]);
    return (
      <div ref={viewportRef}>
        <div ref={contentRef} />
      </div>
    );
  }
  const render = async (workspaceKey: string | null) => {
    await act(async () =>
      root.render(
        workspaceKey ? (
          <React.StrictMode>
            <Fixture workspaceKey={workspaceKey} />
          </React.StrictMode>
        ) : null,
      ),
    );
  };
  const read = () => {
    const style = mount.querySelector("div")!.style;
    return {
      x: parseFloat(style.getPropertyValue("--canvas-x")),
      y: parseFloat(style.getPropertyValue("--canvas-y")),
      scale: Number(style.getPropertyValue("--canvas-zoom")),
    };
  };
  const key = (value: string) =>
    mount.querySelector("div")!.dispatchEvent(new dom.KeyboardEvent("keydown", { key: value }));

  try {
    await render("restore-a");
    assert.deepEqual(read(), fitCanvas(viewportSize, contentSize));
    key("0");
    flush();
    key("ArrowDown");
    flush();
    key("ArrowRight");
    flush();
    for (let step = 0; step < 10; step++) {
      key("-");
      flush();
    }
    key("-");
    tick();
    const saved = read();
    assert.ok(callbacks.size > 0, "leave partway through an animation");
    await render(null);
    assert.equal(callbacks.size, 0);
    assert.deepEqual(canvasStore.getSnapshot().context.views["restore-a"]?.camera, saved);

    contentSize.height = 900;
    assert.ok(saved.scale < fitCanvas(viewportSize, contentSize).scale);
    await render("restore-a");
    assert.deepEqual(read(), constrainCanvasCamera(saved, viewportSize, contentSize));
    await render(null);
    assert.deepEqual(
      canvasStore.getSnapshot().context.views["restore-a"]?.camera,
      saved,
      "leaving before iframe loading finishes cannot overwrite the remembered view",
    );
    await render("restore-a");
    contentSize.height = 30000;
    resized();
    assert.deepEqual(read(), saved, "full iframe heights restore the original zoom and pan");

    viewportSize.width = 800;
    viewportSize.height = 600;
    resized();
    assert.deepEqual(read(), constrainCanvasCamera(saved, viewportSize, contentSize));

    key("Home");
    flush();
    await render(null);
    contentSize.height = 900;
    await render("restore-a");
    assert.deepEqual(read(), fitCanvas(viewportSize, contentSize));
    contentSize.height = 10000;
    resized();
    assert.deepEqual(read(), fitCanvas(viewportSize, contentSize), "saved overview stays fitted");

    key("0");
    flush();
    const updated = read();
    await render("restore-b");
    assert.deepEqual(
      read(),
      fitCanvas(viewportSize, contentSize),
      "another workspace starts fresh",
    );
    await render("restore-a");
    assert.deepEqual(read(), updated, "switching workspace keys also restores the saved camera");

    contentSize.height = 900;
    resized();
    key("ArrowDown");
    flush();
    const userView = read();
    contentSize.height = 10000;
    resized();
    assert.deepEqual(
      read(),
      constrainCanvasCamera(userView, viewportSize, contentSize),
      "new input takes precedence over restoration during loading",
    );
  } finally {
    await act(async () => root.unmount());
    await dom.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
