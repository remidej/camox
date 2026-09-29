import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canvasBounds,
  constrainCanvasCamera,
  fitCanvas,
  MAX_CANVAS_ZOOM,
  type CanvasCamera,
} from "./canvasCamera";
import { createCanvasFlight } from "./canvasFlight";

const viewport = { width: 1000, height: 800 };
const content = { width: 20000, height: 12000 };
const start = constrainCanvasCamera({ x: 0, y: 0, scale: 1 }, viewport, content);
const end = constrainCanvasCamera({ x: -18000, y: -10000, scale: 1 }, viewport, content);

void test("far flights translate and zoom together in one continuous arc", () => {
  const flight = createCanvasFlight(start, end, viewport, content);
  assert.ok(flight.duration >= 1000 && flight.duration <= 2500);
  assert.deepEqual(flight.at(0), start);
  assert.deepEqual(flight.at(1), end);
  assert.deepEqual(flight.at(-1), start);
  assert.deepEqual(flight.at(2), end);
  assert.ok(flight.at(0.1).scale < start.scale);
  assert.ok(flight.at(0.25).scale < flight.at(0.1).scale);
  assert.ok(flight.at(0.9).scale > flight.at(0.75).scale);
  const worldX = (camera: CanvasCamera) => (viewport.width / 2 - camera.x) / camera.scale;
  let landing = false;
  for (let i = 1; i <= 100; i++) {
    const before = flight.at((i - 1) / 100);
    const after = flight.at(i / 100);
    assert.ok(worldX(after) > worldX(before), "translation never waits for a zoom phase");
    assert.notEqual(after.scale, before.scale, "zoom has no cruising plateau");
    if (after.scale > before.scale) landing = true;
    else assert.equal(landing, false, "the arc changes zoom direction only once");
  }
  assert.equal(landing, true);
});

void test("flight has smooth velocity through the former phase boundaries and eases at both ends", () => {
  const flight = createCanvasFlight(start, end, viewport, content);
  const coordinates = (progress: number) => {
    const camera = flight.at(progress);
    return [
      (viewport.width / 2 - camera.x) / camera.scale,
      (viewport.height / 2 - camera.y) / camera.scale,
      1 / camera.scale,
    ];
  };
  const epsilon = 1e-6;
  for (const progress of [0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9]) {
    const before = coordinates(progress - epsilon);
    const at = coordinates(progress);
    const after = coordinates(progress + epsilon);
    for (let axis = 0; axis < 3; axis++) {
      const leftVelocity = (at[axis]! - before[axis]!) / epsilon;
      const rightVelocity = (after[axis]! - at[axis]!) / epsilon;
      assert.ok(
        Math.abs(leftVelocity - rightVelocity) < Math.max(1, Math.abs(leftVelocity)) * 0.002,
        "the curve must not have velocity discontinuities",
      );
    }
  }
  for (const endpoint of [0, 1]) {
    const direction = endpoint === 0 ? 1 : -1;
    const at = coordinates(endpoint);
    const near = coordinates(endpoint + direction * 0.001);
    const farther = coordinates(endpoint + direction * 0.002);
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(
        Math.abs(near[axis]! - at[axis]!) < Math.abs(farther[axis]! - at[axis]!) * 0.3,
        "all coordinates ease into and out of motion",
      );
    }
  }
});

void test("nearby visible destinations do not trigger a retreat", () => {
  const nearby = { ...start, x: start.x - 200, y: start.y - 100 };
  const flight = createCanvasFlight(start, nearby, viewport, content);
  for (let i = 0; i <= 100; i++) assert.equal(flight.at(i / 100).scale, 1);
});

