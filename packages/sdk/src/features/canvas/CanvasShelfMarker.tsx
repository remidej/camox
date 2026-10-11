import { CANVAS_HEADER_HEIGHT, CANVAS_SHELF_MARKER_HEIGHT } from "./canvasCamera";
import type { CanvasShelfMarker as CanvasShelfMarkerData } from "./canvasItems";
import { canvasScreenAbove, canvasScreenX } from "./canvasScreenSpace";

const BAR_HEIGHT = 24;

/**
 * A labelled horizontal bar above the Page headers, spanning its area of the Canvas.
 *
 * The bar follows world space horizontally, so it spans exactly its area's
 * items at every zoom, but keeps a constant on-screen height, like Page headers.
 * The label sticks to the viewport's left edge while the area is in view, and
 * the end of the area pushes it out.
 */
export function CanvasShelfMarker({ marker }: { marker: CanvasShelfMarkerData }) {
  const start = canvasScreenX(marker.start);
  const end = canvasScreenX(marker.end);
  const y = canvasScreenAbove(CANVAS_HEADER_HEIGHT + CANVAS_SHELF_MARKER_HEIGHT);
  // The visible part of the bar: clipping the label to it pushes the label out at the area's end.
  const visibleStart = `max(${start}, 0px)`;
  return (
    <>
      <div
        data-canvas-shelf-marker={marker.key}
        aria-hidden
        className="bg-foreground/10 pointer-events-none absolute top-0 left-0 rounded-sm"
        style={{
          height: BAR_HEIGHT,
          width: `calc(${end} - ${start})`,
          transform: `translate(${start}, ${y})`,
          willChange: "transform",
        }}
      />
      <div
        data-canvas-shelf-marker-label={marker.key}
        className="pointer-events-none absolute top-0 left-0 flex items-center overflow-hidden px-3"
        style={{
          height: BAR_HEIGHT,
          width: `max(0px, calc(${end} - ${visibleStart}))`,
          transform: `translate(${visibleStart}, ${y})`,
          willChange: "transform",
        }}
      >
        <span className="text-muted-foreground text-xs font-medium tracking-wider whitespace-nowrap uppercase">
          {marker.label}
        </span>
      </div>
    </>
  );
}
