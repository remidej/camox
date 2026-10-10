import { CANVAS_HEADER_HEIGHT } from "./canvasCamera";
import type { CanvasShelfMarker, PositionedCanvasItem } from "./canvasItems";

/** The divider itself lives in world space, so it spans the Canvas height and scales with zoom. */
export function CanvasShelfMarkerLine({
  marker,
}: {
  marker: PositionedCanvasItem<CanvasShelfMarker>;
}) {
  return (
    <div
      data-canvas-shelf-marker={marker.key}
      aria-hidden
      className="bg-foreground/15 shrink-0 self-stretch rounded-full"
      style={{ width: marker.width }}
    />
  );
}

/**
 * Drawn outside the camera transform at a constant screen size, like Page
 * headers. It starts on the header row and stays pinned to the viewport top
 * once the Canvas is panned below it.
 */
export function CanvasShelfMarkerLabel({
  marker,
}: {
  marker: PositionedCanvasItem<CanvasShelfMarker>;
}) {
  const center = marker.left + marker.width / 2;
  return (
    <div
      data-canvas-shelf-marker-label={marker.key}
      className="pointer-events-none absolute top-0 left-0"
      style={{
        transform: `translate(calc(var(--canvas-x, 64px) + ${center}px * var(--canvas-zoom, .4)), max(calc(var(--canvas-y, 112px) - ${CANVAS_HEADER_HEIGHT}px), 12px))`,
        willChange: "transform",
      }}
    >
      <span className="bg-muted text-muted-foreground block -translate-x-1/2 rotate-180 py-2 text-xs font-medium tracking-wider uppercase [writing-mode:vertical-rl]">
        {marker.label}
      </span>
    </div>
  );
}