void test("flight preserves gentle takeoff and gives landing a much slower tail", () => {
  const nearby = { ...start, x: start.x - 200, y: start.y - 100 };
  const flight = createCanvasFlight(start, nearby, viewport, content);
  const traveled = (progress: number) => (flight.at(progress).x - start.x) / (nearby.x - start.x);
  assert.ok(traveled(0.08) > 0 && traveled(0.08) < 0.01, "takeoff remains gentle in real time");
  assert.ok(traveled(0.9) > 0.998 && traveled(0.9) < 1, "last tenth settles less than 0.2%");
  assert.ok(
    traveled(0.95) > 0.9999 && traveled(0.95) < 1,
    "final approach settles less than 0.01%",
  );
  assert.ok(traveled(0.5) > 0.5, "more of the duration is reserved for landing");
  assert.ok(1 - traveled(0.9) < traveled(0.1) / 10, "arrival is much softer than departure");
});

void test("the final animation frame lands without a visible translation or zoom jump", () => {
  const flight = createCanvasFlight(start, end, viewport, content);
  const before = flight.at(1 - 16 / flight.duration);
  assert.ok(Math.abs(before.x - end.x) < 0.05);
  assert.ok(Math.abs(before.y - end.y) < 0.05);
  assert.ok(Math.abs(before.scale - end.scale) * viewport.width < 0.05);
});

void test("stationary-center zoom is monotonic and never overshoots endpoints", () => {
  const from = { x: -5000, y: -4000, scale: 1 };
  const to = {
    x: viewport.width / 2 - (viewport.width / 2 - from.x) * 2,
    y: viewport.height / 2 - (viewport.height / 2 - from.y) * 2,
    scale: 2,
  };
  const flight = createCanvasFlight(from, to, viewport, content);
  let previous = from.scale;
  for (let i = 0; i <= 100; i++) {
    const camera = flight.at(i / 100);
    assert.ok(camera.scale >= previous && camera.scale <= to.scale);
    previous = camera.scale;
  }
});

void test("all intermediate cameras respect overview bounds and maximum zoom", () => {
  const bounds = canvasBounds(viewport, content);
  const overview = fitCanvas(viewport, content);
  for (const [from, to] of [
    [start, end],
    [end, start],
    [overview, end],
    [end, overview],
  ]) {
    const flight = createCanvasFlight(from!, to!, viewport, content);
    for (let i = 0; i <= 100; i++) {
      const camera = flight.at(i / 100);
      assert.ok(camera.scale >= bounds.minimumScale - 1e-12);
      assert.ok(camera.scale <= MAX_CANVAS_ZOOM);
      assert.ok(camera.x <= -bounds.left * camera.scale + 1e-8);
      assert.ok(camera.x >= viewport.width - bounds.right * camera.scale - 1e-8);
      assert.ok(camera.y <= -bounds.top * camera.scale + 1e-8);
      assert.ok(camera.y >= viewport.height - bounds.bottom * camera.scale - 1e-8);
    }
  }
});

void test("zero and tiny viewports produce deterministic finite samples", () => {
  for (const size of [
    { width: 0, height: 0 },
    { width: 1e-12, height: 1e-12 },
  ]) {
    const from = fitCanvas(size, content);
    const to = constrainCanvasCamera({ x: -500, y: -500, scale: 2 }, size, content);
    const flight = createCanvasFlight(from, to, size, content);
    const repeat = createCanvasFlight(from, to, size, content);
    assert.ok(Number.isFinite(flight.duration));
    for (let i = 0; i <= 100; i++) {
      const camera = flight.at(i / 100);
      assert.deepEqual(camera, repeat.at(i / 100));
      assert.ok(Object.values(camera).every(Number.isFinite));
      assert.ok(camera.scale > 0 && camera.scale <= MAX_CANVAS_ZOOM);
    }
  }
});

void test("identical cameras need no animation", () => {
  const flight = createCanvasFlight(start, { ...start }, viewport, content);
  assert.equal(flight.duration, 0);
  for (const progress of [0, 0.2, 0.5, 1]) assert.deepEqual(flight.at(progress), start);
});
