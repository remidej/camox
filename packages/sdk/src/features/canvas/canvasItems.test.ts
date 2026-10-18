import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CANVAS_SHELF_GAP,
  canvasSnapTargets,
  getCanvasShelves,
  positionCanvasShelves,
  type CanvasShelf,
} from "./canvasItems";
import type { CanvasPage } from "./canvasPages";

const pages: CanvasPage[] = [
  { kind: "curated", key: "page:1", title: "Home", pathname: "/", pageId: "1" },
  { kind: "curated", key: "page:2", title: "About", pathname: "/about", pageId: "2" },
];

void test("the Pages Shelf Marker spans every Page", () => {
  const { markers } = positionCanvasShelves(getCanvasShelves(pages, []));
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

void test("each Shelf Marker spans only its own area, further apart than the items within it", () => {
  const [pagesShelf] = getCanvasShelves(pages, []);
  const blocks: CanvasShelf = { ...pagesShelf!, key: "shelf:blocks", label: "Blocks" };
  const { items, markers } = positionCanvasShelves([pagesShelf!, blocks]);
  assert.deepEqual(
    markers.map(({ key, start, end }) => ({ key, start, end })),
    [
      { key: "shelf:pages", start: 0, end: 2972 },
      { key: "shelf:blocks", start: 2972 + CANVAS_SHELF_GAP, end: 2972 * 2 + CANVAS_SHELF_GAP },
    ],
  );
  const itemGap = items[1]!.left - (items[0]!.left + items[0]!.width);
  assert.ok(markers[1]!.start - markers[0]!.end > itemGap);
});

void test("Pages are snap targets", () => {
  const { items } = positionCanvasShelves(getCanvasShelves(pages, []));
  assert.deepEqual(canvasSnapTargets(items), [
    { key: "page:1", left: 0, width: 1366 },
    { key: "page:2", left: 1606, width: 1366 },
  ]);
});

void test("an empty Pages area has no Shelf Marker", () => {
  const { markers, width } = positionCanvasShelves(getCanvasShelves([], []));
  assert.deepEqual(
    markers.map(({ key }) => key),
    ["shelf:blocks"],
  );
  assert.equal(markers[0]!.start, 0, "the empty Pages area takes no place in the row");
  assert.equal(width, 0);
});

void test("the Blocks Shelf Marker shows with no blocks, collapsed in a zero-width slot", () => {
  const { markers, width } = positionCanvasShelves(getCanvasShelves(pages, []));
  const [pagesMarker, blocksMarker] = markers;
  assert.deepEqual(blocksMarker, {
    key: "shelf:blocks",
    label: "Blocks",
    count: 0,
    start: pagesMarker!.end + CANVAS_SHELF_GAP,
    end: pagesMarker!.end + CANVAS_SHELF_GAP,
    collapsed: true,
  });
  assert.equal(width, blocksMarker!.start, "the empty slot ends the row");
});

void test("a collapsed shelf hides its items and keeps a zero-width slot for its marker", () => {
  const [pagesShelf] = getCanvasShelves(pages, []);
  const blocks: CanvasShelf = { ...pagesShelf!, key: "shelf:blocks", label: "Blocks" };
  const { items, markers, width } = positionCanvasShelves(
    [pagesShelf!, blocks],
    new Set(["shelf:pages"]),
  );
  assert.deepEqual(
    markers.map(({ key, start, end, collapsed }) => ({ key, start, end, collapsed })),
    [
      { key: "shelf:pages", start: 0, end: 0, collapsed: true },
      {
        key: "shelf:blocks",
        start: CANVAS_SHELF_GAP,
        end: CANVAS_SHELF_GAP + 2972,
        collapsed: false,
      },
    ],
  );
  assert.deepEqual(
    canvasSnapTargets(items).map(({ left }) => left),
    [CANVAS_SHELF_GAP, CANVAS_SHELF_GAP + 1606],
  );
  assert.equal(width, CANVAS_SHELF_GAP + 2972);
});

void test("collapsing every shelf leaves only marker slots", () => {
  const { items, width } = positionCanvasShelves(
    getCanvasShelves(pages, []),
    new Set(["shelf:pages"]),
  );
  assert.deepEqual(items, []);
  // The collapsed Pages slot, a gap, then the empty Blocks slot.
  assert.equal(width, CANVAS_SHELF_GAP);
});
