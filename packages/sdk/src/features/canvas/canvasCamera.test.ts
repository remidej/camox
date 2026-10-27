import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CANVAS_HEADER_HEIGHT,
  CANVAS_PAGE_FIT_PADDING,
  CANVAS_OVERSCROLL,
  canvasMaximumScale,
  stretchCanvasZoom,
  unstretchCanvasZoom,
  ZOOM_STRETCH,
  canvasInsets,
  canvasMinimumScale,
  canvasOverview,
  findCanvasSnapTarget,
  canvasVerticalRail,
  canvasWheelDelta,
  constrainCanvasCamera,
  fitCanvas,
  fitCanvasPage,
  isCanvasCameraSnapped,
  isCanvasPageScale,
  isInCanvasSnapWindow,
  MAX_CANVAS_ZOOM,
  MIN_CANVAS_ZOOM,
  snapCanvasZoom,
  PAN_SNAP_CAPTURE,
  PAN_SNAP_RELEASE,
  ZOOM_SNAP_CAPTURE,
  ZOOM_SNAP_RELEASE,
  zoomCanvasAt,
  type CanvasVerticalRail,
} from "./canvasCamera";

void test("snap candidates require 80% horizontal visibility and choose the nearest center stably", () => {
  const viewport = { width: 900, height: 800 };
  const pages = [
    { key: "first", left: 0, width: 300 },
    { key: "second", left: 400, width: 300 },
    { key: "third", left: 800, width: 300 },
  ];
  assert.equal(findCanvasSnapTarget({ x: 0, y: -90000, scale: 1 }, viewport, pages), pages[1]);
  assert.equal(findCanvasSnapTarget({ x: 0, y: 90000, scale: 1 }, viewport, pages), pages[1]);
  assert.equal(findCanvasSnapTarget({ x: 100, y: 0, scale: 1 }, viewport, pages), pages[0]);
  assert.equal(findCanvasSnapTarget({ x: -61, y: 0, scale: 1 }, viewport, [pages[0]]), undefined);
  assert.equal(findCanvasSnapTarget({ x: -60, y: 0, scale: 1 }, viewport, [pages[0]]), pages[0]);
  assert.equal(findCanvasSnapTarget({ x: 661, y: 0, scale: 1 }, viewport, [pages[0]]), undefined);
  assert.equal(findCanvasSnapTarget({ x: 660, y: 0, scale: 1 }, viewport, [pages[0]]), pages[0]);
  assert.equal(findCanvasSnapTarget({ x: 0, y: 0, scale: 4 }, viewport, pages), undefined);
});

void test("page zoom detent captures from either side with a wider release band", () => {
  const at = (pageScale: number, distance: number) => pageScale * Math.exp(distance);
  for (const pageScale of [0.3, 0.8, 1.5]) {
    for (const direction of [-1, 1]) {
      const approaching = at(pageScale, (direction * (ZOOM_SNAP_CAPTURE + ZOOM_SNAP_RELEASE)) / 2);
      const near = at(pageScale, direction * (ZOOM_SNAP_CAPTURE - 0.001));
      assert.equal(snapCanvasZoom(approaching, near, pageScale), pageScale);
      const outsideCapture = at(pageScale, direction * (ZOOM_SNAP_CAPTURE + 0.001));
      assert.equal(snapCanvasZoom(approaching, outsideCapture, pageScale), outsideCapture);
      const held = at(pageScale, direction * (ZOOM_SNAP_RELEASE - 0.001));
      assert.equal(snapCanvasZoom(pageScale, held, pageScale), pageScale);
      assert.equal(snapCanvasZoom(approaching, held, pageScale), held);
      const outsideRelease = at(pageScale, direction * (ZOOM_SNAP_RELEASE + 0.001));
      assert.equal(snapCanvasZoom(pageScale, outsideRelease, pageScale), outsideRelease);
      const strong = at(pageScale, -direction * (ZOOM_SNAP_RELEASE + 0.1));
      assert.equal(snapCanvasZoom(approaching, strong, pageScale), strong);
      assert.equal(snapCanvasZoom(pageScale, strong, pageScale), strong);

      const step = 0.01;
      let scale = pageScale;
      let intended = scale;
      for (let count = 1; count * step <= ZOOM_SNAP_RELEASE + step; count++) {
        intended *= Math.exp(direction * step);
        scale = snapCanvasZoom(scale, intended, pageScale);
        if (count * step < ZOOM_SNAP_RELEASE - 1e-6) assert.equal(scale, pageScale);
      }
      assert.equal(scale, intended, "small deltas accumulate to escape in either direction");
    }
  }
  assert.equal(snapCanvasZoom(0.4, 0.5, undefined), 0.5);
});

