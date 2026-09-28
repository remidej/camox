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

export const CANVAS_PADDING = 64;
export const CANVAS_HEADER_HEIGHT = 52;
export const MAX_CANVAS_ZOOM = 2;

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
