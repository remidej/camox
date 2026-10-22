import assert from "node:assert/strict";
import { test } from "node:test";

import { CANVAS_ITEM_GAP, CANVAS_SLOT_WIDTH, positionCanvasPages } from "./canvasItems";
import type { CanvasPage } from "./canvasPages";

const pages: CanvasPage[] = [
  { kind: "curated", key: "page:1", title: "Home", pathname: "/", pageId: "1" },
  { kind: "curated", key: "page:2", title: "About", pathname: "/about", pageId: "2" },
];

void test("Pages sit side by side, a gap apart, and the row spans them all", () => {
  const { items, width } = positionCanvasPages(pages);
  assert.deepEqual(
    items.map(({ key, left }) => [key, left]),
    [
      ["page:1", 0],
      ["page:2", CANVAS_SLOT_WIDTH + CANVAS_ITEM_GAP],
    ],
  );
  assert.equal(width, CANVAS_SLOT_WIDTH * 2 + CANVAS_ITEM_GAP);
});

void test("an empty Canvas has no width", () => {
  assert.deepEqual(positionCanvasPages([]), { items: [], width: 0 });
});