void test("a camera is snapped to a target only at its page fit, centered on it", () => {
  const viewport = { width: 900, height: 800 };
  const page = { left: 1606, width: 1366 };
  const fit = fitCanvasPage(viewport, page);
  assert.equal(isCanvasCameraSnapped(fit, viewport, page), true);
  assert.equal(isCanvasCameraSnapped({ ...fit, y: -4000 }, viewport, page), true);
  assert.equal(isCanvasCameraSnapped({ ...fit, x: fit.x + 2 }, viewport, page), false);
  const zoomedOut = zoomCanvasAt(fit, { x: viewport.width / 2, y: 0 }, fit.scale * 0.99);
  assert.equal(isCanvasCameraSnapped(zoomedOut, viewport, page), false);
  assert.equal(isCanvasCameraSnapped(fit, viewport, { ...page, left: page.left + 10 }), false);
});

void test("the snap window needs both zoom and position near the page fit, held wider", () => {
  const viewport = { width: 900, height: 800 };
  const page = { left: 1606, width: 1366 };
  const fit = fitCanvasPage(viewport, page);
  const center = page.left + page.width / 2;
  // A camera at a log-scale zoom distance from the fit and a screen offset from the page's center.
  const at = (zoom: number, offset: number) => {
    const scale = fit.scale * Math.exp(zoom);
    return { x: viewport.width / 2 + offset - center * scale, y: 0, scale };
  };
  const capture = { zoom: ZOOM_SNAP_CAPTURE, pan: viewport.width * PAN_SNAP_CAPTURE };
  const release = { zoom: ZOOM_SNAP_RELEASE, pan: viewport.width * PAN_SNAP_RELEASE };
  for (const held of [false, true]) {
    const band = held ? release : capture;
    for (const sign of [-1, 1]) {
      const inside = at(sign * (band.zoom - 0.001), -sign * (band.pan - 1));
      assert.equal(isInCanvasSnapWindow(inside, viewport, page, held), true);
      const zoomedPast = at(sign * (band.zoom + 0.001), 0);
      assert.equal(isInCanvasSnapWindow(zoomedPast, viewport, page, held), false);
      const pannedPast = at(0, sign * (band.pan + 1));
      assert.equal(isInCanvasSnapWindow(pannedPast, viewport, page, held), false);
    }
  }
  const between = at((ZOOM_SNAP_CAPTURE + ZOOM_SNAP_RELEASE) / 2, 0);
  assert.equal(isInCanvasSnapWindow(between, viewport, page, false), false);
  assert.equal(isInCanvasSnapWindow(between, viewport, page, true), true);
});

void test("the zoom ceiling is the page fit, or the zoom limit without targets", () => {
  const viewport = { width: 900, height: 800 };
  const narrow = { left: 0, width: 600 };
  const wide = { left: 700, width: 1366 };
  assert.equal(
    canvasMaximumScale(viewport, [wide, narrow], 0.1),
    fitCanvasPage(viewport, narrow).scale,
    "every target's snap stays reachable",
  );
  assert.equal(canvasMaximumScale(viewport, [], 0.1), MAX_CANVAS_ZOOM);
  assert.equal(canvasMaximumScale(viewport, [wide], 0.9), 0.9, "never below the zoom floor");
  const content = { width: 3000, height: 9000 };
  const ceiling = canvasMaximumScale(viewport, [wide], 0.1);
  assert.equal(
    constrainCanvasCamera({ x: 0, y: 0, scale: ceiling * 2 }, viewport, content, ceiling).scale,
    ceiling,
  );
});

void test("the rail assists vertical intent only and releases to free two-axis motion", () => {
  const locked = canvasVerticalRail({ x: 50, y: 90 }, 0);
  assert.equal(locked.mode, "vertical", "substantially wider vertical acquisition");
  assert.equal(canvasVerticalRail({ x: -50, y: -90 }, 0).mode, "vertical");
  assert.equal(canvasVerticalRail({ x: 75, y: 90 }, 16, locked).mode, "vertical");
  for (const delta of [
    { x: 90, y: 10 },
    { x: 90, y: 90 },
    { x: 90, y: 0 },
  ]) {
    const free = canvasVerticalRail(delta, 0);
    assert.equal(free.mode, "free");
    assert.equal(canvasVerticalRail(delta, 16, locked).mode, "free");
    assert.equal(canvasVerticalRail({ x: 1, y: 30 }, 32, free).mode, "free");
  }
  assert.equal(isCanvasPageScale(0.6, 0.6), true);
  assert.equal(isCanvasPageScale(0.6001, 0.6), false);
  assert.equal(isCanvasPageScale(0.6, undefined), false);
});

