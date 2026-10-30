import { fitCanvasPage, type CanvasSize, type CanvasSnapTarget } from "./canvasCamera";
import { CANVAS_DEVICES, type CanvasPage } from "./canvasPages";

// Device selection resizes previews, not their reserved space in the canvas.
export const CANVAS_SLOT_WIDTH = CANVAS_DEVICES.desktop.width;
/** World-space bounds of the gap, so very narrow or wide canvases still space Pages alike. */
export const MIN_CANVAS_ITEM_GAP = 96;
export const MAX_CANVAS_ITEM_GAP = 320;

/**
 * The world-space gap between Pages that, with a Page snapped, starts the next one halfway
 * across the sidebar laid over the working area's edge. The snapped zoom follows the working
 * area's width, so the gap does too.
 */
export function canvasItemGap(workingArea: CanvasSize, sidebarWidth: number) {
  const fit = fitCanvasPage(workingArea, { left: 0, width: CANVAS_SLOT_WIDTH });
  // At the fit, a Page's edge sits this far inside the sidebar's edge, on screen.
  const pageInset = (workingArea.width - CANVAS_SLOT_WIDTH * fit.scale) / 2;
  const gap = (pageInset + sidebarWidth / 2) / fit.scale;
  return Math.min(MAX_CANVAS_ITEM_GAP, Math.max(MIN_CANVAS_ITEM_GAP, gap));
}

/** A Page's place in the Canvas row, in world-space x. */
export type PositionedCanvasPage = { key: string; page: CanvasPage; left: number; width: number };

/**
 * World-space positions of the Canvas row, matching its flex layout: every Page
 * side by side, in Canvas order, a gap apart.
 */
export function positionCanvasPages(pages: readonly CanvasPage[], gap: number) {
  const items = pages.map((page, index): PositionedCanvasPage => ({
    key: page.key,
    page,
    left: index * (CANVAS_SLOT_WIDTH + gap),
    width: CANVAS_SLOT_WIDTH,
  }));
  // The world-space width of the whole row; the horizontal extent of the Canvas bounds.
  const width = Math.max(0, pages.length * (CANVAS_SLOT_WIDTH + gap) - gap);
  return { items, width };
}

export function canvasSnapTargets(items: readonly PositionedCanvasPage[]): CanvasSnapTarget[] {
  return items.map(({ key, left, width }) => ({ key, left, width }));
}
