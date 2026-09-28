import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canvasBounds,
  canvasInsets,
  canvasSnapPage,
  canvasVerticalRail,
  canvasWheelDelta,
  constrainCanvasCamera,
  fitCanvas,
  fitCanvasPage,
  isCanvasPageScale,
  MAX_CANVAS_ZOOM,
  snapCanvasZoom,
  zoomCanvasAt,
  type CanvasVerticalRail,
} from "./canvasCamera";

void test("snap candidates require full horizontal visibility and choose the nearest center stably", () => {
  const viewport = { width: 900, height: 800 };
  const pages = [
    { key: "first", left: 0, width: 300 },
    { key: "second", left: 400, width: 300 },
    { key: "third", left: 800, width: 300 },
  ];
  assert.equal(canvasSnapPage({ x: 0, y: -90000, scale: 1 }, viewport, pages), pages[1]);
  assert.equal(canvasSnapPage({ x: 0, y: 90000, scale: 1 }, viewport, pages), pages[1]);
  assert.equal(canvasSnapPage({ x: 100, y: 0, scale: 1 }, viewport, pages), pages[0]);
  assert.equal(canvasSnapPage({ x: -1, y: 0, scale: 1 }, viewport, [pages[0]]), undefined);
  assert.equal(canvasSnapPage({ x: 601, y: 0, scale: 1 }, viewport, [pages[0]]), undefined);
  assert.equal(canvasSnapPage({ x: 600, y: 0, scale: 1 }, viewport, [pages[0]]), pages[0]);
  assert.equal(canvasSnapPage({ x: 0, y: 0, scale: 4 }, viewport, pages), undefined);
});

void test("page zoom detent captures from either side with a wider release band", () => {
  for (const pageScale of [0.3, 0.8, 1.5]) {
    for (const direction of [-1, 1]) {
      const approaching = pageScale * Math.exp(direction * 0.1);
      const near = pageScale * Math.exp(direction * 0.059);
      assert.equal(snapCanvasZoom(approaching, near, pageScale), pageScale);
      const outsideCapture = pageScale * Math.exp(direction * 0.061);
      assert.equal(snapCanvasZoom(approaching, outsideCapture, pageScale), outsideCapture);
      const held = pageScale * Math.exp(direction * 0.119);
      assert.equal(snapCanvasZoom(pageScale, held, pageScale), pageScale);
      assert.equal(snapCanvasZoom(approaching, held, pageScale), held);
      const outsideRelease = pageScale * Math.exp(direction * 0.121);
      assert.equal(snapCanvasZoom(pageScale, outsideRelease, pageScale), outsideRelease);
      const strong = pageScale * Math.exp(-direction * 0.3);
      assert.equal(snapCanvasZoom(approaching, strong, pageScale), strong);
      assert.equal(snapCanvasZoom(pageScale, strong, pageScale), strong);

      let scale = pageScale;
      let intended = scale;
      for (let step = 0; step < 14; step++) {
        intended *= Math.exp(direction * 0.01);
        scale = snapCanvasZoom(scale, intended, pageScale);
        if (step < 11) assert.equal(scale, pageScale);
      }
      assert.equal(scale, intended, "small deltas accumulate to escape in either direction");
    }
  }
  assert.equal(snapCanvasZoom(0.4, 0.5, undefined), 0.5);
});

