/**
 * CSS projections from Canvas world space to the workspace's screen space,
 * driven by the camera's CSS variables so overlays never rerender on pan/zoom.
 * Fallbacks match the overview before the camera has mounted.
 */
const CANVAS_X = "var(--canvas-x, 64px)";
const CANVAS_Y = "var(--canvas-y, 112px)";
const CANVAS_ZOOM = "var(--canvas-zoom, .4)";

/** Screen x where the left sidebar's overlay ends, following its slide. */
export const CANVAS_SIDEBAR_LEFT = "var(--canvas-sidebar-left, 0px)";

/** Places and scales the world-space row. */
export const CANVAS_WORLD_TRANSFORM = `translate(${CANVAS_X}, ${CANVAS_Y}) scale(${CANVAS_ZOOM})`;

/** Screen x of a world x. */
export function canvasScreenX(worldX: number) {
  return `calc(${CANVAS_X} + ${worldX}px * ${CANVAS_ZOOM})`;
}

/** Screen y a constant on-screen distance above the top of the row, e.g. for headers. */
export function canvasScreenAbove(distance: number) {
  return `calc(${CANVAS_Y} - ${distance}px)`;
}

/** On-screen length of a world length. */
export function canvasScreenLength(worldLength: number) {
  return `calc(${worldLength}px * ${CANVAS_ZOOM})`;
}
