import { CANVAS_HEADER_HEIGHT } from "./canvasCamera";
import type { CanvasShelfArea, CanvasShelfMarkerItem, PositionedCanvasItem } from "./canvasItems";
import { canvasScreenLength, canvasScreenAbove, canvasScreenX } from "./canvasScreenSpace";

const LABEL_SIZE = 24;
const LABEL_INSET = 12;
// Keeps the line legible in the zoomed-out overview, where its world width rounds away.
const MIN_LINE_WIDTH = 2;

/** Reserves the marker's place in the world-space row; the line itself is drawn by CanvasShelfMarker. */
export function CanvasShelfMarkerSpace({
  marker,
}: {
  marker: PositionedCanvasItem<CanvasShelfMarkerItem>;
}) {
  return (
    <div
      data-canvas-shelf-marker={marker.key}
      aria-hidden
      className="shrink-0"
      style={{ width: marker.width }}
    />
  );
}

/**
 * A labelled vertical divider separating areas of the Canvas, drawn at the start of its area.
 *
 * The line follows world space horizontally and scales with zoom, but spans
 * the whole workspace height: the camera never shows past the Canvas bounds,
 * so it always covers the full Canvas height, header row and padding included.
 *
 * The label keeps a constant screen size, like Page headers. It stays pinned
 * to the viewport's top and left edges while its area is in view, and the end
 * of the area (the next marker or the end of the row) pushes it out.
 */
export function CanvasShelfMarker({ area }: { area: CanvasShelfArea }) {
  const { marker, end } = area;
  const center = marker.left + marker.width / 2;
  const natural = `calc(${canvasScreenX(center)} - ${LABEL_SIZE / 2}px)`;
  // Stop before the next marker's own label, which is centered on its line.
  const pushedOut = `calc(${canvasScreenX(end)} - ${LABEL_SIZE * 1.5}px)`;
  return (
    <>
      <div
        data-canvas-shelf-marker-line={marker.key}
        aria-hidden
        className="bg-foreground/20 pointer-events-none absolute top-0 bottom-0 left-0 rounded-full"
        style={{
          width: `max(${MIN_LINE_WIDTH}px, ${canvasScreenLength(marker.width)})`,
          transform: `translateX(calc(${canvasScreenX(center)} - 50%))`,
          willChange: "transform",
        }}
      />
      <div
        data-canvas-shelf-marker-label={marker.key}
        className="pointer-events-none absolute top-0 left-0 flex justify-center"
        style={{
          width: LABEL_SIZE,
          transform: `translate(max(${natural}, min(${LABEL_INSET}px, ${pushedOut})), max(${canvasScreenAbove(CANVAS_HEADER_HEIGHT)}, ${LABEL_INSET}px))`,
          willChange: "transform",
        }}
      >
        <span className="bg-muted text-muted-foreground block rotate-180 py-2 text-xs font-medium tracking-wider uppercase [writing-mode:vertical-rl]">
          {marker.label}
        </span>
      </div>
    </>
  );
}
