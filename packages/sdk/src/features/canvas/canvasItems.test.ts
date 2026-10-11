import assert from "node:assert/strict";
import { test } from "node:test";

import {
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
  const { markers, width } = positionCanvasShelves(getCanvasShelves(pages));
  // Page (1366) + gap (240) + Page (1366).
  assert.equal(width, 2972);
  assert.deepEqual(markers, [
    { key: "shelf:pages", label: "Pages", count: 2, start: 0, end: 2972, collapsed: false },
  ]);
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
  const { markers, width } = positionCanvasShelves(getCanvasShelves([]));
  assert.equal(width, 0);
  assert.deepEqual(markers, []);
});

void test("a collapsed shelf hides its items and keeps a zero-width slot for its marker", () => {
  const [pagesShelf] = getCanvasShelves(pages);
  const blocks: CanvasShelf = { ...pagesShelf!, key: "shelf:blocks", label: "Blocks" };
  const { items, markers, width } = positionCanvasShelves(
    [pagesShelf!, blocks],
    new Set(["shelf:pages"]),
  );
  assert.deepEqual(
    markers.map(({ key, start, end, collapsed }) => ({ key, start, end, collapsed })),
    [
      { key: "shelf:pages", start: 0, end: 0, collapsed: true },
      { key: "shelf:blocks", start: 240, end: 3212, collapsed: false },
    ],
  );
  assert.deepEqual(
    canvasSnapTargets(items).map(({ left }) => left),
    [240, 1846],
  );
  assert.equal(width, 3212);
});

void test("collapsing the only shelf leaves an empty row", () => {
  const { items, width } = positionCanvasShelves(getCanvasShelves(pages), new Set(["shelf:pages"]));
  assert.deepEqual(items, []);
  assert.equal(width, 0);
});
