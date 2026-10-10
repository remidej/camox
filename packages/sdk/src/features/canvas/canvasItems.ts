import type { CanvasSnapTarget } from "./canvasCamera";
import { CANVAS_DEVICES, type CanvasPage } from "./canvasPages";

export const CANVAS_ITEM_GAP = 240;
// Device selection resizes previews, not their reserved space in the canvas.
export const CANVAS_SLOT_WIDTH = CANVAS_DEVICES.desktop.width;
export const CANVAS_SHELF_MARKER_WIDTH = 8;

export type CanvasShelfMarkerItem = { kind: "shelf-marker"; key: string; label: string };
export type CanvasPageItem = { kind: "page"; key: string; page: CanvasPage };

/** One entry in the Canvas row: a Page that can be selected, or a Shelf Marker before a group. */
export type CanvasItem = CanvasShelfMarkerItem | CanvasPageItem;

export type PositionedCanvasItem<T extends CanvasItem = CanvasItem> = T & {
  left: number;
  width: number;
};

/** Per-kind layout and camera behavior. Only Pages are snap and flight destinations. */
const CANVAS_ITEM_KINDS: Record<CanvasItem["kind"], { width: number; snappable: boolean }> = {
  "shelf-marker": { width: CANVAS_SHELF_MARKER_WIDTH, snappable: false },
  page: { width: CANVAS_SLOT_WIDTH, snappable: true },
};

export function getCanvasItems(pages: readonly CanvasPage[]): CanvasItem[] {
  return [
    // Prefixed so marker keys can never collide with Page keys.
    { kind: "shelf-marker", key: "shelf:pages", label: "Pages" },
    ...pages.map((page): CanvasPageItem => ({ kind: "page", key: page.key, page })),
  ];
}

/** World-space positions of the Canvas row, matching its flex layout. */
export function positionCanvasItems(items: readonly CanvasItem[]): PositionedCanvasItem[] {
  let left = 0;
  return items.map((item) => {
    const { width } = CANVAS_ITEM_KINDS[item.kind];
    const positioned = { ...item, left, width };
    left += width + CANVAS_ITEM_GAP;
    return positioned;
  });
}

/** World-space width of the whole row; the horizontal extent of the Canvas bounds. */
export function canvasRowWidth(items: readonly PositionedCanvasItem[]) {
  const last = items.at(-1);
  return last ? last.left + last.width : 0;
}

export function isCanvasShelfMarker(
  item: PositionedCanvasItem,
): item is PositionedCanvasItem<CanvasShelfMarkerItem> {
  return item.kind === "shelf-marker";
}

export function isCanvasPage(
  item: PositionedCanvasItem,
): item is PositionedCanvasItem<CanvasPageItem> {
  return item.kind === "page";
}

export function canvasSnapTargets(items: readonly PositionedCanvasItem[]): CanvasSnapTarget[] {
  return items
    .filter((item) => CANVAS_ITEM_KINDS[item.kind].snappable)
    .map(({ key, left, width }) => ({ key, left, width }));
}

export type CanvasShelfArea = {
  marker: PositionedCanvasItem<CanvasShelfMarkerItem>;
  /** World-space x where the area starts: its marker's left edge. */
  start: number;
  /** World-space x where the area ends: the next marker, or the end of the row. */
  end: number;
};

/** The area each Shelf Marker labels, so its label can stay in view across that area only. */
export function canvasShelfAreas(items: readonly PositionedCanvasItem[]): CanvasShelfArea[] {
  const markers = items.filter(isCanvasShelfMarker);
  const rowEnd = canvasRowWidth(items);
  return markers.map((marker, index) => ({
    marker,
    start: marker.left,
    end: markers[index + 1]?.left ?? rowEnd,
  }));
}