void test("noisy trackpad startup can acquire vertical intent in either direction", () => {
  for (const direction of [-1, 1]) {
    let rail: CanvasVerticalRail | undefined;
    let time = 0;
    for (const [x, y, expected] of [
      [3, 0.5, "pending"],
      [-2, 4, "pending"],
      [4, 16, "vertical"],
      [-15, 24, "vertical"],
      [1, 0, "vertical"],
      [0.2, 2, "vertical"],
    ] as const) {
      rail = canvasVerticalRail({ x: direction * x, y: direction * y }, time, rail);
      assert.equal(rail.mode, expected);
      time += 8;
    }
  }
});

void test("rail release ignores tiny jitter but responds to sustained diagonal or horizontal intent", () => {
  const locked = canvasVerticalRail({ x: 20, y: 60 }, 0);
  const jitter = canvasVerticalRail({ x: 4, y: 1 }, 8, locked);
  assert.equal(jitter.mode, "vertical");
  const recovered = canvasVerticalRail({ x: 20, y: 40 }, 16, jitter);
  assert.equal(recovered.mode, "vertical");
  for (const y of [0, 6]) {
    let rail = recovered;
    for (let step = 1; step <= 3; step++) {
      rail = canvasVerticalRail({ x: 6, y }, 16 + step * 8, rail);
      assert.equal(rail.mode, step < 3 ? "vertical" : "free");
    }
    for (const [x, tailY] of [
      [3, 12],
      [1, 6],
      [0.1, 2],
    ]) {
      rail = canvasVerticalRail({ x, y: tailY }, 64, rail);
      assert.equal(rail.mode, "free", "released momentum cannot reacquire");
    }
  }
  const staleJitter = canvasVerticalRail({ x: 12, y: 0 }, 8, locked);
  assert.equal(canvasVerticalRail({ x: 4, y: 0 }, 96, staleJitter).mode, "vertical");
});

void test("pending evidence expires and alternating horizontal deltas cannot cancel", () => {
  const noise = canvasVerticalRail({ x: 12, y: 1 }, 0);
  assert.equal(noise.mode, "pending");
  assert.equal(canvasVerticalRail({ x: 4, y: 16 }, 96, noise).mode, "vertical");
  const free = canvasVerticalRail({ x: -12, y: 1 }, 8, noise);
  assert.equal(free.mode, "free");
  assert.equal(canvasVerticalRail({ x: 1, y: 20 }, 16, free).mode, "free");
});

void test("the initial page view fits its width within its padding, regardless of site height", () => {
  const viewport = { width: 900, height: 800 };
  for (const left of [0, 1606, 3212]) {
    const page = { left, width: 1366 };
    const camera = fitCanvasPage(viewport, page);
    assert.equal(camera.scale, (900 - CANVAS_PAGE_FIT_PADDING * 2) / 1366);
    assert.ok(Math.abs(camera.x + left * camera.scale - CANVAS_PAGE_FIT_PADDING) < 1e-8);
    assert.equal(
      camera.y,
      CANVAS_PAGE_FIT_PADDING + CANVAS_HEADER_HEIGHT,
      "the page header shows above the page",
    );
    for (const height of [900, 30000])
      assert.deepEqual(constrainCanvasCamera(camera, viewport, { width: 4578, height }), camera);
  }
  const tiny = fitCanvasPage({ width: 0, height: 0 }, { left: 0, width: 1366 });
  assert.ok(tiny.scale > 0 && Number.isFinite(tiny.scale));
  assert.equal(
    fitCanvasPage({ width: 10000, height: 900 }, { left: 0, width: 1366 }).scale,
    MAX_CANVAS_ZOOM,
  );
});

