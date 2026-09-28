import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canvasBounds,
  canvasInsets,
  canvasWheelDelta,
  constrainCanvasCamera,
  fitCanvas,
  fitCanvasPage,
  MAX_CANVAS_ZOOM,
  zoomCanvasAt,
} from "./canvasCamera";

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
