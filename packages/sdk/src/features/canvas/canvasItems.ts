import type { Block } from "../../core/createBlock";
import type { CanvasSnapTarget } from "./canvasCamera";
import { CANVAS_DEVICES, type CanvasPage } from "./canvasPages";

export const CANVAS_ITEM_GAP = 240;
// Wider than the gap between items, so areas read as separate shelves.
export const CANVAS_SHELF_GAP = CANVAS_ITEM_GAP * 2;
// Device selection resizes previews, not their reserved space in the canvas.
export const CANVAS_SLOT_WIDTH = CANVAS_DEVICES.desktop.width;

export type CanvasPageItem = { kind: "page"; key: string; page: CanvasPage };
export type CanvasBlockItem = { kind: "block"; key: string; block: Block };

/** One entry in the Canvas row: a Page that can be selected, or a block of the Block Catalog. */
export type CanvasItem = CanvasPageItem | CanvasBlockItem;

/**
 * An area of the Canvas row, labelled by its Shelf Marker. An empty area has no
 * marker and no place in the row, unless it is `shownWhenEmpty`: its marker then
 * stands collapsed in a zero-width slot, since there is nothing to expand.
 */
export type CanvasShelf = {
  key: string;
  label: string;
  items: CanvasItem[];
  shownWhenEmpty?: boolean;
};

export type PositionedCanvasItem<T extends CanvasItem = CanvasItem> = T & {
  left: number;
  width: number;
};

/**
 * A Shelf Marker spanning its area, in world-space x. A collapsed shelf hides
 * its items and its marker stands alone at `start`, where `end` equals `start`.
 */
export type CanvasShelfMarker = {
  key: string;
  label: string;
  start: number;
  end: number;
  /** How many items the shelf holds, collapsed or not. */
  count: number;
  collapsed: boolean;
};

/** Per-kind layout and camera behavior. */
const CANVAS_ITEM_KINDS: Record<CanvasItem["kind"], { width: number; snappable: boolean }> = {
  page: { width: CANVAS_SLOT_WIDTH, snappable: true },
  block: { width: CANVAS_SLOT_WIDTH, snappable: true },
};

/** Every page-content Block Definition, alphabetically by title. */
function getBlockCatalog(blocks: readonly Block[]) {
  return blocks
    .filter((block) => !block._internal.layoutOnly)
    .sort((a, b) => a._internal.title.localeCompare(b._internal.title));
}

export function getCanvasShelves(
  pages: readonly CanvasPage[],
  blocks: readonly Block[],
): CanvasShelf[] {
  return [
    {
      // Prefixed so shelf keys can never collide with item keys.
      key: "shelf:pages",
      label: "Pages",
      items: pages.map((page): CanvasPageItem => ({ kind: "page", key: page.key, page })),
    },
    {
      key: "shelf:blocks",
      label: "Blocks",
      // The Block Catalog always has its place on the Canvas.
      shownWhenEmpty: true,
      items: getBlockCatalog(blocks).map(
        (block): CanvasBlockItem => ({ kind: "block", key: `block:${block._internal.id}`, block }),
      ),
    },
  ];
}

/**
 * World-space positions of the Canvas row, matching its flex layout, and the
 * markers above it. Items of collapsed shelves are left out of the row; each
 * collapsed shelf, or empty one that is still shown, takes a zero-width slot
 * instead, so its marker keeps a place and shows as collapsed.
 */
export function positionCanvasShelves(
  shelves: readonly CanvasShelf[],
  collapsed: ReadonlySet<string> = new Set(),
) {
  const items: PositionedCanvasItem[] = [];
  const markers: CanvasShelfMarker[] = [];
  let left = 0;
  for (const shelf of shelves) {
    if (!isCanvasShelfShown(shelf)) continue;
    const start = left;
    const marker = { key: shelf.key, label: shelf.label, count: shelf.items.length };
    if (collapsed.has(shelf.key) || shelf.items.length === 0) {
      markers.push({ ...marker, start, end: start, collapsed: true });
      left += CANVAS_SHELF_GAP;
      continue;
    }
    for (const item of shelf.items) {
      const { width } = CANVAS_ITEM_KINDS[item.kind];
      items.push({ ...item, left, width });
      left += width + CANVAS_ITEM_GAP;
    }
    const end = left - CANVAS_ITEM_GAP;
    markers.push({ ...marker, start, end, collapsed: false });
    left = end + CANVAS_SHELF_GAP;
  }
  // The world-space width of the whole row; the horizontal extent of the Canvas bounds.
  const width = Math.max(0, left - CANVAS_SHELF_GAP);
  return { items, markers, width };
}

/** Whether a shelf has a marker and a place in the row. */
export function isCanvasShelfShown(shelf: CanvasShelf) {
  return shelf.items.length > 0 || shelf.shownWhenEmpty === true;
}

export function isCanvasPage(
  item: PositionedCanvasItem,
): item is PositionedCanvasItem<CanvasPageItem> {
  return item.kind === "page";
}

export function isCanvasBlock(
  item: PositionedCanvasItem,
): item is PositionedCanvasItem<CanvasBlockItem> {
  return item.kind === "block";
}

export function canvasSnapTargets(items: readonly PositionedCanvasItem[]): CanvasSnapTarget[] {
  return items
    .filter((item) => CANVAS_ITEM_KINDS[item.kind].snappable)
    .map(({ key, left, width }) => ({ key, left, width }));
}