void test("zoom keeps the document point under the pointer stationary", () => {
  const camera = { x: -350, y: 120, scale: 0.4 };
  const pointer = { x: 500, y: 260 };
  const next = zoomCanvasAt(camera, pointer, 0.75);
  assert.equal((pointer.x - next.x) / next.scale, (pointer.x - camera.x) / camera.scale);
  assert.equal((pointer.y - next.y) / next.scale, (pointer.y - camera.y) / camera.scale);
});

void test("zoom clamps without moving the anchor at either limit", () => {
  const pointer = { x: 250, y: 100 };
  const minimumScale = fitCanvas({ width: 1440, height: 900 }, { width: 6000, height: 1800 }).scale;
  for (const scale of [minimumScale, MAX_CANVAS_ZOOM]) {
    const camera = { x: 50, y: 40, scale };
    const requested = scale === minimumScale ? 0.00001 : 100;
    assert.deepEqual(zoomCanvasAt(camera, pointer, requested, minimumScale), camera);
  }
});

void test("fit includes wide and tall documents with room for page labels", () => {
  const viewport = { width: 1440, height: 900 };
  const padding = canvasInsets(viewport);
  for (const content of [
    { width: 4000, height: 1200 },
    { width: 1440, height: 10000 },
    { width: 100000, height: 2000 },
    { width: 1440, height: 100000 },
  ]) {
    const camera = fitCanvas(viewport, content);
    assert.ok(camera.x >= padding.x - 1e-8);
    assert.ok(camera.y >= padding.top - 1e-8);
    assert.ok(camera.x + content.width * camera.scale <= viewport.width - padding.x + 1e-8);
    assert.ok(camera.y + content.height * camera.scale <= viewport.height - padding.bottom + 1e-8);
  }
});

void test("empty content and a tiny viewport still produce a finite positive camera", () => {
  const camera = fitCanvas({ width: 10, height: 10 }, { width: 0, height: 0 });
  assert.ok(Object.values(camera).every(Number.isFinite));
  assert.ok(camera.scale > 0);
});

const assertNear = (actual: number, expected: number, message?: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, message ?? `${actual} != ${expected}`);

// Screen-space empty canvas allowed beside the content, per side.
const gap = (viewport: { width: number; height: number }) => ({
  x: viewport.width * CANVAS_OVERSCROLL,
  y: viewport.height * CANVAS_OVERSCROLL,
});

void test("panning stops with the same empty canvas beside the content at every zoom level", () => {
  const viewport = { width: 1440, height: 900 };
  const content = { width: 6000, height: 3000 };
  for (const scale of [canvasMinimumScale(viewport, content), 0.5, 1, MAX_CANVAS_ZOOM]) {
    const start = constrainCanvasCamera({ x: 1e6, y: 1e6, scale }, viewport, content);
    const end = constrainCanvasCamera({ x: -1e6, y: -1e6, scale }, viewport, content);
    if (content.width * scale > viewport.width - gap(viewport).x) {
      assertNear(start.x, gap(viewport).x, "the content's left edge stops at its gap");
      assertNear(viewport.width - (end.x + content.width * scale), gap(viewport).x);
    }
    if (content.height * scale > viewport.height - gap(viewport).y) {
      assertNear(start.y, gap(viewport).y, "the content's top edge stops at its gap");
      assertNear(viewport.height - (end.y + content.height * scale), gap(viewport).y);
    }
  }
});

void test("content smaller than the empty canvas can sit anywhere fully in view", () => {
  const viewport = { width: 1440, height: 900 };
  const content = { width: 390, height: 300 };
  const start = constrainCanvasCamera({ x: 1e6, y: 1e6, scale: 1 }, viewport, content);
  const end = constrainCanvasCamera({ x: -1e6, y: -1e6, scale: 1 }, viewport, content);
  assert.deepEqual(start, {
    x: viewport.width - content.width,
    y: viewport.height - content.height,
    scale: 1,
  });
  assert.deepEqual(end, { x: 0, y: 0, scale: 1 });
});

void test("zooming in cannot pan narrow content out of view", () => {
  const viewport = { width: 1440, height: 900 };
  const content = { width: 390, height: 6000 };
  for (const x of [-1e6, 1e6]) {
    const camera = constrainCanvasCamera({ x, y: -400, scale: 1 }, viewport, content);
    assert.ok(camera.x < viewport.width && camera.x + content.width > 0);
  }
});

