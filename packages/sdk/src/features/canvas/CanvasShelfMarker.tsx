import {
  CANVAS_HEADER_HEIGHT,
  CANVAS_PAGE_FIT_PADDING,
  CANVAS_SHELF_MARKER_HEIGHT,
} from "./canvasCamera";
import type { CanvasShelfMarker as CanvasShelfMarkerData } from "./canvasItems";
import { canvasScreenAbove, canvasScreenX } from "./canvasScreenSpace";

const BAR_HEIGHT = 24;
// The bar overhangs its area so the label, flush with the area's start, lines up with Page headers.
const BAR_OVERHANG = 12;

/**
 * A labelled horizontal bar above the Page headers, spanning its area of the Canvas.
 *
 * The bar follows world space horizontally, so it spans its area's items at
 * every zoom, but keeps a constant on-screen height, like Page headers.
 * The label sticks near the viewport's left edge while the area is in view, at
 * the inset of a snapped Page so it lines up with that Page's header, and the
 * end of the area pushes it out.
 */
export function CanvasShelfMarker({ marker }: { marker: CanvasShelfMarkerData }) {
  const start = canvasScreenX(marker.start);
  const end = canvasScreenX(marker.end);
  const y = canvasScreenAbove(CANVAS_HEADER_HEIGHT + CANVAS_SHELF_MARKER_HEIGHT);
  // Clipping the label to the rest of the bar pushes it out at the area's end.
  const labelStart = `max(${start}, ${CANVAS_PAGE_FIT_PADDING}px)`;
  return (
    <>
      <div
        data-canvas-shelf-marker={marker.key}
        aria-hidden
        className="bg-foreground/10 pointer-events-none absolute top-0 left-0 rounded-sm"
        style={{
          height: BAR_HEIGHT,
          width: `calc(${end} - ${start} + ${BAR_OVERHANG * 2}px)`,
          transform: `translate(calc(${start} - ${BAR_OVERHANG}px), ${y})`,
          willChange: "transform",
        }}
      />
      <div
        data-canvas-shelf-marker-label={marker.key}
        className="pointer-events-none absolute top-0 left-0 flex items-center overflow-hidden"
        style={{
          height: BAR_HEIGHT,
          width: `max(0px, calc(${end} - ${labelStart}))`,
          transform: `translate(${labelStart}, ${y})`,
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
