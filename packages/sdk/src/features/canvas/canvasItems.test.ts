import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canvasRowWidth,
  canvasShelfAreas,
  canvasSnapTargets,
  getCanvasItems,
  positionCanvasItems,
} from "./canvasItems";
import type { CanvasPage } from "./canvasPages";

const pages: CanvasPage[] = [
  { key: "page:1", title: "Home", pathname: "/", pageId: 1 },
  { key: "page:2", title: "About", pathname: "/about", pageId: 2 },
];

void test("the Pages Shelf Marker area runs from its marker to the end of the row", () => {
  const items = positionCanvasItems(getCanvasItems(pages));
  // Marker (8) + gap (240) + Page (1366) + gap (240) + Page (1366).
  assert.equal(canvasRowWidth(items), 3220);
  assert.deepEqual(
    canvasShelfAreas(items).map(({ marker, start, end }) => ({ key: marker.key, start, end })),
    [{ key: "shelf:pages", start: 0, end: 3220 }],
  );
});

void test("a later Shelf Marker ends the area of the one before it", () => {
  const [marker, ...rest] = positionCanvasItems(getCanvasItems(pages));
  const blocks = { ...marker!, key: "shelf:blocks", label: "Blocks", left: 4000 };
  const areas = canvasShelfAreas([marker!, ...rest, blocks]);
  assert.deepEqual(
    areas.map(({ marker, start, end }) => ({ key: marker.key, start, end })),
    [
      { key: "shelf:pages", start: 0, end: 4000 },
      { key: "shelf:blocks", start: 4000, end: 4008 },
    ],
  );
});

void test("only Pages are snap targets", () => {
  const items = positionCanvasItems(getCanvasItems(pages));
  assert.deepEqual(canvasSnapTargets(items), [
    { key: "page:1", left: 248, width: 1366 },
    { key: "page:2", left: 1854, width: 1366 },
  ]);
});

void test("an empty Canvas still has its Pages Shelf Marker", () => {
  const items = positionCanvasItems(getCanvasItems([]));
  assert.equal(canvasRowWidth(items), 8);
  assert.deepEqual(canvasSnapTargets(items), []);
});
