import {
  CANVAS_HEADER_HEIGHT,
  CANVAS_PAGE_FIT_PADDING,
  CANVAS_SHELF_MARKER_HEIGHT,
} from "./canvasCamera";
import { CANVAS_SHELF_GAP, type CanvasShelfMarker as CanvasShelfMarkerData } from "./canvasItems";
import { canvasScreenAbove, canvasScreenLength, canvasScreenX } from "./canvasScreenSpace";

const BAR_SIZE = 24;
// The bar overhangs its area so the label, flush with the area's start, lines up with Page headers.
// A collapsed bar is centered on its area's start, so it starts the same distance before it.
export const CANVAS_SHELF_MARKER_OVERHANG = 12;
// Neighbouring bars always keep this much space between them.
const MIN_BAR_SEPARATION = 8;
// Zoomed far out, the gap between areas gets narrower than two overhangs, so they shrink.
const OVERHANG = `clamp(0px, ${canvasScreenLength(CANVAS_SHELF_GAP)} / 2 - ${MIN_BAR_SEPARATION / 2}px, ${CANVAS_SHELF_MARKER_OVERHANG}px)`;
const LABEL_CLASS_NAME =
  "text-muted-foreground text-xs font-medium tracking-wider whitespace-nowrap uppercase";
const BAR_CLASS_NAME =
  "bg-foreground/10 hover:bg-foreground/15 focus-visible:ring-ring absolute top-0 left-0 cursor-pointer rounded-sm outline-none focus-visible:ring-2";

/** The bar of each marker, as on-screen x expressions. */
type CanvasShelfMarkerBar = { left: string; right: string };

/**
 * Each marker's bar, from its area's on-screen extent. A collapsed bar keeps its
 * thickness at every zoom, so when it no longer fits in the gap next to its
 * area, it moves right, after the previous bar.
 */
function getCanvasShelfMarkerBars(markers: readonly CanvasShelfMarkerData[]) {
  let previousRight: string | undefined;
  return markers.map((marker): CanvasShelfMarkerBar => {
    const start = canvasScreenX(marker.start);
    const ownLeft = marker.collapsed
      ? `calc(${start} - ${BAR_SIZE / 2}px)`
      : `calc(${start} - ${OVERHANG})`;
    const left = previousRight
      ? `max(${ownLeft}, calc(${previousRight} + ${MIN_BAR_SEPARATION}px))`
      : ownLeft;
    const right = marker.collapsed
      ? `calc(${left} + ${BAR_SIZE}px)`
      : `max(calc(${canvasScreenX(marker.end)} + ${OVERHANG}), ${left})`;
    previousRight = right;
    return { left, right };
  });
}

/** The Shelf Markers of the Canvas row, in row order. */
export function CanvasShelfMarkers({
  markers,
  onToggle,
}: {
  markers: readonly CanvasShelfMarkerData[];
  onToggle: (marker: CanvasShelfMarkerData) => void;
}) {
  const bars = getCanvasShelfMarkerBars(markers);
  return markers.map((marker, index) => (
    <CanvasShelfMarker
      key={marker.key}
      marker={marker}
      bar={bars[index]!}
      onToggle={() => onToggle(marker)}
    />
  ));
}

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
function CanvasShelfMarker({
  marker,
  bar,
  onToggle,
}: {
  marker: CanvasShelfMarkerData;
  bar: CanvasShelfMarkerBar;
  onToggle: () => void;
}) {
  const start = canvasScreenX(marker.start);
  const end = canvasScreenX(marker.end);
  const y = canvasScreenAbove(CANVAS_HEADER_HEIGHT + CANVAS_SHELF_MARKER_HEIGHT);
  const button = {
    "data-canvas-shelf-marker": marker.key,
    "aria-expanded": !marker.collapsed,
    "aria-label": `${marker.collapsed ? "Expand" : "Collapse"} ${marker.label}`,
    // An empty area stays collapsed: there is nothing to expand.
    disabled: marker.count === 0,
    onClick: onToggle,
  };

  if (marker.collapsed) {
    return (
      <>
        <button
          type="button"
          {...button}
          className={BAR_CLASS_NAME}
          style={{
            width: BAR_SIZE,
            height: `calc(100% - ${y})`,
            transform: `translate(${bar.left}, ${y})`,
            willChange: "transform",
          }}
        />
        <div
          data-canvas-shelf-marker-label={marker.key}
          className="pointer-events-none absolute top-0 left-0 flex justify-center pt-3"
          style={{
            width: BAR_SIZE,
            // Stick to the top of the viewport while the bar runs past it.
            transform: `translate(${bar.left}, max(${y}, 0px))`,
            willChange: "transform",
          }}
        >
          <span className={`${LABEL_CLASS_NAME} rotate-180 [writing-mode:vertical-rl]`}>
            {marker.label} ({marker.count})
          </span>
        </div>
      </>
    );
  }

  // Clipping the label to the rest of the bar pushes it out at the area's end.
  // Zoomed far out, the bar may start past its area, or overhang it less: the
  // label then keeps the full overhang as its inset in the bar.
  const labelStart = `max(${start}, calc(${bar.left} + ${CANVAS_SHELF_MARKER_OVERHANG}px), ${CANVAS_PAGE_FIT_PADDING}px)`;
  return (
    <>
      <button
        type="button"
        {...button}
        className={BAR_CLASS_NAME}
        style={{
          height: BAR_SIZE,
          width: `calc(${bar.right} - ${bar.left})`,
          transform: `translate(${bar.left}, ${y})`,
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
        <span className={LABEL_CLASS_NAME}>
          {marker.label} ({marker.count})
        </span>
      </div>
    </>
  );
}
