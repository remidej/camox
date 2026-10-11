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
  const { markers } = positionCanvasShelves(getCanvasShelves(pages));
  // Page (1366) + gap (240) + Page (1366).
  assert.deepEqual(markers[0], {
    key: "shelf:pages",
    label: "Pages",
    count: 2,
    start: 0,
    end: 2972,
    collapsed: false,
  });
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

void test("an empty area keeps its Shelf Marker in a zero-width slot", () => {
  const { markers, width } = positionCanvasShelves(getCanvasShelves([]));
  assert.deepEqual(markers, [
    { key: "shelf:pages", label: "Pages", count: 0, start: 0, end: 0, collapsed: true },
    { key: "shelf:blocks", label: "Blocks", count: 0, start: 240, end: 240, collapsed: true },
  ]);
  assert.equal(width, 240);
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

void test("collapsing every shelf leaves only marker slots", () => {
  const { items, width } = positionCanvasShelves(getCanvasShelves(pages), new Set(["shelf:pages"]));
  assert.deepEqual(items, []);
  // The collapsed Pages slot, a gap, then the empty Blocks slot.
  assert.equal(width, 240);
});
