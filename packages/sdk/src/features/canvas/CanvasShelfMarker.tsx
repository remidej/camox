import {
  CANVAS_HEADER_HEIGHT,
  CANVAS_PAGE_FIT_PADDING,
  CANVAS_SHELF_MARKER_HEIGHT,
} from "./canvasCamera";
import type { CanvasShelfMarker as CanvasShelfMarkerData } from "./canvasItems";
import { canvasScreenAbove, canvasScreenX } from "./canvasScreenSpace";

const BAR_SIZE = 24;
// The bar overhangs its area so the label, flush with the area's start, lines up with Page headers.
const BAR_OVERHANG = 12;
const LABEL_CLASS_NAME =
  "text-muted-foreground text-xs font-medium tracking-wider whitespace-nowrap uppercase";
const BAR_CLASS_NAME =
  "bg-foreground/10 hover:bg-foreground/15 focus-visible:ring-ring absolute top-0 left-0 cursor-pointer rounded-sm outline-none focus-visible:ring-2";

/**
 * A labelled bar naming an area of the Canvas. Clicking it collapses or expands the area.
 *
 * Expanded, it is a horizontal bar above the Page headers. The bar follows world
 * space horizontally, so it spans its area's items at every zoom, but keeps a
 * constant on-screen height, like Page headers. The label sticks near the
 * viewport's left edge while the area is in view, at the inset of a snapped
 * Page so it lines up with that Page's header, and the end of the area pushes it out.
 *
 * Collapsed, the area's items are hidden and the bar turns vertical in their
 * place, running from the header row to the bottom of the viewport. It is the
 * horizontal bar rotated, so its label reads upwards and sits at the top.
 */
export function CanvasShelfMarker({
  marker,
  onToggle,
}: {
  marker: CanvasShelfMarkerData;
  onToggle: () => void;
}) {
  const start = canvasScreenX(marker.start);
  const end = canvasScreenX(marker.end);
  const y = canvasScreenAbove(CANVAS_HEADER_HEIGHT + CANVAS_SHELF_MARKER_HEIGHT);
  const button = {
    "data-canvas-shelf-marker": marker.key,
    "aria-expanded": !marker.collapsed,
    "aria-label": `${marker.collapsed ? "Expand" : "Collapse"} ${marker.label}`,
    onClick: onToggle,
  };

  if (marker.collapsed) {
    const left = `calc(${start} - ${BAR_SIZE / 2}px)`;
    return (
      <>
        <button
          type="button"
          {...button}
          className={BAR_CLASS_NAME}
          style={{
            width: BAR_SIZE,
            height: `calc(100% - ${y})`,
            transform: `translate(${left}, ${y})`,
            willChange: "transform",
          }}
        />
        <div
          data-canvas-shelf-marker-label={marker.key}
          className="pointer-events-none absolute top-0 left-0 flex justify-center pt-3"
          style={{
            width: BAR_SIZE,
            // Stick to the top of the viewport while the bar runs past it.
            transform: `translate(${left}, max(${y}, 0px))`,
            willChange: "transform",
          }}
        >
          <span className={`${LABEL_CLASS_NAME} rotate-180 [writing-mode:vertical-rl]`}>
            {marker.label}
          </span>
        </div>
      </>
    );
  }

  // Clipping the label to the rest of the bar pushes it out at the area's end.
  const labelStart = `max(${start}, ${CANVAS_PAGE_FIT_PADDING}px)`;
  return (
    <>
      <button
        type="button"
        {...button}
        className={BAR_CLASS_NAME}
        style={{
          height: BAR_SIZE,
          width: `calc(${end} - ${start} + ${BAR_OVERHANG * 2}px)`,
          transform: `translate(calc(${start} - ${BAR_OVERHANG}px), ${y})`,
          willChange: "transform",
        }}
      />
      <div
        data-canvas-shelf-marker-label={marker.key}
        className="pointer-events-none absolute top-0 left-0 flex items-center overflow-hidden"
        style={{
          height: BAR_SIZE,
          width: `max(0px, calc(${end} - ${labelStart}))`,
          transform: `translate(${labelStart}, ${y})`,
          willChange: "transform",
        }}
      >
        <span className={LABEL_CLASS_NAME}>{marker.label}</span>
      </div>
    </>
  );
}
