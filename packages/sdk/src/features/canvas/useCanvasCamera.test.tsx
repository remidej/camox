import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

import {
  CANVAS_PINCH_ZOOM_SPEED,
  constrainCanvasCamera,
  fitCanvas,
  fitCanvasPage,
  PAN_SNAP_CAPTURE,
  PAN_SNAP_RELEASE,
  ZOOM_SNAP_CAPTURE,
  ZOOM_SNAP_RELEASE,
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

    controls.flyTo(initial.key);
    tick();
    tick(250);
    const halfway = read();
    controls.flyTo(middle.key);
    assert.deepEqual(read(), halfway, "new navigation retargets from the current painted view");
    flush();
    assert.deepEqual(read(), fit({ left: 3212, width: 1366 }));

    for (const input of ["wheel", "keyboard", "pointer", "canvas selection"] as const) {
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
      if (input === "canvas selection") controls.cancelFlight();
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
    controls.flyTo(middle.key);
    flush();
    const beforeProgrammaticZoom = read();
    const zoomPoint = { x: 450, y: 400 };
    const anchoredContentPoint = {
      x: (zoomPoint.x - beforeProgrammaticZoom.x) / beforeProgrammaticZoom.scale,
      y: (zoomPoint.y - beforeProgrammaticZoom.y) / beforeProgrammaticZoom.scale,
    };
    controls.zoomAt(zoomPoint, 1.25);
    flush();
    const afterProgrammaticZoom = read();
    assert.equal(afterProgrammaticZoom.scale, 1.25);
    assert.ok(
      Math.abs(
        (zoomPoint.x - afterProgrammaticZoom.x) / afterProgrammaticZoom.scale -
          anchoredContentPoint.x,
      ) < 1e-8,
    );
    assert.ok(
      Math.abs(
        (zoomPoint.y - afterProgrammaticZoom.y) / afterProgrammaticZoom.scale -
          anchoredContentPoint.y,
      ) < 1e-8,
    );

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
    // Horizontal offsets from a centered page, derived from the tuned bands.
    const capture = size.width * PAN_SNAP_CAPTURE;
    const release = size.width * PAN_SNAP_RELEASE;
    const margin = 10;
    const outside = release + 40;
    // Wheel deltas that move the zoom by a log-scale distance.
    const zoomDelta = (distance: number) => distance / CANVAS_PINCH_ZOOM_SPEED;

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
    assert.ok(read().scale > partial.scale, "a partial-width page cannot capture the detent");
    assert.deepEqual(selections, []);
    // Restore the fit scale without a eligible page, then bring it wholly into view.
    time += 200;
    wheel(0, 1, { ctrlKey: true });
    flush();
    assert.ok(Math.abs(read().scale - fitted.scale) < 1e-8);
    pointer("pointerdown", 1, 400, 300);
    pointer("pointermove", 1, 400 + fitted.x + capture + margin - read().x, 300);
    pointer("pointerup", 1, 400, 300);
    const beforeSnap = read();
    wheel(0, -1, { ctrlKey: true });
    flush();
    assert.deepEqual(selections, ["page"]);
    assert.equal(read().x, fitted.x, "snap entry centers horizontally");
    assert.equal(read().y, beforeSnap.y, "entry retains vertical reading position");
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
    // With the entry step, stay strictly inside the release band.
    const heldSteps = Math.ceil(zoomDelta(ZOOM_SNAP_RELEASE)) - 2;
    for (let count = 0; count < heldSteps; count++) wheel(0, -1, { ctrlKey: true });
    flush(checkAnchor);
    assert.deepEqual(read(), beforeZoom, "small zoom input is held without recentering");
    assert.deepEqual(selections, ["page"], "held snap never repeats selection");
    for (let count = 0; count < 2; count++) wheel(0, -1, { ctrlKey: true });
    flush(checkAnchor);
    assert.ok(read().scale > fitted.scale, "accumulated gentle input escapes");
    pan(10, 90, 10, 90); // Outside snap, even overwhelmingly vertical motion is free.

    // 80% visibility allows capture from above too.
    const above = Math.log(read().scale / fitted.scale);
    wheel(0, zoomDelta(above - ZOOM_SNAP_CAPTURE / 2), { ctrlKey: true });
    flush();
    assert.equal(read().scale, fitted.scale);
    assert.deepEqual(selections, ["page", "page"]);
    const strongZoom = zoomDelta(ZOOM_SNAP_RELEASE + 0.1);
    wheel(0, strongZoom, { ctrlKey: true });
    flush();
    assert.ok(read().scale < fitted.scale, "strong input passes through the detent");
    time += 200;
    wheel(0, -strongZoom, { ctrlKey: true });
    flush();
    assert.equal(read().scale, fitted.scale, "capture also works from below");
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

    // Stop outside the horizontal capture band to test pinch entry independently.
    moveTo(fitted.x + capture + margin);
    const beforeTouchSnap = read();
    pointer("pointerdown", 1, 300, 300);
    pointer("pointerdown", 2, 500, 300);
    pointer("pointermove", 2, 502, 300);
    assert.equal(read().x, fitted.x, "touch entry centers without the pinch translation offset");
    assert.equal(read().y, beforeTouchSnap.y);
    assert.deepEqual(selections, ["page", "page", "page", "sibling", "page"]);
    pointer("pointerup", 1, 300, 300);
    pointer("pointerup", 2, 502, 300);

    const beforePinch = read();
    pointer("pointerdown", 1, 300, 300);
    pointer("pointerdown", 2, 500, 300);
    // Fingers start 200px apart; each step spreads them by 2px.
    const spread = (step: number) => Math.log((200 + step * 2) / 200);
    let step = 1;
    for (; spread(step - 1) <= ZOOM_SNAP_RELEASE; step++) {
      pointer("pointermove", 2, 500 + step * 2, 300);
      if (spread(step) < ZOOM_SNAP_RELEASE - 1e-6) assert.equal(read().scale, fitted.scale);
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
    pointer("pointerup", 2, 500 + (step - 1) * 2, 300);

    wheel(0, -10000, { ctrlKey: true });
    flush();
    assert.equal(read().scale, 2);
    wheel(0, 1, { ctrlKey: true });
    flush();
    assert.ok(read().scale < 2, "zoom limit does not retain excess intended input");
    pan(30, 0, 30, 0);
    const unsnapped = read();
    const selectionCount = selections.length;
    t.mock.timers.tick(180);
    flush();
    assert.deepEqual(read(), unsnapped, "horizontal snap is disabled away from page-fit zoom");
    assert.equal(selections.length, selectionCount);

    for (const offset of [
      -(ZOOM_SNAP_CAPTURE - 0.02),
      ZOOM_SNAP_CAPTURE - 0.02,
      -(ZOOM_SNAP_CAPTURE + 0.02),
      ZOOM_SNAP_CAPTURE + 0.02,
    ]) {
      // Zoom with the page mostly out of view to reach a non-detented scale.
      const centerAt = (scale: number) => size.width / 2 - (page.left + page.width / 2) * scale;
      moveTo(centerAt(read().scale) + 600);
      time += 200;
      const requestedScale = fitted.scale * Math.exp(offset);
      wheel(0, -Math.log(requestedScale / read().scale) / CANVAS_PINCH_ZOOM_SPEED, {
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
      assert.equal(read().scale, scale, "horizontal snapping must never change zoom");
      assert.equal(read().y, before.y, "horizontal snapping retains vertical position");
      if (Math.abs(offset) > ZOOM_SNAP_CAPTURE) {
        assertX(
          centeredX + capture - margin,
          "outside the zoom capture range horizontal motion stays free",
        );
        assert.deepEqual(selections, []);
        continue;
      }
      assertX(centeredX, "near-fit snapping centers at the actual scale on either side of fit");
      assert.deepEqual(selections, ["page"]);
      wheel(-(release - capture), 0);
      flush();
      assertX(centeredX, "near-fit detent holds accumulated intent");
      assert.deepEqual(selections, ["page"], "holding near fit must not repeatedly select");
      wheel(-2 * margin, 0);
      flush();
      assertX(centeredX + release + margin, "near-fit detent can still be escaped");
      wheel(release - capture + 2 * margin, 0);
      flush();
      assertX(centeredX, "reversing into the detent reacquires it");
      const beforeZoom = read();
      wheel(0, offset > 0 ? 1 : -1, { ctrlKey: true });
      flush();
      assert.equal(read().scale, fitted.scale, "zoom detent still works after horizontal snap");
      assertX(fitted.x, "entering exact-fit zoom recenters even for the already selected page");
      assert.ok(
        Math.abs((300 - read().y) / read().scale - (300 - beforeZoom.y) / beforeZoom.scale) < 1e-8,
        "zoom keeps its vertical anchor",
      );
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
      const expected = fitCanvas(size, { width: 1614, height });
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

void test("keepInView pans only to bring a world x to a screen x", async () => {
  const dom = new Window({ url: "http://localhost/camox/canvas" });
  let resize = () => {};
  const frames: ((time: number) => void)[] = [];
  let time = 0;
  const settle = () => {
    for (let i = 0; i < 1000 && frames.length; i++) frames.shift()!((time += 16));
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
    controls = useCanvasCamera("keep-in-view", undefined, {
      targets: [
        { key: "page:1", left: 0, width: 1366 },
        { key: "page:2", left: 1606, width: 1366 },
      ],
      width: 2972,
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
      offsetWidth: { get: () => 2972 },
      offsetHeight: { get: () => 900 },
    });
    resize();
    const camera = () => ({
      x: parseFloat(viewport.style.getPropertyValue("--canvas-x")),
      y: parseFloat(viewport.style.getPropertyValue("--canvas-y")),
      scale: Number(viewport.style.getPropertyValue("--canvas-zoom")),
    });
    const overview = camera();
    controls.keepInView(0, 12);
    assert.deepEqual(camera(), overview, "a visible world x does not pan");

    // Zoom in on the second Page so the row's start is far off-screen.
    controls.zoomAt({ x: size.width, y: 0 }, 1);
    settle();
    const zoomed = camera();
    assert.ok(zoomed.x < 12, "the row starts off-screen");
    controls.keepInView(0, 12);
    assert.deepEqual(camera(), { ...zoomed, x: 12 }, "pans only horizontally, to the screen x");
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

    const popover = dom.document.createElement("div");
    popover.setAttribute("data-canvas-overlay-scroll", "");
    const composer = dom.document.createElement("textarea");
    popover.append(composer);
    viewport.append(popover);
    const beforePopoverScroll = style.cssText;
    for (const deltaX of [0, 20]) {
      const event = new dom.WheelEvent("wheel", {
        deltaX,
        deltaY: 100,
        bubbles: true,
        cancelable: true,
      });
      composer.dispatchEvent(event);
      assert.equal(event.defaultPrevented, false, "popover wheel input keeps native scrolling");
      assert.equal(
        style.cssText,
        beforePopoverScroll,
        "scrolling feedback does not pan the canvas",
      );
    }
    popover.remove();

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
