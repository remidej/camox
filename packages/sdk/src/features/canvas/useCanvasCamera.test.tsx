import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { constrainCanvasCamera, fitCanvas } from "./canvasCamera";
import { canvasStore } from "./canvasStore";
import { useCanvasCamera } from "./useCanvasCamera";

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
      </div>
    );
  }

  try {
    await act(async () => root.render(<Fixture />));
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
      false,
      "normal scrolling on controls is not intercepted",
    );

    Object.defineProperty(input, "getBoundingClientRect", {
      value: () => ({ left: 1100, top: 20, right: 1300, bottom: 48 }),
    });
    input.dispatchEvent(new dom.FocusEvent("focusin", { bubbles: true }));
    assert.equal(parseFloat(style.getPropertyValue("--canvas-x")), x - 116);
    assert.equal(viewport.scrollLeft, 0, "focus uses the camera rather than native scrolling");

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
