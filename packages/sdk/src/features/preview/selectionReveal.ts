export interface VerticalSpan {
  top: number;
  bottom: number;
}

/** Room kept between a revealed item and the edge it scrolls to. */
export const REVEAL_MARGIN = 48;
/** An item counts as in view while this share of it, or of the view if it is taller, shows. */
export const REVEAL_VISIBLE_SHARE = 0.5;

/**
 * How far to scroll so a selected item shows: 0 while enough of it already does.
 * Otherwise scroll the least: its top to the view's top, or its bottom to the view's
 * bottom. An item too tall to fit shows from its top.
 */
export function revealScrollDelta(item: VerticalSpan, view: VerticalSpan) {
  const height = item.bottom - item.top;
  const viewHeight = view.bottom - view.top;
  const visible = Math.max(0, Math.min(item.bottom, view.bottom) - Math.max(item.top, view.top));
  if (visible >= Math.max(1, Math.min(height, viewHeight)) * REVEAL_VISIBLE_SHARE) return 0;
  const margin = Math.min(REVEAL_MARGIN, viewHeight / 4);
  if (item.top < view.top || height > viewHeight - margin * 2) return item.top - view.top - margin;
  return item.bottom - view.bottom + margin;
}
