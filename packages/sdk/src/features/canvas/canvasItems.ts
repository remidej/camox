import type { CanvasSnapTarget } from "./canvasCamera";
import { CANVAS_DEVICES, type CanvasPage } from "./canvasPages";

export const CANVAS_ITEM_GAP = 240;
// Device selection resizes previews, not their reserved space in the canvas.
export const CANVAS_SLOT_WIDTH = CANVAS_DEVICES.desktop.width;

/** A Page's place in the Canvas row, in world-space x. */
export type PositionedCanvasPage = { key: string; page: CanvasPage; left: number; width: number };

/**
 * World-space positions of the Canvas row, matching its flex layout: every Page
 * side by side, in Canvas order.
 */
export function positionCanvasPages(pages: readonly CanvasPage[]) {
  const items = pages.map((page, index): PositionedCanvasPage => ({
    key: page.key,
    page,
    left: index * (CANVAS_SLOT_WIDTH + CANVAS_ITEM_GAP),
    width: CANVAS_SLOT_WIDTH,
  }));
  // The world-space width of the whole row; the horizontal extent of the Canvas bounds.
  const width = Math.max(0, pages.length * (CANVAS_SLOT_WIDTH + CANVAS_ITEM_GAP) - CANVAS_ITEM_GAP);
  return { items, width };
}

export function canvasSnapTargets(items: readonly PositionedCanvasPage[]): CanvasSnapTarget[] {
  return items.map(({ key, left, width }) => ({ key, left, width }));
}