void test("snapping changes scale at the anchor, not the page position", () => {
  const camera = { x: -750, y: -900, scale: 0.63 };
  const point = { x: 320, y: 180 };
  const pageScale = fitCanvasPage({ width: 900, height: 800 }, { left: 1606, width: 1366 }).scale;
  const next = zoomCanvasAt(camera, point, snapCanvasZoom(camera.scale, 0.62, pageScale));
  assert.equal(next.scale, pageScale);
  assert.ok(Math.abs((point.x - next.x) / next.scale - (point.x - camera.x) / camera.scale) < 1e-8);
  assert.ok(Math.abs((point.y - next.y) / next.scale - (point.y - camera.y) / camera.scale) < 1e-8);
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

void test("the initial page view fits its width with 24px padding, regardless of site height", () => {
  const viewport = { width: 900, height: 800 };
  for (const left of [0, 1606, 3212]) {
    const page = { left, width: 1366 };
    const camera = fitCanvasPage(viewport, page);
    assert.equal(camera.scale, (900 - 48) / 1366);
    assert.ok(Math.abs(camera.x + left * camera.scale - 24) < 1e-8);
    assert.equal(camera.y, 76);
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

void test("panning stops at the same four world edges at every zoom level", () => {
  const viewport = { width: 1440, height: 900 };
  const content = { width: 6000, height: 3000 };
  const bounds = canvasBounds(viewport, content);
  for (const scale of [bounds.minimumScale, 0.5, 1, MAX_CANVAS_ZOOM]) {
    const start = constrainCanvasCamera({ x: 1e6, y: 1e6, scale }, viewport, content);
    const end = constrainCanvasCamera({ x: -1e6, y: -1e6, scale }, viewport, content);
    assert.ok(Math.abs(-start.x / scale - bounds.left) < 1e-8);
    assert.ok(Math.abs(-start.y / scale - bounds.top) < 1e-8);
    assert.ok(Math.abs((viewport.width - end.x) / scale - bounds.right) < 1e-8);
    assert.ok(Math.abs((viewport.height - end.y) / scale - bounds.bottom) < 1e-8);
  }
});

void test("zooming out stops at the complete overview and cannot pan it out of view", () => {
  const viewport = { width: 1440, height: 900 };
  const content = { width: 6000, height: 3000 };
  const fit = fitCanvas(viewport, content);
  for (const scale of [fit.scale, fit.scale / 10]) {
    const camera = constrainCanvasCamera({ x: -1e6, y: 1e6, scale }, viewport, content);
    assert.ok(Math.abs(camera.x - fit.x) < 1e-8);
    assert.ok(Math.abs(camera.y - fit.y) < 1e-8);
    assert.equal(camera.scale, fit.scale);
  }
});

void test("zooming into an overview preserves off-center anchors on both axes", () => {
  const viewport = { width: 1280, height: 523 };
  for (const content of [
    { width: 6184, height: 5058 },
    { width: 390, height: 6000 },
    { width: 12000, height: 300 },
  ]) {
    const fit = fitCanvas(viewport, content);
    for (const pointer of [
      { x: 250, y: 230 },
      { x: 1000, y: 450 },
    ]) {
      const zoomed = zoomCanvasAt(fit, pointer, fit.scale * 2, fit.scale);
      assert.deepEqual(constrainCanvasCamera(zoomed, viewport, content), zoomed);
    }
  }
});

void test("the shorter axis can pan inside the overview's spare space after zooming in", () => {
  const viewport = { width: 1440, height: 900 };
  const content = { width: 390, height: 6000 };
  const camera = { x: -200, y: -400, scale: 1 };
  assert.deepEqual(constrainCanvasCamera(camera, viewport, content), camera);
});

void test("animation between valid cameras never needs intermediate clamping", () => {
  const viewport = { width: 1280, height: 523 };
  const content = { width: 6184, height: 5058 };
  const start = fitCanvas(viewport, content);
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

void test("a viewport or document size change restores valid bounds without needless resets", () => {
  const viewport = { width: 1440, height: 900 };
  const camera = { x: -500, y: -600, scale: 1 };
  assert.deepEqual(constrainCanvasCamera(camera, viewport, { width: 6000, height: 4000 }), camera);
  const small = { width: 390, height: 300 };
  assert.deepEqual(constrainCanvasCamera(camera, viewport, small), fitCanvas(viewport, small));
});

void test("wheel input normalizes pixel, line, and page deltas", () => {
  assert.equal(canvasWheelDelta(2, 0, 800), 2);
  assert.equal(canvasWheelDelta(2, 1, 800), 32);
  assert.equal(canvasWheelDelta(-1, 2, 800), -800);
});
