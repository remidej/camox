import type { CanvasSnapPage } from "./canvasCamera";
import { CANVAS_DEVICES, type CanvasPage } from "./canvasPages";

export const CANVAS_ITEM_GAP = 240;
// Device selection resizes previews, not their reserved space in the canvas.
export const CANVAS_SLOT_WIDTH = CANVAS_DEVICES.desktop.width;
export const CANVAS_SHELF_MARKER_WIDTH = 4;

export type CanvasShelfMarker = { kind: "shelf-marker"; key: string; label: string };
export type CanvasPageItem = { kind: "page"; key: string; page: CanvasPage };

/** One entry in the Canvas row: a frame that can be selected, or a Shelf Marker before a group. */
export type CanvasItem = CanvasShelfMarker | CanvasPageItem;

export type PositionedCanvasItem<T extends CanvasItem = CanvasItem> = T & {
  left: number;
  width: number;
};

export function getCanvasItems(pages: readonly CanvasPage[]): CanvasItem[] {
  return [
    { kind: "shelf-marker", key: "pages", label: "Pages" },
    ...pages.map((page): CanvasPageItem => ({ kind: "page", key: page.key, page })),
  ];
}

function itemWidth(item: CanvasItem) {
  return item.kind === "shelf-marker" ? CANVAS_SHELF_MARKER_WIDTH : CANVAS_SLOT_WIDTH;
}

/** World-space positions of the Canvas row, matching its flex layout. */
export function positionCanvasItems(items: readonly CanvasItem[]): PositionedCanvasItem[] {
  let left = 0;
  return items.map((item) => {
    const width = itemWidth(item);
    const positioned = { ...item, left, width };
    left += width + CANVAS_ITEM_GAP;
    return positioned;
  });
}

/** Frames are the only snap and flight destinations; Shelf Markers are passed over. */
export function canvasSnapTargets(items: readonly PositionedCanvasItem[]): CanvasSnapPage[] {
  return items
    .filter((item) => item.kind !== "shelf-marker")
    .map(({ key, left, width }) => ({ key, left, width }));
}
