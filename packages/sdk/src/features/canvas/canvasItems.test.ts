import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canvasRowWidth,
  canvasSnapTargets,
  getCanvasShelves,
  positionCanvasShelves,
  type CanvasShelf,
} from "./canvasItems";
import type { CanvasPage } from "./canvasPages";

const pages: CanvasPage[] = [
  { key: "page:1", title: "Home", pathname: "/", pageId: 1 },
  { key: "page:2", title: "About", pathname: "/about", pageId: 2 },
];

void test("the Pages Shelf Marker spans every Page", () => {
  const { items, markers } = positionCanvasShelves(getCanvasShelves(pages));
  // Page (1366) + gap (240) + Page (1366).
  assert.equal(canvasRowWidth(items), 2972);
  assert.deepEqual(markers, [{ key: "shelf:pages", label: "Pages", start: 0, end: 2972 }]);
});

void test("each Shelf Marker spans only its own area", () => {
  const [pagesShelf] = getCanvasShelves(pages);
  const blocks: CanvasShelf = { ...pagesShelf!, key: "shelf:blocks", label: "Blocks" };
  const { markers } = positionCanvasShelves([pagesShelf!, blocks]);
  assert.deepEqual(
    markers.map(({ key, start, end }) => ({ key, start, end })),
    [
      { key: "shelf:pages", start: 0, end: 2972 },
      { key: "shelf:blocks", start: 3212, end: 6184 },
    ],
  );
});

void test("Pages are snap targets", () => {
  const { items } = positionCanvasShelves(getCanvasShelves(pages));
  assert.deepEqual(canvasSnapTargets(items), [
    { key: "page:1", left: 0, width: 1366 },
    { key: "page:2", left: 1606, width: 1366 },
  ]);
});

void test("an empty area has no Shelf Marker", () => {
  const { items, markers } = positionCanvasShelves(getCanvasShelves([]));
  assert.equal(canvasRowWidth(items), 0);
  assert.deepEqual(markers, []);
});
