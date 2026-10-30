import assert from "node:assert/strict";
import { test } from "node:test";

import { fitCanvasPage } from "./canvasCamera";
import {
  CANVAS_SLOT_WIDTH,
  canvasItemGap,
  MAX_CANVAS_ITEM_GAP,
  MIN_CANVAS_ITEM_GAP,
  positionCanvasPages,
} from "./canvasItems";
import type { CanvasPage } from "./canvasPages";

const pages: CanvasPage[] = [
  { kind: "curated", key: "page:1", title: "Home", pathname: "/", pageId: "1" },
  { kind: "curated", key: "page:2", title: "About", pathname: "/about", pageId: "2" },
];

void test("Pages sit side by side, a gap apart, and the row spans them all", () => {
  const { items, width } = positionCanvasPages(pages, 200);
  assert.deepEqual(
    items.map(({ key, left }) => [key, left]),
    [
      ["page:1", 0],
      ["page:2", CANVAS_SLOT_WIDTH + 200],
    ],
  );
  assert.equal(width, CANVAS_SLOT_WIDTH * 2 + 200);
});

void test("an empty Canvas has no width", () => {
  assert.deepEqual(positionCanvasPages([], 200), { items: [], width: 0 });
});

void test("with a Page snapped, the next one starts halfway across the sidebar", () => {
  const sidebar = 265;
  for (const width of [1440 - sidebar * 2, 1512 - sidebar * 2, 1728 - sidebar * 2]) {
    const workingArea = { width, height: 800 };
    const gap = canvasItemGap(workingArea, sidebar);
    const [, next] = positionCanvasPages(pages, gap).items;
    const fit = fitCanvasPage(workingArea, { left: 0, width: CANVAS_SLOT_WIDTH });
    // On screen, from the working area's left edge; the sidebar starts at its right edge.
    const nextLeft = fit.x + next!.left * fit.scale;
    assert.ok(Math.abs(nextLeft - (width + sidebar / 2)) < 1e-6, `at ${width}px: ${nextLeft}`);
  }
});

void test("the gap stays within its bounds on very narrow and very wide canvases", () => {
  assert.equal(canvasItemGap({ width: 200, height: 800 }, 265), MAX_CANVAS_ITEM_GAP);
  assert.equal(canvasItemGap({ width: 2700, height: 800 }, 265), MIN_CANVAS_ITEM_GAP);
});
