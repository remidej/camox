import {
  constrainCanvasCamera,
  fitCanvas,
  type CanvasCamera,
  type CanvasSize,
} from "./canvasCamera";

const MIN_DURATION = 1000;
const MAX_DURATION = 2500;
// The zoom-out control point covers the route; the curve only approaches it.
// A destination already inside the starting/ending view needs no extra zoom-out.
const ROUTE_VIEW_FRACTION = 0.5;

function easeInOut(progress: number) {
  // One asymmetric curve with velocity 60t²(1-t)³: gentle takeoff, but a
  // longer landing tail. Evaluate its complement near arrival for precision.
  if (progress <= 0.5)
    return progress ** 3 * (20 + progress * (-45 + progress * (36 - 10 * progress)));
  const remaining = 1 - progress;
  return 1 - remaining ** 4 * (15 + remaining * (-24 + 10 * remaining));
}

function interpolate(start: number, end: number, progress: number) {
  return start * (1 - progress) + end * progress;
}

function bezier(start: number, control: number, end: number, progress: number) {
  return interpolate(
    interpolate(start, control, progress),
    interpolate(control, end, progress),
    progress,
  );
}

/**
 * One quadratic Bezier in world-center/inverse-scale space, with one ease-in-out
 * clock for all coordinates. Inverse scale acts like camera altitude: distant
 * trips arc up and back down continuously, without zoom/travel phases or a
 * cruising plateau. Nearby trips use a straight path.
 *
 * Valid cameras form a convex volume in these coordinates. Constraining the
 * control point (not just each frame) keeps the whole curve in bounds without
 * clipping its motion into hard corners. Callers supply constrained endpoints.
 */
export function createCanvasFlight(
  start: CanvasCamera,
  end: CanvasCamera,
  viewport: CanvasSize,
  content: CanvasSize,
): { duration: number; at: (progress: number) => CanvasCamera } {
  if (start.x === end.x && start.y === end.y && start.scale === end.scale) {
    return { duration: 0, at: () => ({ ...start }) };
  }

  const center = (camera: CanvasCamera) => ({
    x: (viewport.width / 2 - camera.x) / camera.scale,
    y: (viewport.height / 2 - camera.y) / camera.scale,
    altitude: 1 / camera.scale,
  });
  const from = center(start);
  const to = center(end);
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const endpointScale = Math.min(start.scale, end.scale);
  // A one-pixel denominator keeps collapsed/tiny viewports deterministic.
  const routeScale = Math.min(
    dx > 0 ? (Math.max(1, viewport.width) * ROUTE_VIEW_FRACTION) / dx : Infinity,
    dy > 0 ? (Math.max(1, viewport.height) * ROUTE_VIEW_FRACTION) / dy : Infinity,
  );
  const travelScale = Math.max(
    fitCanvas(viewport, content).scale,
    Math.min(endpointScale, routeScale),
  );
  const retreat = travelScale < endpointScale;
  const startLog = Math.log(start.scale);
  const endLog = Math.log(end.scale);
  const controlScale = retreat ? travelScale : 2 / (from.altitude + to.altitude);
  const control = center(
    constrainCanvasCamera(
      {
        x: viewport.width / 2 - interpolate(from.x, to.x, 0.5) * controlScale,
        y: viewport.height / 2 - interpolate(from.y, to.y, 0.5) * controlScale,
        scale: controlScale,
      },
      viewport,
      content,
    ),
  );
  const distance = Math.hypot(
    (dx * endpointScale) / Math.max(1, viewport.width),
    (dy * endpointScale) / Math.max(1, viewport.height),
  );
  // The extra time preserves the gentle takeoff while extending the landing.
  const duration = Math.min(
    MAX_DURATION,
    MIN_DURATION + 375 * (Math.log1p(distance) + Math.abs(startLog - endLog)),
  );

  return {
    duration,
    at(progress) {
      if (progress <= 0) return { ...start };
      if (progress >= 1) return { ...end };
      const motion = easeInOut(progress);
      const scale = 1 / bezier(from.altitude, control.altitude, to.altitude, motion);
      return constrainCanvasCamera(
        {
          x: viewport.width / 2 - bezier(from.x, control.x, to.x, motion) * scale,
          y: viewport.height / 2 - bezier(from.y, control.y, to.y, motion) * scale,
          scale,
        },
        viewport,
        content,
      );
    },
  };
}
