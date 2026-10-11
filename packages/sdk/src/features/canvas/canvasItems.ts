import type { CanvasSnapTarget } from "./canvasCamera";
import { CANVAS_DEVICES, type CanvasPage } from "./canvasPages";

export const CANVAS_ITEM_GAP = 240;
// Device selection resizes previews, not their reserved space in the canvas.
export const CANVAS_SLOT_WIDTH = CANVAS_DEVICES.desktop.width;

export type CanvasPageItem = { kind: "page"; key: string; page: CanvasPage };

/** One entry in the Canvas row: a Page that can be selected. */
export type CanvasItem = CanvasPageItem;

/** An area of the Canvas row, labelled by its Shelf Marker. */
export type CanvasShelf = { key: string; label: string; items: CanvasItem[] };

export type PositionedCanvasItem<T extends CanvasItem = CanvasItem> = T & {
  left: number;
  width: number;
};

/** A Shelf Marker spanning its area, in world-space x. */
export type CanvasShelfMarker = { key: string; label: string; start: number; end: number };

/** Per-kind layout and camera behavior. */
const CANVAS_ITEM_KINDS: Record<CanvasItem["kind"], { width: number; snappable: boolean }> = {
  page: { width: CANVAS_SLOT_WIDTH, snappable: true },
};

export function getCanvasShelves(pages: readonly CanvasPage[]): CanvasShelf[] {
  return [
    {
      // Prefixed so shelf keys can never collide with item keys.
      key: "shelf:pages",
      label: "Pages",
      items: pages.map((page): CanvasPageItem => ({ kind: "page", key: page.key, page })),
    },
  ];
}

/** World-space positions of the Canvas row, matching its flex layout, and the markers above it. */
export function positionCanvasShelves(shelves: readonly CanvasShelf[]) {
  const items: PositionedCanvasItem[] = [];
  const markers: CanvasShelfMarker[] = [];
  let left = 0;
  for (const shelf of shelves) {
    // An empty area has nothing to label.
    if (shelf.items.length === 0) continue;
    const start = left;
    for (const item of shelf.items) {
      const { width } = CANVAS_ITEM_KINDS[item.kind];
      items.push({ ...item, left, width });
      left += width + CANVAS_ITEM_GAP;
    }
    markers.push({ key: shelf.key, label: shelf.label, start, end: left - CANVAS_ITEM_GAP });
  }
  return { items, markers };
}

/** World-space width of the whole row; the horizontal extent of the Canvas bounds. */
export function canvasRowWidth(items: readonly PositionedCanvasItem[]) {
  const last = items.at(-1);
  return last ? last.left + last.width : 0;
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
