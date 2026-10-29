import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

import {
  CANVAS_WHEEL_ZOOM_RATE,
  canvasOverview,
  constrainCanvasCamera,
  fitCanvas,
  fitCanvasPage,
  MIN_CANVAS_ZOOM,
  PAN_SNAP_CAPTURE,
  PAN_SNAP_RELEASE,
  ZOOM_SNAP_CAPTURE,
  ZOOM_SNAP_RELEASE,
  ZOOM_STRETCH,
} from "./canvasCamera";
import { canvasStore } from "./canvasStore";
import { useCanvasCamera } from "./useCanvasCamera";

void test("navigation flights zoom out, arrive at page fit, and yield to direct camera input", async () => {
  const dom = new Window({ url: "http://localhost/camox/canvas" });
  const callbacks = new Map<number, FrameRequestCallback>();
  const media = { matches: false };
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
  Object.defineProperty(dom, "matchMedia", { value: () => media });
  const mount = dom.document.createElement("div");
  dom.document.body.append(mount);
  const root = createRoot(mount as unknown as HTMLElement);
  const size = { width: 900, height: 800 };
  const content = { width: 8000, height: 12000 };
  const initial = { key: "initial", left: 1606, width: 1366 };
  const destination = { key: "destination", left: 6424, width: 1366 };
  const middle = { key: "middle", left: 3212, width: 1366 };
  let flightPages = [initial, middle, destination];
  const selections: string[] = [];
  let controls!: ReturnType<typeof useCanvasCamera>;
  let unmounted = false;
  function Fixture() {
    controls = useCanvasCamera("navigation-flight", initial, {
      targets: flightPages,
      onSelect: (key) => selections.push(key),
    });
    return (
      <div ref={controls.viewportRef}>
        <div ref={controls.contentRef} />
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
      offsetWidth: { get: () => content.width },
      offsetHeight: { get: () => content.height },
    });
    resize();
    const read = () => ({
      x: parseFloat(viewport.style.getPropertyValue("--canvas-x")),
      y: parseFloat(viewport.style.getPropertyValue("--canvas-y")),
      scale: Number(viewport.style.getPropertyValue("--canvas-zoom")),
    });
    const tick = (elapsed = 16) => {
      time += elapsed;
      const batch = [...callbacks.values()];
      callbacks.clear();
      batch.forEach((callback) => callback(time));
    };
    const flush = (check = () => {}) => {
      for (let count = 0; callbacks.size && count < 200; count++) {
        tick();
        check();
      }
      assert.equal(callbacks.size, 0);
    };
    const fit = (page: { left: number; width: number }) =>
      constrainCanvasCamera(fitCanvasPage(size, page), size, content);
    const start = read();
    assert.deepEqual(start, fit(initial), "initial mount does not fly");
    assert.equal(callbacks.size, 0);
    const moving = () => !!canvasStore.getSnapshot().context.moving["navigation-flight"];
    assert.equal(moving(), false, "placing the camera is not moving it");
    const fly = controls.flyTo;
    await act(async () => root.render(<Fixture />));
    assert.equal(controls.flyTo, fly, "navigation callback is stable across renders");
    controls.flyTo(destination.key);
    assert.deepEqual(read(), start, "flight starts from the painted camera without jumping");
    let minimumScale = start.scale;
    flush(() => {
      minimumScale = Math.min(minimumScale, read().scale);
      assert.deepEqual(constrainCanvasCamera(read(), size, content), read());
    });
    assert.ok(minimumScale < start.scale, "far navigation zooms out before arriving");
    assert.deepEqual(read(), fit(destination));
    assert.deepEqual(selections, [], "flight never triggers snap-driven navigation");
    assert.deepEqual(
      canvasStore.getSnapshot().context.views["navigation-flight"]?.camera,
      read(),
      "arrival is remembered",
    );
    assert.equal(moving(), true, "the camera is moving right after it flies");
    await new Promise((resolve) => dom.setTimeout(resolve, 300));
    assert.equal(moving(), false, "until it settles");

    controls.flyTo(initial.key);
    tick();
    tick(250);
    const halfway = read();
    controls.flyTo(middle.key);
    assert.deepEqual(read(), halfway, "new navigation retargets from the current painted view");
    flush();
    assert.deepEqual(read(), fit({ left: 3212, width: 1366 }));

    for (const input of ["wheel", "keyboard", "pointer"] as const) {
      controls.flyTo(destination.key);
      tick();
      tick(250);
      const before = read();
      let expected = before;
      if (input === "wheel") {
        const event = new dom.MouseEvent("wheel", { cancelable: true });
        Object.defineProperties(event, {
          deltaX: { value: 27 },
          deltaY: { value: 30 },
          deltaMode: { value: 0 },
          timeStamp: { value: time },
        });
        viewport.dispatchEvent(event);
        expected = constrainCanvasCamera(
          { ...before, x: before.x - 27, y: before.y - 30 },
          size,
          content,
        );
      }
      if (input === "keyboard") {
        viewport.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "ArrowDown" }));
        expected = constrainCanvasCamera({ ...before, y: before.y - 100 }, size, content);
      }
      if (input === "pointer") {
        const space = (type: string) =>
          dom.document.body.dispatchEvent(
            new dom.KeyboardEvent(type, { code: "Space", key: " ", bubbles: true }),
          );
        const press = () => {
          viewport.dispatchEvent(new dom.PointerEvent("pointerdown", { pointerId: 1, button: 0 }));
          viewport.dispatchEvent(new dom.PointerEvent("pointerup", { pointerId: 1, button: 0 }));
        };
        press();
        tick(400);
        assert.notDeepEqual(read(), before, "a plain click on the background is not a drag");
        assert.equal(viewport.dataset.canvasPan, undefined);
        space("keydown");
        assert.equal(viewport.dataset.canvasPan, "ready", "Space arms the hand tool");
        press();
        space("keyup");
        assert.equal(viewport.dataset.canvasPan, undefined);
        expected = read();
      }
      flush();
      assert.deepEqual(read(), expected, `${input} interrupts without jumping to the destination`);
      assert.notDeepEqual(read(), fit(destination));
    }

    controls.flyTo(destination.key);
    tick();
    tick(200);
    size.width = 1000;
    content.height = 14000;
    resize();
    assert.notDeepEqual(read(), fit(destination), "resizing must not jump to the destination");
    flush();
    assert.deepEqual(read(), fit(destination), "flight adapts to viewport and iframe sizing");

    controls.flyTo(initial.key);
    tick();
    tick(200);
    const mobileInitial = { ...initial, left: 630, width: 390 };
    flightPages = [mobileInitial, middle, destination];
    await act(async () => root.render(<Fixture />));
    flush();
    assert.deepEqual(read(), fit(mobileInitial), "flight follows device changes without a new URL");

    controls.flyTo(destination.key);
    tick();
    tick(200);
    const beforeRemoval = read();
    flightPages = [mobileInitial, middle];
    await act(async () => root.render(<Fixture />));
    assert.equal(callbacks.size, 0, "removing the destination cancels its flight");
    assert.deepEqual(read(), beforeRemoval);
    flightPages = [initial, middle, destination];
    await act(async () => root.render(<Fixture />));

    media.matches = true;
    content.width = 2972;
    content.height = 900;
    resize();
    controls.flyTo(initial.key);
    assert.deepEqual(read(), fit(initial), "reduced motion arrives immediately");
    assert.equal(callbacks.size, 0);

    const appended = { key: "appended", left: 3212, width: 1366 };
    content.width = 4578;
    flightPages = [...flightPages, appended];
    await act(async () => root.render(<Fixture />));
    controls.flyTo(appended.key);
    assert.deepEqual(
      read(),
      fit(appended),
      "immediate arrival measures new slots before resize notification",
    );
    resize();
    assert.deepEqual(read(), fit(appended), "a late resize cannot leave arrival at old bounds");

    content.width = 8000;
    content.height = 14000;
    resize();
    media.matches = false;
    controls.flyTo(destination.key);
    tick();
    media.matches = true;
    tick();
    assert.deepEqual(read(), fit(destination), "reduced motion can interrupt an active flight");
    assert.equal(callbacks.size, 0);
    media.matches = false;
    controls.flyTo(initial.key);
    assert.equal(callbacks.size, 1);
    await act(async () => root.unmount());
    unmounted = true;
    assert.equal(callbacks.size, 0, "unmount cancels flight animation");
    controls.flyTo(destination.key);
    assert.equal(
      callbacks.size,
      0,
      "stale navigation callbacks cannot restart an unmounted camera",
    );
  } finally {
    if (!unmounted) await act(async () => root.unmount());
    await dom.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

void test("page-fit gestures capture horizontal detents during input and retain zoom and rail behavior", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
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
      targets: [
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
    const pointer = (type: string, pointerId: number, clientX: number, clientY: number) => {
      const event = new dom.PointerEvent(type, {
        pointerId,
        button: 0,
        clientX,
        clientY,
        pointerType: "touch",
      });
      time += 16;
      Object.defineProperty(event, "timeStamp", { value: time });
      viewport.dispatchEvent(event);
    };
    const moveTo = (x: number) => {
      time += 200;
      pointer("pointerdown", 1, 400, 300);
      pointer("pointermove", 1, 400 + x - read().x, 300);
      pointer("pointerup", 1, 400, 300);
      assert.ok(Math.abs(read().x - x) < 1e-8);
    };
    const assertX = (x: number, message: string) =>
      assert.ok(Math.abs(read().x - x) < 1e-8, message);
    const assertCamera = (expected: { x: number; y: number; scale: number }, message: string) => {
      const next = read();
      assert.ok(
        Math.abs(next.x - expected.x) < 1e-8 &&
          Math.abs(next.y - expected.y) < 1e-8 &&
          Math.abs(next.scale - expected.scale) < 1e-12,
        message,
      );
    };
    // A zoom past a limit springs back once its input pauses.
    const springBack = async () => {
      await dom.happyDOM.waitUntilComplete();
      flush();
    };
    // Horizontal offsets from a centered page, derived from the tuned bands.
    const capture = size.width * PAN_SNAP_CAPTURE;
    const release = size.width * PAN_SNAP_RELEASE;
    const margin = 10;
    const outside = release + 40;
    // Wheel deltas that move the zoom by a log-scale distance.
    const zoomDelta = (distance: number) => distance / CANVAS_WHEEL_ZOOM_RATE;

    for (const shiftKey of [false, true]) {
      for (const direction of [-1, 1]) {
        moveTo(fitted.x + direction * outside);
        selections.length = 0;
        const horizontal = (delta: number) => {
          wheel(shiftKey ? 0 : delta, shiftKey ? delta : 0, { shiftKey });
          flush();
        };
        // Between the bands, the outcome depends on whether the page is already held.
        const between = (capture + release) / 2;
        horizontal(direction * (outside - between));
        assertX(
          fitted.x + direction * between,
          "the narrower capture band leaves nearby scrolling free",
        );
        assert.deepEqual(selections, []);
        horizontal(direction * (between - capture + margin));
        assertX(fitted.x, "wheel captures immediately within the capture band");
        assert.deepEqual(selections, ["page"], "entry selects without waiting for idle");
        horizontal(-direction * (between - capture + margin));
        assertX(fitted.x, "the wider release band holds where capture would not");
        horizontal(-direction * (release - margin - between));
        assertX(fitted.x, "small movements accumulate while held");
        horizontal(-direction * 2 * margin);
        assertX(
          fitted.x + direction * (release + margin),
          "accumulated intent escapes in either direction",
        );
        assert.deepEqual(selections, ["page"], "holding and releasing never reselect");
        const released = read();
        t.mock.timers.tick(1000);
        flush();
        assert.deepEqual(read(), released, "idle does not snap a released gesture");
        assert.deepEqual(selections, ["page"]);
      }
    }

    moveTo(fitted.x + outside);
    selections.length = 0;
    wheel(outside - capture + margin, 0);
    flush();
    wheel(-(release - capture), 0);
    flush();
    assertX(fitted.x, "gesture holds raw offset up to the release band");
    time += 200;
    wheel(-(release - margin), 0);
    flush();
    assertX(fitted.x, "a new gesture starts from the visible camera, not old intended x");
    wheel(-2 * margin, 0);
    flush();
    assertX(fitted.x + release + margin, "new gesture still accumulates enough intent to escape");

    for (const direction of [-1, 1]) {
      moveTo(fitted.x + direction * outside);
      selections.length = 0;
      const dragTo = (offset: number, y: number) =>
        pointer("pointermove", 1, 400 - direction * (outside - offset), y);
      pointer("pointerdown", 1, 400, 300);
      dragTo(capture - margin, 280);
      assertX(fitted.x, "drag captures before pointerup");
      const capturedY = read().y;
      assert.deepEqual(selections, ["page"]);
      dragTo(release - margin, 260);
      assertX(fitted.x, "drag holds within release band");
      assert.equal(read().y, capturedY - 20, "horizontal detent never blocks vertical reading");
      dragTo(release + margin, 260);
      assertX(
        fitted.x + direction * (release + margin),
        "drag retains raw intent instead of sticking forever",
      );
      const released = read();
      pointer("pointerup", 1, 400 - direction * (outside - release - margin), 260);
      t.mock.timers.tick(1000);
      flush();
      assert.deepEqual(read(), released, "pointer release cannot initiate snapping");
      assert.deepEqual(selections, ["page"]);
    }

    const key = (value: string) => {
      const event = new dom.KeyboardEvent("keydown", { key: value });
      time += 16;
      Object.defineProperty(event, "timeStamp", { value: time });
      viewport.dispatchEvent(event);
      flush();
    };
    for (const direction of [-1, 1]) {
      // Arrow keys pan 100px per press.
      let intended = capture - margin;
      moveTo(fitted.x + direction * (intended + 100));
      selections.length = 0;
      key(direction > 0 ? "ArrowRight" : "ArrowLeft");
      assertX(fitted.x, "arrow input captures within the same horizontal band");
      assert.deepEqual(selections, ["page"]);
      for (intended -= 100; Math.abs(intended) <= release; intended -= 100) {
        key(direction > 0 ? "ArrowRight" : "ArrowLeft");
        assertX(fitted.x, "repeated arrow input is held within the release band");
      }
      key(direction > 0 ? "ArrowRight" : "ArrowLeft");
      assertX(fitted.x + direction * intended, "repeated arrows escape using intended position");
      assert.deepEqual(selections, ["page"]);
    }

    moveTo(fitted.x + outside);
    selections.length = 0;
    wheel(2 * outside, 0);
    flush();
    assertX(fitted.x - outside, "strong movement passes through without capture");
    assert.deepEqual(selections, []);

    // Exercise the vertical rail away from horizontal detents so each rule is observable.
    moveTo(fitted.x + 600);
    selections.length = 0;
    time += 200;
    pan(10, 90, 0, 90);
    pan(10, 90, 0, 90);
    pan(60, 90, 0, 90); // Wider release band tolerates substantial drift.
    pan(3, 1, 0, 1); // Low-magnitude startup/tail noise does not release.
    pan(60, 60, 60, 60); // Diagonal intent releases the vertical rail immediately.
    pan(10, 90, 10, 90); // Its momentum tail remains free.
    time += 200;
    pan(90, 10, 90, 10); // Horizontal motion outside a detent stays free.
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
    pan(-3, -0.5, -3, -0.5); // Upward startup noise is undecided too.
    pan(2, -4, 2, -4);
    pan(-4, -16, 0, -16); // Vertical intent is acquired scrolling up as well.
    pan(15, -24, 0, -24);
    time += 200;
    pan(20, 60, 0, 60);
    pan(12, 0, 0, 0); // One horizontal jitter while locked is only evidence...
    time += 80;
    pan(4, 0, 0, 0); // ...which expires, so later jitter cannot add up with it.
    time += 200;
    pan(10, 90, 0, 90); // A new vertical gesture can acquire the rail.
    pan(0, 40, 40, 0, true); // Explicit Shift-scroll bypasses it.
    pan(10, 90, 10, 90); // Releasing Shift cannot lock the same gesture's tail.
    time += 200;
    pan(10, 90, 10, 90, true); // Shift also bypasses with native two-axis input.

    const beforeDrag = read();
    pointer("pointerdown", 1, 400, 300);
    pointer("pointermove", 1, 390, 210);
    viewport.dispatchEvent(new dom.PointerEvent("pointerup", { pointerId: 1 }));
    assert.equal(read().x, beforeDrag.x - 10);
    assert.equal(read().y, beforeDrag.y - 90);

    assert.deepEqual(selections, [], "ordinary pan never selects");
    const partial = read();
    t.mock.timers.tick(180);
    flush();
    assert.deepEqual(read(), partial, "less than 80% visibility cannot attract a page");
    assert.deepEqual(selections, []);
    wheel(0, -1, { ctrlKey: true });
    flush();
    assert.ok(read().scale > partial.scale, "zooming past the ceiling stretches the view");
    await springBack();
    assertCamera(partial, "page fit is the zoom ceiling, even without a snap");
    assert.deepEqual(selections, [], "a partial-width page cannot capture the detent");
    // Bring the page wholly into view, outside the horizontal capture band.
    pointer("pointerdown", 1, 400, 300);
    pointer("pointermove", 1, 400 + fitted.x + capture + margin - read().x, 300);
    pointer("pointerup", 1, 400, 300);
    const beforeSnap = read();
    wheel(0, -1, { ctrlKey: true });
    flush();
    await springBack();
    assert.deepEqual(selections, ["page"], "zooming in at the ceiling snaps to the eligible page");
    assert.equal(read().x, fitted.x, "snap entry centers horizontally");
    assert.ok(Math.abs(read().y - beforeSnap.y) < 1e-8, "entry retains vertical reading position");
    const beforeZoom = read();
    // The zoom landing on its target may move the anchor by a fraction of a screen pixel.
    const checkAnchor = () => {
      const next = read();
      const drift = (screen: number, from: number, to: number) =>
        Math.abs((screen - to) / next.scale - (screen - from) / beforeZoom.scale) * next.scale;
      assert.ok(drift(400, beforeZoom.x, next.x) < 0.5);
      assert.ok(drift(300, beforeZoom.y, next.y) < 0.5);
    };
    for (let count = 0; count < 20; count++) wheel(0, -1, { ctrlKey: true });
    flush();
    const stretched = read();
    assert.ok(stretched.scale > beforeZoom.scale, "zooming in past the snap stretches the view");
    assert.ok(
      Math.abs(
        stretched.x - (size.width - page.width * stretched.scale) / 2 + page.left * stretched.scale,
      ) < 1e-8,
      "centered on the page it holds",
    );
    await springBack();
    assertCamera(beforeZoom, "then springs back to the snap");
    assert.deepEqual(selections, ["page"], "a stretch keeps the selection");
    const heldSteps = Math.floor(zoomDelta(ZOOM_SNAP_RELEASE)) - 1;
    for (let count = 0; count < heldSteps; count++) wheel(0, 1, { ctrlKey: true });
    flush();
    assertCamera(beforeZoom, "small zoom-out input is held without recentering");
    assert.deepEqual(selections, ["page"], "held snap never repeats selection");
    for (let count = 0; count < 2; count++) wheel(0, 1, { ctrlKey: true });
    flush(checkAnchor);
    // Springing back ended the zoom-in above, so it left no intent past the ceiling.
    assert.ok(read().scale < fitted.scale, "accumulated gentle input escapes");
    pan(10, 90, 10, 90); // Outside snap, even overwhelmingly vertical motion is free.

    time += 200;
    wheel(0, -zoomDelta(Math.log(fitted.scale / read().scale) - ZOOM_SNAP_CAPTURE / 2), {
      ctrlKey: true,
    });
    flush();
    assert.equal(read().scale, fitted.scale, "capture from below");
    assert.equal(read().x, fitted.x);
    assert.deepEqual(selections, ["page", "page"]);
    const strongZoom = zoomDelta(ZOOM_SNAP_RELEASE + 0.1);
    wheel(0, strongZoom, { ctrlKey: true });
    flush();
    assert.ok(read().scale < fitted.scale, "strong input passes through the detent");
    time += 200;
    wheel(0, -strongZoom, { ctrlKey: true });
    flush();
    assert.equal(read().scale, fitted.scale, "and strong input in is captured at the ceiling");
    assert.equal(read().x, fitted.x);
    assert.deepEqual(selections, ["page", "page", "page"]);

    const beforeSibling = read();
    const toSibling = (sibling.left - page.left) * fitted.scale - (capture + margin);
    pan(toSibling, 0, toSibling, 0);
    const beforePanSelections = selections.length;
    t.mock.timers.tick(1000);
    flush();
    assert.equal(selections.length, beforePanSelections, "idle cannot select a nearby sibling");
    assertX(
      fitCanvasPage(size, sibling).x + capture + margin,
      "idle cannot center a nearby sibling",
    );
    wheel(2 * margin, 0);
    flush();
    assert.equal(read().x, fitCanvasPage(size, sibling).x);
    assert.equal(read().y, beforeSibling.y);
    assert.deepEqual(selections, ["page", "page", "page", "sibling"]);
    pan(0, 20, 0, 20);
    t.mock.timers.tick(180);
    flush();
    assert.equal(selections.length, beforePanSelections + 1, "aligned scrolling does not reselect");

    // Stop outside the horizontal capture band, at page fit, to test pinch entry.
    moveTo(fitted.x + capture + margin);
    const beforeTouchSnap = read();
    pointer("pointerdown", 1, 300, 300);
    pointer("pointerdown", 2, 500, 300);
    pointer("pointermove", 2, 502, 300);
    assert.ok(read().scale > fitted.scale, "pinching in at the ceiling stretches the view");
    assert.deepEqual(selections, ["page", "page", "page", "sibling", "page"]);
    // Lifting a finger ends the pinch, which springs back to the snap.
    pointer("pointerup", 1, 300, 300);
    flush();
    assert.ok(Math.abs(read().x - fitted.x) < 1e-8, "touch entry centers without the pinch offset");
    assert.ok(Math.abs(read().y - beforeTouchSnap.y) < 1e-8);
    assert.equal(read().scale, fitted.scale);
    pointer("pointerup", 2, 502, 300);

    const beforePinch = read();
    pointer("pointerdown", 1, 300, 300);
    pointer("pointerdown", 2, 500, 300);
    // Fingers start 200px apart; each step pinches them 2px closer.
    const spread = (step: number) => -Math.log((200 - step * 2) / 200);
    let step = 1;
    for (; spread(step - 1) <= ZOOM_SNAP_RELEASE; step++) {
      pointer("pointermove", 2, 500 - step * 2, 300);
      const next = read();
      if (spread(step) < ZOOM_SNAP_RELEASE - 1e-6)
        assert.deepEqual(next, { ...beforePinch, y: next.y }, "the snap holds the pinch");
      assert.ok(
        Math.abs((300 - next.y) / next.scale - (300 - beforePinch.y) / beforePinch.scale) < 1e-8,
      );
    }
    assert.ok(read().scale < fitted.scale, "touch pinch accumulates small movements too");
    pointer("pointerup", 1, 300, 300);
    pointer("pointerup", 2, 500 - (step - 1) * 2, 300);

    pan(30, 0, 30, 0);
    const unsnapped = read();
    const selectionCount = selections.length;
    t.mock.timers.tick(180);
    flush();
    assert.deepEqual(read(), unsnapped, "horizontal snap is disabled away from page-fit zoom");
    assert.equal(selections.length, selectionCount);

    for (const offset of [-(ZOOM_SNAP_CAPTURE - 0.02), -(ZOOM_SNAP_CAPTURE + 0.02)]) {
      // Zoom with the page mostly out of view to reach a non-detented scale.
      const centerAt = (scale: number) => size.width / 2 - (page.left + page.width / 2) * scale;
      moveTo(centerAt(read().scale) + 600);
      time += 200;
      const requestedScale = fitted.scale * Math.exp(offset);
      wheel(0, -Math.log(requestedScale / read().scale) / CANVAS_WHEEL_ZOOM_RATE, {
        ctrlKey: true,
      });
      flush();
      assert.ok(Math.abs(read().scale - requestedScale) < 1e-8);
      const scale = read().scale;
      const centeredX = centerAt(scale);
      moveTo(centeredX + outside);
      selections.length = 0;
      const before = read();
      wheel(outside - capture + margin, 0);
      flush();
      if (Math.abs(offset) > ZOOM_SNAP_CAPTURE) {
        assert.equal(read().scale, scale, "outside the zoom capture range, panning keeps zoom");
        assert.equal(read().y, before.y, "horizontal motion retains vertical position");
        assertX(centeredX + capture - margin, "outside the zoom capture range, panning is free");
        assert.deepEqual(selections, [], "only a snapped camera selects");
        time += 200;
        wheel(0, -1, { ctrlKey: true });
        flush();
        assert.ok(read().scale < fitted.scale, "outside the zoom capture range, zoom stays free");
        continue;
      }
      assert.equal(read().scale, fitted.scale, "panning near the page fit snaps its zoom too");
      assertX(fitted.x, "and centers the page");
      assert.ok(
        Math.abs(read().y / fitted.scale - before.y / scale) < 1e-8,
        "the snap keeps the reading point at the top edge",
      );
      assert.deepEqual(selections, ["page"]);
      wheel(capture + release - 2 * margin, 0);
      flush();
      assertX(fitted.x, "the snap holds within the release band");
      wheel(2 * margin, 0);
      flush();
      assertX(
        fitted.x - release - margin,
        "intent carries over to the fit's zoom, so the snap releases where the input is",
      );
      assert.equal(read().scale, fitted.scale, "releasing keeps the page fit's zoom");
    }
  } finally {
    await act(async () => root.unmount());
    await dom.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

void test("a selection is a snapped camera: leaving the snap deselects, selecting elsewhere flies there", async () => {
  const dom = new Window({ url: "http://localhost/about" });
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
  // Flights arrive at once, so each step reads its destination.
  Object.defineProperty(dom, "matchMedia", { value: () => ({ matches: true }) });
  const mount = dom.document.createElement("div");
  dom.document.body.append(mount);
  const root = createRoot(mount as unknown as HTMLElement);
  const size = { width: 1600, height: 900 };
  const pages = [
    { key: "first", left: 0, width: 1366 },
    { key: "middle", left: 1606, width: 1366 },
    { key: "last", left: 3212, width: 1366 },
  ];
  const content = { width: 4578, height: 2000 };
  let selected = "middle";
  let ordered = pages;
  const events: string[] = [];
  let controls!: ReturnType<typeof useCanvasCamera>;
  function Fixture() {
    controls = useCanvasCamera("deselect", pages[1], {
      targets: ordered,
      // Like the Canvas, a selection made by the camera comes back as the row's.
      onSelect: (key) => {
        events.push(`select ${key}`);
        selected = key;
      },
      selected,
      onDeselect: () => {
        events.push("deselect");
        selected = "";
      },
    });
    return (
      <div ref={controls.viewportRef}>
        <div ref={controls.contentRef} />
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
    });
    Object.defineProperties(viewport.querySelector("div")!, {
      offsetWidth: { get: () => content.width },
      offsetHeight: { get: () => content.height },
    });
    resize();
    const read = () => ({
      x: parseFloat(viewport.style.getPropertyValue("--canvas-x")),
      y: parseFloat(viewport.style.getPropertyValue("--canvas-y")),
      scale: Number(viewport.style.getPropertyValue("--canvas-zoom")),
    });
    const flush = () => {
      for (let count = 0; callbacks.size && count < 100; count++) {
        const batch = [...callbacks.values()];
        callbacks.clear();
        batch.forEach((callback) => callback(time));
      }
      assert.equal(callbacks.size, 0);
    };
    const wheel = (dx: number, dy: number, ctrlKey = false) => {
      const event = new dom.MouseEvent("wheel", { clientX: 800, clientY: 300, ctrlKey });
      time += 16;
      Object.defineProperties(event, {
        deltaX: { value: dx },
        deltaY: { value: dy },
        deltaMode: { value: 0 },
        timeStamp: { value: time },
      });
      viewport.dispatchEvent(event);
      flush();
    };
    const rerender = () => act(async () => root.render(<Fixture />));
    const snappedTo = (page: { left: number; width: number }) => {
      const fit = fitCanvasPage(size, page);
      const { x, scale } = read();
      return Math.abs(x - fit.x) < 1e-8 && Math.abs(scale - fit.scale) < 1e-8;
    };
    assert.ok(snappedTo(pages[1]!), "it opens snapped to the selection");

    const opened = read();
    wheel(0, -1000, true);
    const stretched = read();
    assert.ok(stretched.scale > opened.scale, "zooming in past the snap stretches the view");
    assert.ok(stretched.scale < opened.scale * Math.exp(ZOOM_STRETCH), "but only so far");
    await rerender();
    flush();
    assert.deepEqual(read(), stretched, "a stretch holds the selection, without flying to it");
    assert.deepEqual(events, []);
    await dom.happyDOM.waitUntilComplete();
    flush();
    assert.ok(snappedTo(pages[1]!), "then springs back to the snap");
    assert.ok(Math.abs(read().y - opened.y) < 1e-8);
    wheel(0, 300);
    assert.ok(snappedTo(pages[1]!), "reading down the page keeps it snapped");
    assert.deepEqual(events, []);
    wheel(0, 300, true);
    assert.ok(read().scale < opened.scale);
    assert.deepEqual(events.splice(0), ["deselect"], "zooming out of the snap deselects");
    wheel(0, 50, true);
    assert.deepEqual(events, [], "zooming out further doesn't deselect again");
    await rerender();

    // A zoom that jumps past a snap selects it.
    time += 200;
    wheel(0, -1000, true);
    assert.deepEqual(events.splice(0), ["select middle"], "zooming in past a page snaps to it");
    await rerender();
    await dom.happyDOM.waitUntilComplete();
    flush();
    assert.ok(snappedTo(pages[1]!));
    // The detent captures a gentle zoom.
    const fitScale = read().scale;
    const leave = () => {
      time += 200;
      wheel(0, (ZOOM_SNAP_RELEASE + 0.05) / CANVAS_WHEEL_ZOOM_RATE, true);
      assert.deepEqual(events.splice(0), ["deselect"]);
    };
    leave();
    await rerender();
    time += 200;
    wheel(0, -0.1 / CANVAS_WHEEL_ZOOM_RATE, true);
    assert.equal(read().scale, fitScale, "the detent captures the zoom");
    assert.deepEqual(events.splice(0), ["select middle"]);
    await rerender();
    await dom.happyDOM.waitUntilComplete();
    flush();
    // Zooming on past the captured snap stretches the view, then springs back to it.
    leave();
    await rerender();
    time += 200;
    wheel(0, -0.1 / CANVAS_WHEEL_ZOOM_RATE, true);
    assert.deepEqual(events.splice(0), ["select middle"]);
    await rerender();
    wheel(0, -100, true);
    wheel(0, -100, true);
    assert.ok(read().scale > fitScale);
    await dom.happyDOM.waitUntilComplete();
    flush();
    assert.ok(snappedTo(pages[1]!));
    time += 200;
    wheel(0, 1000, true);
    assert.deepEqual(events.splice(0), ["deselect"]);
    await rerender();

    // A selection from elsewhere, like a header click, flies to it without reselecting.
    selected = "last";
    await rerender();
    flush();
    assert.ok(snappedTo(pages[2]!), "the camera snaps to an item selected elsewhere");
    assert.deepEqual(events, []);
    await dom.happyDOM.waitUntilComplete();
    flush();
    await rerender();
    assert.ok(snappedTo(pages[2]!));

    time += 200;
    wheel(size.width / 4, 0);
    assert.deepEqual(events.splice(0), ["deselect"], "panning out of the snap deselects");
    await rerender();
    time += 200;
    wheel(-size.width / 4 + 10, 0);
    assert.ok(snappedTo(pages[2]!));
    assert.deepEqual(events.splice(0), ["select last"], "panning into a snap selects");
    const snapped = read();
    await rerender();
    assert.deepEqual(read(), snapped, "the camera's own selection doesn't fly");

    // Reordering moves the selection away from the camera, which follows it.
    ordered = [pages[0]!, { ...pages[2]!, left: pages[1]!.left }, { ...pages[1]!, left: 3212 }];
    await rerender();
    flush();
    assert.ok(snappedTo(ordered[1]!), "the camera keeps the selection snapped");
    assert.deepEqual(events, []);

    selected = "";
    await rerender();
    assert.ok(snappedTo(ordered[1]!), "deselecting from elsewhere leaves the camera");
    wheel(0, 1000, true);
    assert.deepEqual(events, [], "without a selection, there is nothing to leave");
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

void test("the overview fits the Canvas row width given by its items, with measured frame heights", async () => {
  const dom = new Window({ url: "http://localhost/camox/canvas" });
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
  const size = { width: 900, height: 800 };
  let height = 900;
  function Fixture() {
    const { viewportRef, contentRef } = useCanvasCamera("row-width-from-items", undefined, {
      targets: [{ key: "page:1", left: 248, width: 1366 }],
      width: 1614,
      onSelect: () => {},
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
    });
    // The DOM row can be wider than its items (e.g. a stray overflow); bounds must not follow it.
    Object.defineProperties(viewport.querySelector("div")!, {
      offsetWidth: { get: () => 9000 },
      offsetHeight: { get: () => height },
    });
    const assertOverview = () => {
      const expected = fitCanvas(size, { width: 1614, height, pageWidth: 1366 });
      assert.equal(parseFloat(viewport.style.getPropertyValue("--canvas-x")), expected.x);
      assert.equal(parseFloat(viewport.style.getPropertyValue("--canvas-y")), expected.y);
      assert.equal(Number(viewport.style.getPropertyValue("--canvas-zoom")), expected.scale);
    };
    resize();
    assertOverview();
    height = 4000;
    resize();
    assertOverview();
  } finally {
    await act(async () => root.unmount());
    await dom.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

void test("reveal pans vertically to an element in a frame, only when it mostly doesn't show", async () => {
  const dom = new Window({ url: "http://localhost/camox/canvas" });
  let resize = () => {};
  const frames: ((time: number) => void)[] = [];
  let time = 0;
  const step = () => frames.shift()?.((time += 16));
  const settle = () => {
    for (let i = 0; i < 1000 && frames.length; i++) step();
  };
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
    requestAnimationFrame: (callback: (time: number) => void) => frames.push(callback),
    cancelAnimationFrame: () => {},
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  const mount = dom.document.createElement("div");
  dom.document.body.append(mount);
  const root = createRoot(mount as unknown as HTMLElement);
  const size = { width: 900, height: 800 };
  let controls!: ReturnType<typeof useCanvasCamera>;
  function Fixture() {
    controls = useCanvasCamera("reveal", undefined, {
      targets: [{ key: "page:1", left: 0, width: 1366 }],
      width: 1366,
      onSelect: () => {},
    });
    return (
      <div ref={controls.viewportRef}>
        <div ref={controls.contentRef} />
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
      offsetWidth: { get: () => 1366 },
      offsetHeight: { get: () => 8000 },
    });
    resize();
    const camera = () => ({
      x: parseFloat(viewport.style.getPropertyValue("--canvas-x")),
      y: parseFloat(viewport.style.getPropertyValue("--canvas-y")),
      scale: Number(viewport.style.getPropertyValue("--canvas-zoom")),
    });
    // A frame at the top of the row, which the camera moves and scales.
    const frameElement = { getBoundingClientRect: () => ({ top: camera().y }) };
    const blockAt = (top: number, height: number) =>
      ({
        ownerDocument: { defaultView: { frameElement } },
        getBoundingClientRect: () => ({ top, height }),
      }) as unknown as Element;
    const screen = (top: number, height: number) => {
      const { y, scale } = camera();
      return { top: y + top * scale, bottom: y + (top + height) * scale };
    };

    controls.flyTo("page:1");
    settle();
    const fitted = camera();
    const shown = blockAt(200, 600);
    assert.ok(screen(200, 600).bottom < size.height, "the block shows at page fit");
    controls.reveal(shown, true);
    assert.deepEqual(camera(), fitted, "a block that shows keeps the camera");

    const below = blockAt(5000, 600);
    controls.reveal(below, true);
    const revealed = camera();
    assert.equal(revealed.x, fitted.x, "pans only vertically");
    assert.equal(revealed.scale, fitted.scale, "keeps the zoom");
    const { top, bottom } = screen(5000, 600);
    assert.ok(top >= 0 && bottom <= size.height, "the block now shows in full");

    // A smooth reveal eases to the same place, over more than a few frames.
    controls.reveal(shown, true);
    const start = camera().y;
    controls.reveal(below);
    for (let i = 0; i < 6; i++) step();
    const early = camera().y;
    assert.ok(
      early < start && (start - early) / (start - revealed.y) < 0.25,
      "a smooth reveal starts gently",
    );
    settle();
    assert.ok(Math.abs(camera().y - revealed.y) < 0.1, "a smooth reveal lands where it pans");

    // A flight in progress keeps its course.
    controls.reveal(below, true);
    controls.flyTo("page:1");
    controls.reveal(below, true);
    settle();
    assert.deepEqual(camera(), fitted, "reveal yields to a flight");
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
        <input aria-label="Page path" />
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
      // The zoom landing on its target may move the anchor by a fraction of a screen pixel.
      assert.ok(Math.abs((500 - currentX) / currentScale - anchor) * currentScale < 0.5);
      assert.ok(Math.abs((300 - currentY) / currentScale - anchorY) * currentScale < 0.5);
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
    assert.ok(fitCanvas(viewportSize, contentSize).scale < MIN_CANVAS_ZOOM);
    assert.equal(
      Number(style.getPropertyValue("--canvas-zoom")),
      MIN_CANVAS_ZOOM,
      "very tall pages stop at the zoom floor instead of fitting",
    );
    contentSize.height = 6000;
    viewportSize.width = 1000;
    resized();
    assert.equal(
      Number(style.getPropertyValue("--canvas-zoom")),
      canvasOverview(viewportSize, contentSize).scale,
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
    assert.deepEqual(read(), canvasOverview(viewportSize, contentSize));
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
    assert.deepEqual(read(), canvasOverview(viewportSize, contentSize));
    contentSize.height = 10000;
    resized();
    assert.deepEqual(
      read(),
      canvasOverview(viewportSize, contentSize),
      "saved overview stays fitted",
    );

    key("0");
    flush();
    const updated = read();
    await render("restore-b");
    assert.deepEqual(
      read(),
      canvasOverview(viewportSize, contentSize),
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

void test("the camera paints onto mirrored elements outside the viewport until released", async () => {
  const dom = new Window({ url: "http://localhost/camox/canvas" });
  const callbacks = new Map<number, FrameRequestCallback>();
  let resize = () => {};
  let sequence = 0;
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
  Object.defineProperty(dom, "matchMedia", { value: () => ({ matches: true }) });
  const mount = dom.document.createElement("div");
  dom.document.body.append(mount);
  const root = createRoot(mount as unknown as HTMLElement);
  let controls!: ReturnType<typeof useCanvasCamera>;
  function Fixture() {
    controls = useCanvasCamera("mirror", undefined, { targets: [], onSelect: () => {} });
    return (
      <div ref={controls.viewportRef}>
        <div ref={controls.contentRef} />
      </div>
    );
  }
  try {
    await act(async () => root.render(<Fixture />));
    const viewport = mount.querySelector("div")!;
    Object.defineProperties(viewport, {
      clientWidth: { get: () => 900 },
      clientHeight: { get: () => 800 },
      getBoundingClientRect: { value: () => ({ left: 0, top: 0 }) },
    });
    Object.defineProperties(viewport.querySelector("div")!, {
      offsetWidth: { get: () => 8000 },
      offsetHeight: { get: () => 6000 },
    });
    resize();
    const camera = (element: { style: { getPropertyValue: (name: string) => string } }) =>
      ["--canvas-x", "--canvas-y", "--canvas-zoom", "--canvas-pixel-ratio"].map((name) =>
        element.style.getPropertyValue(name),
      );
    const flush = () => {
      for (let count = 0; callbacks.size && count < 200; count++) {
        const batch = [...callbacks.values()];
        callbacks.clear();
        batch.forEach((callback) => callback(0));
      }
    };
    const mirror = dom.document.createElement("div") as unknown as HTMLElement;
    const release = controls.mirrorCamera(mirror);
    assert.deepEqual(camera(mirror), camera(viewport), "a mirror starts with the current camera");
    viewport.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "0" }));
    flush();
    assert.notDeepEqual(camera(viewport), ["", "", "", ""]);
    assert.equal(
      mirror.style.getPropertyValue("--canvas-pixel-ratio"),
      String(dom.devicePixelRatio),
      "page edges in the mirror can size a device pixel",
    );
    assert.deepEqual(camera(mirror), camera(viewport), "camera moves reach the mirror");
    const promoted = (element: { dataset: object }) => "canvasPromoted" in element.dataset;
    const overlap = (element: { dataset: { canvasBlockOverlap?: string } }) =>
      Number(element.dataset.canvasBlockOverlap);
    const restZoom = (element: { style: { getPropertyValue: (name: string) => string } }) =>
      element.style.getPropertyValue("--canvas-rest-zoom");
    const zoomBy = async (key: string, times = 1) => {
      const overlapBefore = overlap(viewport);
      const restZoomBefore = restZoom(viewport);
      for (let count = 0; count < times; count++)
        viewport.dispatchEvent(new dom.KeyboardEvent("keydown", { key }));
      flush();
      const scale = Number(viewport.style.getPropertyValue("--canvas-zoom"));
      assert.equal(promoted(viewport), true, `a moving camera promotes its layers at ${scale}`);
      assert.equal(promoted(mirror), true, "and the mirror's");
      assert.equal(overlap(viewport), overlapBefore, "a moving camera never reflows frames");
      assert.equal(restZoom(viewport), restZoomBefore, "nor repaints page edges");
      await new Promise((resolve) => dom.setTimeout(resolve, 300));
      assert.equal(overlap(mirror), overlap(viewport), "frames in the mirror overlap blocks alike");
      assert.equal(restZoom(viewport), String(scale), "settled, page edges follow the zoom");
      assert.equal(restZoom(mirror), restZoom(viewport), "in the mirror too");
      return scale;
    };
    // Settled, layers stay promoted only where Chromium rasters them affordably and sharply.
    assert.equal(await zoomBy("0"), 1);
    assert.equal(overlap(viewport), 0, "at 100%, blocks keep their exact borders");
    assert.equal(promoted(viewport), true, "at 100%, a layer stays promoted for the next move");
    assert.equal(promoted(mirror), true);
    assert.ok((await zoomBy("+")) > 1);
    assert.equal(promoted(viewport), false, "zoomed in, settling re-rasters sharper than native");
    assert.equal(promoted(mirror), false);
    assert.ok((await zoomBy("-", 8)) < 0.25);
    assert.equal(promoted(viewport), false, "zoomed far out, settling re-rasters smaller");
    assert.equal(promoted(mirror), false);
    assert.ok(overlap(viewport) > 0, "zoomed out, settled blocks overlap to hide seams");
    await zoomBy("0");
    const space = (type: string) =>
      dom.document.body.dispatchEvent(
        new dom.KeyboardEvent(type, { code: "Space", key: " ", bubbles: true }),
      );
    space("keydown");
    assert.equal(mirror.dataset.canvasPan, viewport.dataset.canvasPan);
    assert.equal(mirror.dataset.canvasPan, "ready", "the hand tool reaches the mirror");
    space("keyup");
    assert.equal(mirror.dataset.canvasPan, undefined);

    release();
    assert.deepEqual(camera(mirror), ["", "", "", ""], "releasing clears the mirrored camera");
    assert.equal(restZoom(mirror), "", "and its resting zoom");
    assert.equal(promoted(mirror), false, "releasing demotes the mirror");
    assert.equal(mirror.dataset.canvasBlockOverlap, undefined, "and stops its block overlap");
    viewport.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "-" }));
    flush();
    assert.deepEqual(camera(mirror), ["", "", "", ""], "a released mirror no longer follows");
  } finally {
    await act(async () => root.unmount());
    await dom.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

void test("a snapped page stays snapped as the viewport resizes", async () => {
  const dom = new Window({ url: "http://localhost/about" });
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
  // Flights arrive at once, so the camera starts snapped to their destination.
  Object.defineProperty(dom, "matchMedia", { value: () => ({ matches: true }) });
  const mount = dom.document.createElement("div");
  dom.document.body.append(mount);
  const root = createRoot(mount as unknown as HTMLElement);
  const size = { width: 1600, height: 900 };
  const pages = [
    { key: "first", left: 0, width: 1366 },
    { key: "middle", left: 1606, width: 1366 },
    { key: "last", left: 3212, width: 1366 },
  ];
  const content = { width: 4578, height: 20000 };
  let selected = "middle";
  let controls!: ReturnType<typeof useCanvasCamera>;
  function Fixture() {
    controls = useCanvasCamera("snapped-resize", pages[1], {
      targets: pages,
      selected,
      onSelect: (key) => (selected = key),
      onDeselect: () => (selected = ""),
    });
    return (
      <div ref={controls.viewportRef}>
        <div ref={controls.contentRef} />
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
    });
    Object.defineProperties(viewport.querySelector("div")!, {
      offsetWidth: { get: () => content.width },
      offsetHeight: { get: () => content.height },
    });
    resize();
    const read = () => ({
      x: parseFloat(viewport.style.getPropertyValue("--canvas-x")),
      y: parseFloat(viewport.style.getPropertyValue("--canvas-y")),
      scale: Number(viewport.style.getPropertyValue("--canvas-zoom")),
    });
    const flush = () => {
      for (let count = 0; callbacks.size && count < 100; count++) {
        const batch = [...callbacks.values()];
        callbacks.clear();
        batch.forEach((callback) => callback(time));
      }
      assert.equal(callbacks.size, 0);
    };
    const wheel = (dx: number, dy: number) => {
      const event = new dom.MouseEvent("wheel", { clientX: 800, clientY: 300 });
      time += 16;
      Object.defineProperties(event, {
        deltaX: { value: dx },
        deltaY: { value: dy },
        deltaMode: { value: 0 },
        timeStamp: { value: time },
      });
      viewport.dispatchEvent(event);
      flush();
    };
    const assertNear = (actual: number, expected: number, message: string) =>
      assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} != ${expected}`);
    const last = pages[2]!;

    selected = last.key;
    await act(async () => root.render(<Fixture />));
    wheel(0, 600);
    const scrolled = read();
    assert.ok(scrolled.y < 0, "the page is scrolled down its document");

    size.width = 1100;
    resize();
    const fit = fitCanvasPage(size, last);
    assertNear(read().scale, fit.scale, "the page is refitted to the narrower viewport");
    assertNear(read().x, fit.x, "the page stays centered");
    assertNear(
      read().y,
      (scrolled.y * fit.scale) / scrolled.scale,
      "the same document point stays at the viewport top",
    );

    size.width = 1400;
    resize();
    assertNear(read().scale, fitCanvasPage(size, last).scale, "it keeps following the viewport");
    assertNear(read().x, fitCanvasPage(size, last).x, "and keeps the page centered");

    wheel(-400, 0);
    const released = read();
    assert.ok(released.x > fitCanvasPage(size, last).x, "panning away releases the snap");
    assert.equal(selected, "", "and the selection");
    size.width = 1600;
    resize();
    assertNear(read().scale, released.scale, "an unsnapped camera keeps its zoom on resize");
    size.width = 1000;
    resize();
    assertNear(
      read().scale,
      fitCanvasPage(size, last).scale,
      "but never zooms in past the page fit",
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

void test("the editor's own pans and zooms report themselves; flights and resizes don't", async () => {
  const dom = new Window({ url: "http://localhost/about" });
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
  Object.defineProperty(dom, "matchMedia", { value: () => ({ matches: false }) });
  const mount = dom.document.createElement("div");
  dom.document.body.append(mount);
  const root = createRoot(mount as unknown as HTMLElement);
  const size = { width: 1600, height: 900 };
  const pages = [
    { key: "first", left: 0, width: 1366 },
    { key: "middle", left: 1606, width: 1366 },
    { key: "last", left: 3212, width: 1366 },
  ];
  const content = { width: 4578, height: 20000 };
  let selected = "middle";
  let moves = 0;
  let controls!: ReturnType<typeof useCanvasCamera>;
  function Fixture() {
    controls = useCanvasCamera("editor-moves", pages[1], {
      targets: pages,
      selected,
      onSelect: (key) => (selected = key),
      onDeselect: () => (selected = ""),
      onEditorMove: () => (moves += 1),
    });
    return (
      <div ref={controls.viewportRef}>
        <div ref={controls.contentRef} />
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
      offsetWidth: { get: () => content.width },
      offsetHeight: { get: () => content.height },
    });
    resize();
    const flush = () => {
      for (let count = 0; callbacks.size && count < 200; count++) {
        time += 16;
        const batch = [...callbacks.values()];
        callbacks.clear();
        batch.forEach((callback) => callback(time));
      }
    };
    const wheel = (dx: number, dy: number, modifiers: { ctrlKey?: boolean } = {}) => {
      const event = new dom.MouseEvent("wheel", { clientX: 800, clientY: 300, ...modifiers });
      time += 16;
      Object.defineProperties(event, {
        deltaX: { value: dx },
        deltaY: { value: dy },
        deltaMode: { value: 0 },
        timeStamp: { value: time },
      });
      viewport.dispatchEvent(event);
      flush();
    };
    const pointer = (type: string, clientY: number) => {
      const event = new dom.PointerEvent(type, {
        pointerId: 1,
        button: 0,
        clientX: 400,
        clientY,
        pointerType: "touch",
      });
      time += 16;
      Object.defineProperty(event, "timeStamp", { value: time });
      viewport.dispatchEvent(event);
    };

    // Selecting from anywhere else flies the camera; the frame resizing refits it.
    selected = "last";
    await act(async () => root.render(<Fixture />));
    flush();
    controls.flyTo("first");
    flush();
    size.width = 1400;
    resize();
    flush();
    assert.equal(moves, 0, "flights and resizes aren't the editor's");

    wheel(0, 300);
    assert.equal(moves, 1, "scrolling a page pans");
    wheel(0, -40, { ctrlKey: true });
    assert.equal(moves, 2, "pinching a trackpad zooms");
    viewport.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "ArrowDown" }));
    flush();
    viewport.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "-" }));
    flush();
    assert.equal(moves, 4, "keyboard pans and zooms");
    pointer("pointerdown", 300);
    pointer("pointermove", 200);
    pointer("pointerup", 200);
    assert.ok(moves > 4, "dragging pans");
  } finally {
    await act(async () => root.unmount());
    await dom.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

void test("a zoom springing back while a pan goes on lands, so the zoom stops changing", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
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
  Object.defineProperty(dom, "matchMedia", { value: () => ({ matches: false }) });
  const mount = dom.document.createElement("div");
  dom.document.body.append(mount);
  const root = createRoot(mount as unknown as HTMLElement);
  const size = { width: 1600, height: 900 };
  const pages = [
    { key: "first", left: 0, width: 1366 },
    { key: "middle", left: 1606, width: 1366 },
    { key: "last", left: 3212, width: 1366 },
  ];
  function Fixture() {
    const { viewportRef, contentRef } = useCanvasCamera("spring-back-pan", pages[1], {
      targets: pages,
      onSelect: () => {},
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
      offsetWidth: { get: () => 4578 },
      offsetHeight: { get: () => 20000 },
    });
    resize();
    const frame = () => {
      time += 16;
      const batch = [...callbacks.values()];
      callbacks.clear();
      batch.forEach((callback) => callback(time));
    };
    const flush = () => {
      for (let count = 0; callbacks.size && count < 200; count++) frame();
    };
    const wheel = (dx: number, dy: number, modifiers: { ctrlKey?: boolean } = {}) => {
      const event = new dom.MouseEvent("wheel", { clientX: 800, clientY: 300, ...modifiers });
      time += 16;
      Object.defineProperties(event, {
        deltaX: { value: dx },
        deltaY: { value: dy },
        deltaMode: { value: 0 },
        timeStamp: { value: time },
      });
      viewport.dispatchEvent(event);
    };
    const zoom = () => viewport.style.getPropertyValue("--canvas-zoom");
    const x = () => parseFloat(viewport.style.getPropertyValue("--canvas-x"));

    // Pinch out past the zoom floor, which stretches the view.
    for (let step = 0; step < 40; step++) {
      wheel(0, 20, { ctrlKey: true });
      frame();
    }
    flush();
    const stretched = Number(zoom());
    // The pinch ends and the view springs back, while the editor keeps panning.
    t.mock.timers.tick(200);
    const zooms: string[] = [];
    const xs: number[] = [];
    for (let step = 0; step < 90; step++) {
      wheel(step % 30 < 15 ? 12 : -12, 0);
      frame();
      zooms.push(zoom());
      xs.push(x());
    }
    assert.ok(Number(zooms.at(-1)) > stretched, "the view springs back from the stretch");
    const late = zooms.slice(45);
    assert.equal(new Set(late).size, 1, "the zoom has landed, so it stops changing");
    assert.ok(new Set(xs.slice(45)).size > 1, "while the pan keeps moving the camera");
  } finally {
    await act(async () => root.unmount());
    await dom.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

void test("a zoomed-out camera away from the overview keeps its place as page heights change", async () => {
  const dom = new Window({ url: "http://localhost/camox/canvas" });
  const viewportSize = { width: 1200, height: 800 };
  const contentSize = { width: 6000, height: 3000 };
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
  const flush = () => {
    for (let count = 0; callbacks.size && count < 100; count++) {
      const batch = [...callbacks.values()];
      callbacks.clear();
      time += 16;
      batch.forEach((callback) => callback(time));
    }
    assert.equal(callbacks.size, 0);
  };
  function Fixture() {
    const { viewportRef, contentRef } = useCanvasCamera("zoomed-out-away");
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
    await act(async () => root.render(<Fixture />));
    resized();
    const overview = canvasOverview(viewportSize, contentSize);
    assert.deepEqual(read(), overview);
    // At the zoom floor, but moved away from the overview, as a zoom out at the cursor leaves it.
    key("ArrowRight");
    flush();
    const moved = read();
    assert.equal(moved.scale, overview.scale);
    assert.notEqual(moved.x, overview.x);

    // Page frames reflow once the camera rests, and screenshots resize them as they land.
    contentSize.height = 3100;
    resized();
    assert.deepEqual(
      read(),
      constrainCanvasCamera(moved, viewportSize, contentSize),
      "the camera stays where the editor left it",
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

void test("insets keep a snapped page centered and fitted between the chrome over the viewport", async () => {
  const dom = new Window({ url: "http://localhost/camox/canvas" });
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
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  Object.defineProperty(dom, "matchMedia", { value: () => ({ matches: false }) });
  const mount = dom.document.createElement("div");
  dom.document.body.append(mount);
  const root = createRoot(mount as unknown as HTMLElement);
  const size = { width: 1600, height: 900 };
  const insets = { top: 0, right: 300, bottom: 10, left: 200 };
  const area = {
    width: size.width - insets.left - insets.right,
    height: size.height - insets.top - insets.bottom,
  };
  const page = { key: "page", left: 1606, width: 1366 };
  let controls!: ReturnType<typeof useCanvasCamera>;
  function Fixture() {
    controls = useCanvasCamera("insets", page, {
      targets: [page],
      onSelect: () => {},
      insets,
    });
    return (
      <div ref={controls.viewportRef}>
        <div ref={controls.contentRef} />
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
    });
    Object.defineProperties(viewport.querySelector("div")!, {
      offsetWidth: { get: () => 8000 },
      offsetHeight: { get: () => 12000 },
    });
    resize();
    const x = parseFloat(viewport.style.getPropertyValue("--canvas-x"));
    const scale = Number(viewport.style.getPropertyValue("--canvas-zoom"));
    assert.equal(scale, fitCanvasPage(area, page).scale, "fits the page to the area's width");
    assert.ok(scale < fitCanvasPage(size, page).scale, "not to the whole viewport's");
    assert.ok(
      Math.abs(x + (page.left + page.width / 2) * scale - (insets.left + area.width / 2)) < 0.5,
      "centers the page in the area, not in the viewport",
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