void test("zooming out stops at the zoom floor, which leaves large sites in view", () => {
  const viewport = { width: 1440, height: 900 };
  for (const content of [
    { width: 6000, height: 3000 },
    { width: 100000, height: 2000 },
  ]) {
    const floor = canvasMinimumScale(viewport, content);
    assert.equal(floor, Math.max(MIN_CANVAS_ZOOM, fitCanvas(viewport, content).scale));
    for (const corner of [-1e6, 1e6]) {
      const camera = constrainCanvasCamera(
        { x: corner, y: corner, scale: floor / 10 },
        viewport,
        content,
      );
      assert.equal(camera.scale, floor);
      assert.ok(camera.x < viewport.width && camera.x + content.width * floor > 0);
      assert.ok(camera.y < viewport.height && camera.y + content.height * floor > 0);
    }
  }
});

void test("zooming out from an edge page keeps the anchor instead of pulling the view", () => {
  const viewport = { width: 1440, height: 900 };
  const content = { width: 100000, height: 2000 };
  const floor = canvasMinimumScale(viewport, content);
  for (const page of [
    { left: 0, width: 1366 },
    { left: content.width - 1366, width: 1366 },
  ]) {
    const fitted = fitCanvasPage(viewport, page);
    // The viewport's center, and the edge page's own side of it.
    const side = page.left === 0 ? 0.25 : 0.75;
    for (const pointer of [
      { x: viewport.width / 2, y: viewport.height / 2 },
      { x: viewport.width * side, y: 200 },
    ]) {
      for (const scale of [fitted.scale / 2, floor]) {
        const zoomed = zoomCanvasAt(fitted, pointer, scale, floor);
        const constrained = constrainCanvasCamera(zoomed, viewport, content);
        assertNear(constrained.x, zoomed.x, `x at ${JSON.stringify({ page, pointer, scale })}`);
        assertNear(constrained.y, zoomed.y, `y at ${JSON.stringify({ page, pointer, scale })}`);
        assert.equal(constrained.scale, zoomed.scale);
      }
    }
  }
});

void test("animation between valid cameras never needs intermediate clamping", () => {
  const viewport = { width: 1280, height: 523 };
  const content = { width: 6184, height: 5058 };
  // The most zoomed-out valid camera: this overview is too large to fit above the floor.
  const start = canvasOverview(viewport, content);
  const end = constrainCanvasCamera({ x: -1e6, y: 1e6, scale: 1 }, viewport, content);
  for (let step = 0; step <= 100; step++) {
    const amount = step / 100;
    const camera = {
      x: start.x + (end.x - start.x) * amount,
      y: start.y + (end.y - start.y) * amount,
      scale: start.scale + (end.scale - start.scale) * amount,
    };
    const clamped = constrainCanvasCamera(camera, viewport, content);
    assert.ok(Math.abs(camera.x - clamped.x) < 1e-8);
    assert.ok(Math.abs(camera.y - clamped.y) < 1e-8);
    assert.equal(camera.scale, clamped.scale);
  }
});

void test("wheel input normalizes pixel, line, and page deltas", () => {
  assert.equal(canvasWheelDelta(2, 0, 800), 2);
  assert.equal(canvasWheelDelta(2, 1, 800), 32);
  assert.equal(canvasWheelDelta(-1, 2, 800), -800);
});

void test("zoom past a limit stretches with growing resistance, never beyond the stretch, and inverts", () => {
  const [minimum, maximum] = [0.2, 0.8];
  for (const scale of [minimum, 0.5, maximum])
    assert.equal(
      stretchCanvasZoom(scale, minimum, maximum),
      scale,
      "within the limits, intent is exact",
    );
  for (const [limit, direction] of [
    [maximum, 1],
    [minimum, -1],
  ] as const) {
    let previous = limit;
    let previousGain = Infinity;
    for (let overshoot = 0.1; overshoot <= 10; overshoot += 0.1) {
      const intended = limit * Math.exp(direction * overshoot);
      const stretched = stretchCanvasZoom(intended, minimum, maximum);
      const distance = Math.abs(Math.log(stretched / limit));
      const gain = distance - Math.abs(Math.log(previous / limit));
      assert.ok(gain > 0 && gain < previousGain, "each step past the limit gains less");
      assert.ok(distance < ZOOM_STRETCH && distance < overshoot, "it resists and stays bounded");
      assert.ok(
        Math.abs(Math.log(unstretchCanvasZoom(stretched, minimum, maximum) / intended)) < 1e-9,
        "the displayed scale gives back its intent",
      );
      previous = stretched;
      previousGain = gain;
    }
  }
});
