export interface CanvasCamera {
  x: number;
  y: number;
  scale: number;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasSize {
  width: number;
  height: number;
}

export interface CanvasSnapPage {
  key: string;
  left: number;
  width: number;
}

/** Require 80% horizontal visibility; stable input order breaks center-distance ties. */
export function canvasSnapPage<T extends CanvasSnapPage>(
  camera: CanvasCamera,
  viewport: CanvasSize,
  pages: readonly T[],
): T | undefined {
  let closest: T | undefined;
  let distance = Infinity;
  for (const page of pages) {
    const left = camera.x + page.left * camera.scale;
    const right = left + page.width * camera.scale;
    const visible = Math.max(0, Math.min(right, viewport.width) - Math.max(left, 0));
    if (visible + 1e-8 < (right - left) * 0.8) continue;
    const nextDistance = Math.abs((left + right - viewport.width) / 2);
    if (nextDistance >= distance) continue;
    closest = page;
    distance = nextDistance;
  }
  return closest;
}

export const CANVAS_PADDING = 64;
export const CANVAS_HEADER_HEIGHT = 52;
export const MAX_CANVAS_ZOOM = 2;

/** Relative (log-scale) bands make the detent feel the same at every page width. */
const ZOOM_SNAP_CAPTURE = 0.09;
const ZOOM_SNAP_RELEASE = 0.12;

export function isCanvasPageScale(scale: number, pageScale: number | undefined) {
  return pageScale !== undefined && Math.abs(Math.log(scale / pageScale)) < 1e-8;
}

/** Horizontal attraction shares the zoom capture range without changing scale. */
export function isNearCanvasPageScale(scale: number, pageScale: number | undefined) {
  return pageScale !== undefined && Math.abs(Math.log(scale / pageScale)) <= ZOOM_SNAP_CAPTURE;
}

/**
 * intendedScale is accumulated independently of the displayed scale, so gentle
 * input can escape the detent. Large steps outside the band pass straight through.
 */
export function snapCanvasZoom(
  scale: number,
  intendedScale: number,
  pageScale: number | undefined,
) {
  if (pageScale === undefined) return intendedScale;
  const band = isCanvasPageScale(scale, pageScale) ? ZOOM_SNAP_RELEASE : ZOOM_SNAP_CAPTURE;
  return Math.abs(Math.log(intendedScale / pageScale)) <= band ? pageScale : intendedScale;
}

export interface CanvasVerticalRail {
  mode: "pending" | "vertical" | "free";
  samples: { x: number; y: number; time: number }[];
}

const RAIL_EVIDENCE_MS = 80;
const RAIL_INTENT_PX = 16;
const RAIL_CAPTURE_RATIO = 0.65;
const RAIL_RELEASE_RATIO = 0.9;

/**
 * Small startup deltas are evidence, not a permanent rejection of vertical intent.
 * Sum magnitudes in a short window so sign-changing jitter cannot cancel out.
 * Once deliberate two-axis intent wins, never reacquire on its momentum tail.
 */
export function canvasVerticalRail(
  delta: CanvasPoint,
  time: number,
  previous?: CanvasVerticalRail,
): CanvasVerticalRail {
  if (previous?.mode === "free") return previous;
  const mode = previous?.mode ?? "pending";
  const x = Math.abs(delta.x);
  const y = Math.abs(delta.y);
  // While locked, only sustained departures count toward release. A tiny
  // horizontal tail or one low-magnitude jitter event must not break the rail.
  if (mode === "vertical" && x <= y * RAIL_RELEASE_RATIO) return { mode, samples: [] };
  const samples = [
    ...(previous?.samples ?? []).filter((sample) => time - sample.time < RAIL_EVIDENCE_MS),
    { x, y, time },
  ];
  const evidence = samples.reduce((sum, sample) => ({ x: sum.x + sample.x, y: sum.y + sample.y }), {
    x: 0,
    y: 0,
  });
  if (Math.max(evidence.x, evidence.y) < RAIL_INTENT_PX) return { mode, samples };
  if (mode === "vertical") return { mode: "free", samples: [] };
  return {
    mode: evidence.x <= evidence.y * RAIL_CAPTURE_RATIO ? "vertical" : "free",
    samples: [],
  };
}

/** Start at the selected page's top, fitting its width rather than the whole site. */
export function fitCanvasPage(
  viewport: CanvasSize,
  page: { left: number; width: number },
): CanvasCamera {
  const padding = Math.min(24, viewport.width / 4);
  const scale = Math.max(
    Number.EPSILON,
    Math.min(MAX_CANVAS_ZOOM, (viewport.width - padding * 2) / Math.max(1, page.width)),
  );
  return {
    x: (viewport.width - page.width * scale) / 2 - page.left * scale,
    y: Math.min(24 + CANVAS_HEADER_HEIGHT, viewport.height / 3),
    scale,
  };
}

/** Reserve readable padding and unscaled page headers in the fitted overview. */
export function canvasInsets(viewport: CanvasSize) {
  return {
    x: Math.min(CANVAS_PADDING, viewport.width / 4),
    top: Math.min(CANVAS_PADDING + CANVAS_HEADER_HEIGHT, viewport.height / 3),
    bottom: Math.min(CANVAS_PADDING, viewport.height / 4),
  };
}

export function zoomCanvasAt(
  camera: CanvasCamera,
  point: CanvasPoint,
  scale: number,
  minimumScale = Number.EPSILON,
): CanvasCamera {
  const nextScale = Math.min(MAX_CANVAS_ZOOM, Math.max(minimumScale, scale));
  const ratio = nextScale / camera.scale;
  return {
    x: point.x - (point.x - camera.x) * ratio,
    y: point.y - (point.y - camera.y) * ratio,
    scale: nextScale,
  };
}

export function fitCanvas(viewport: CanvasSize, content: CanvasSize): CanvasCamera {
  const padding = canvasInsets(viewport);
  // A fixed percentage floor prevents large sites or very tall pages from fitting.
  const scale = Math.max(
    Number.EPSILON,
    Math.min(
      1,
      (viewport.width - padding.x * 2) / Math.max(1, content.width),
      (viewport.height - padding.top - padding.bottom) / Math.max(1, content.height),
    ),
  );
  return {
    x: (viewport.width - content.width * scale) / 2,
    y: (viewport.height + padding.top - padding.bottom - content.height * scale) / 2,
    scale,
  };
}

/** The complete overview defines a world rectangle, including its shorter-axis spare space. */
export function canvasBounds(viewport: CanvasSize, content: CanvasSize) {
  const fit = fitCanvas(viewport, content);
  return {
    left: -fit.x / fit.scale,
    top: -fit.y / fit.scale,
    right: (viewport.width - fit.x) / fit.scale,
    bottom: (viewport.height - fit.y) / fit.scale,
    minimumScale: fit.scale,
  };
}

function constrainAxis(
  position: number,
  viewport: number,
  start: number,
  end: number,
  scale: number,
) {
  return Math.min(-start * scale, Math.max(viewport - end * scale, position));
}

/** Project fixed world bounds; zoom must not redefine the padded area or recenter a fitting axis. */
export function constrainCanvasCamera(
  camera: CanvasCamera,
  viewport: CanvasSize,
  content: CanvasSize,
): CanvasCamera {
  const bounds = canvasBounds(viewport, content);
  const next = zoomCanvasAt(
    camera,
    { x: viewport.width / 2, y: viewport.height / 2 },
    camera.scale,
    bounds.minimumScale,
  );
  return {
    x: constrainAxis(next.x, viewport.width, bounds.left, bounds.right, next.scale),
    y: constrainAxis(next.y, viewport.height, bounds.top, bounds.bottom, next.scale),
    scale: next.scale,
  };
}

/** Wheel deltas can be pixels, lines, or pages depending on the input device. */
export function canvasWheelDelta(delta: number, mode: number, viewportSize: number) {
  if (mode === 1) return delta * 16;
  if (mode === 2) return delta * viewportSize;
  return delta;
}
