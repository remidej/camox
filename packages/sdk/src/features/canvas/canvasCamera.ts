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

export interface CanvasSnapTarget {
  key: string;
  left: number;
  width: number;
}

/** Require 80% horizontal visibility; stable input order breaks center-distance ties. */
export function findCanvasSnapTarget<T extends CanvasSnapTarget>(
  camera: CanvasCamera,
  viewport: CanvasSize,
  targets: readonly T[],
): T | undefined {
  let closest: T | undefined;
  let distance = Infinity;
  for (const target of targets) {
    const left = camera.x + target.left * camera.scale;
    const right = left + target.width * camera.scale;
    const visible = Math.max(0, Math.min(right, viewport.width) - Math.max(left, 0));
    if (visible + 1e-8 < (right - left) * 0.8) continue;
    const nextDistance = Math.abs((left + right - viewport.width) / 2);
    if (nextDistance >= distance) continue;
    closest = target;
    distance = nextDistance;
  }
  return closest;
}

export const CANVAS_PADDING = 64;
export const CANVAS_HEADER_HEIGHT = 52;
/** Screen-space inset of a Page snapped to fit the viewport's width. */
export const CANVAS_PAGE_FIT_PADDING = 24;
/** Shelf Marker bar plus its gap above the Page headers. */
export const CANVAS_SHELF_MARKER_HEIGHT = 32;
/** Unscaled chrome above the row: Shelf Markers, then Page headers. */
const CANVAS_CHROME_HEIGHT = CANVAS_HEADER_HEIGHT + CANVAS_SHELF_MARKER_HEIGHT;
export const MAX_CANVAS_ZOOM = 2;
/**
 * Below this, Pages are too small to read while every frame comes near the
 * camera, so painting and panning slow down with the size of the site.
 */
export const MIN_CANVAS_ZOOM = 0.1;
/** Log-scale zoom per pixel of Ctrl/⌘ + wheel, including trackpad pinches. */
export const CANVAS_WHEEL_ZOOM_RATE = 0.01056;

/** Relative (log-scale) bands make the detent feel the same at every page width. */
export const ZOOM_SNAP_CAPTURE = 0.14;
export const ZOOM_SNAP_RELEASE = 0.18;
/** Fractions of viewport width: acquire near center, then hold a wider detent. */
export const PAN_SNAP_CAPTURE = 0.12;
export const PAN_SNAP_RELEASE = 0.18;

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
  const padding = Math.min(CANVAS_PAGE_FIT_PADDING, viewport.width / 4);
  const scale = Math.max(
    Number.EPSILON,
    Math.min(MAX_CANVAS_ZOOM, (viewport.width - padding * 2) / Math.max(1, page.width)),
  );
  return {
    x: (viewport.width - page.width * scale) / 2 - page.left * scale,
    y: Math.min(CANVAS_PAGE_FIT_PADDING + CANVAS_CHROME_HEIGHT, viewport.height / 3),
    scale,
  };
}

/** Place the same document reading point at the canvas viewport's top edge. */
export function placeCanvasPageAnchor(
  viewport: CanvasSize,
  page: { left: number; width: number },
  documentY: number,
  scale: number,
  frameOffsetY = 0,
): CanvasCamera {
  return {
    x: viewport.width / 2 - (page.left + page.width / 2) * scale,
    // At document top retain room for the unscaled Shelf Markers and page headers.
    y: documentY > 0 ? -(documentY + frameOffsetY) * scale : fitCanvasPage(viewport, page).y,
    scale,
  };
}

/** Reserve readable padding, unscaled Shelf Markers and page headers in the fitted overview. */
export function canvasInsets(viewport: CanvasSize) {
  return {
    x: Math.min(CANVAS_PADDING, viewport.width / 4),
    top: Math.min(CANVAS_PADDING + CANVAS_CHROME_HEIGHT, viewport.height / 3),
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
  if (nextScale === camera.scale) return camera;
  const ratio = nextScale / camera.scale;
  return {
    x: point.x - (point.x - camera.x) * ratio,
    y: point.y - (point.y - camera.y) * ratio,
    scale: nextScale,
  };
}

export function fitCanvas(viewport: CanvasSize, content: CanvasSize): CanvasCamera {
  const padding = canvasInsets(viewport);
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

/** The zoom floor: the complete overview, unless the site is too large to fit above MIN_CANVAS_ZOOM. */
export function canvasMinimumScale(viewport: CanvasSize, content: CanvasSize) {
  return Math.max(MIN_CANVAS_ZOOM, fitCanvas(viewport, content).scale);
}

/** The most zoomed-out view: the complete overview, or its start at the zoom floor. */
export function canvasOverview(viewport: CanvasSize, content: CanvasSize): CanvasCamera {
  const fit = fitCanvas(viewport, content);
  if (fit.scale >= MIN_CANVAS_ZOOM) return fit;
  const padding = canvasInsets(viewport);
  return constrainCanvasCamera(
    { x: padding.x, y: padding.top, scale: MIN_CANVAS_ZOOM },
    viewport,
    content,
  );
}

/**
 * How much of the viewport may be empty canvas beside the content, per side.
 * At half, the content's edges can pan up to the viewport's center and no
 * further, so it never leaves the view at any zoom.
 */
export const CANVAS_OVERSCROLL = 0.5;

/**
 * The limit is in screen space, not world space: zooming out leaves as much
 * empty canvas around the content as zooming in, so it never pulls the view.
 * Content smaller than the empty canvas may also sit anywhere fully in view.
 */
function constrainAxis(position: number, viewport: number, size: number, scale: number) {
  const length = size * scale;
  const gap = viewport * CANVAS_OVERSCROLL;
  return Math.min(
    Math.max(gap, viewport - length),
    Math.max(Math.min(viewport - gap - length, 0), position),
  );
}

/** Keep the zoom between its limits, and the content in view with bounded empty canvas around it. */
export function constrainCanvasCamera(
  camera: CanvasCamera,
  viewport: CanvasSize,
  content: CanvasSize,
): CanvasCamera {
  const next = zoomCanvasAt(
    camera,
    { x: viewport.width / 2, y: viewport.height / 2 },
    camera.scale,
    canvasMinimumScale(viewport, content),
  );
  return {
    x: constrainAxis(next.x, viewport.width, content.width, next.scale),
    y: constrainAxis(next.y, viewport.height, content.height, next.scale),
    scale: next.scale,
  };
}

/** Wheel deltas can be pixels, lines, or pages depending on the input device. */
export function canvasWheelDelta(delta: number, mode: number, viewportSize: number) {
  if (mode === 1) return delta * 16;
  if (mode === 2) return delta * viewportSize;
  return delta;
}
