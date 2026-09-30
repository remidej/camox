import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";

import {
  canvasInsertionSeams,
  readBlockInsertion,
  type CanvasBlockInsertion,
} from "./canvasInsertionSeams";
import type { CanvasOverlayTarget } from "./canvasOverlayGeometry";

function block(id: string, y: number, insertion?: CanvasBlockInsertion): CanvasOverlayTarget {
  return {
    element: { getAttribute: () => id } as unknown as Element,
    bounds: { x: 20, y, width: 600, height: 100 },
    rects: [],
    visible: true,
    hovered: false,
    focused: false,
    synced: false,
    inline: false,
    insertion,
  };
}

void test("adjacent blocks share one seam regardless of hover or selection", () => {
  const a = block("1", 0, { position: "a0", before: false, after: true });
  const b = block("2", 100, { position: "a1", before: true, after: true });
  const c = block("3", 240, { position: "a2", before: true, after: true });
  const seams = canvasInsertionSeams([a, block("field", 20), b, c]);
  assert.deepEqual(
    seams.map(({ key, x, y }) => ({ key, x, y })),
    [
      { key: "1:2", x: 320, y: 100 },
      { key: "2:3", x: 320, y: 220 },
      { key: "3:end", x: 320, y: 340 },
    ],
  );
  assert.deepEqual(
    seams.map(({ request }) => request),
    ["a0", "a1", "a2"].map((position) => ({
      type: "CAMOX_ADD_BLOCK_REQUEST",
      blockPosition: position,
      insertPosition: "after",
    })),
  );
  a.hovered = true;
  b.focused = true;
  assert.deepEqual(canvasInsertionSeams([a, b, c]), seams);
  assert.deepEqual(
    canvasInsertionSeams([a, c]).map(({ key, y }) => ({ key, y })),
    [
      { key: "1:3", y: 170 },
      { key: "3:end", y: 340 },
    ],
    "removing a block removes its duplicate insertion boundary",
  );
});

void test("layout boundaries preserve start/end overrides without duplicate controls", () => {
  const header = block("header", 0, {
    position: "layout0",
    before: false,
    after: true,
    afterPosition: "",
  });
  const content = block("content", 100, { position: "a0", before: true, after: true });
  const footer = block("footer", 200, {
    position: "layout1",
    before: true,
    after: false,
    afterPosition: null,
  });
  const seams = canvasInsertionSeams([header, content, footer]);
  assert.equal(seams.length, 2);
  assert.equal(seams[0]!.request.afterPosition, "");
  assert.equal(seams[1]!.request.blockPosition, "a0");
  const empty = canvasInsertionSeams([header, footer]);
  assert.equal(empty.length, 1, "empty page between layout blocks still has only one seam");
  assert.equal(empty[0]!.request.afterPosition, "");
  const footerOnly = canvasInsertionSeams([footer]);
  assert.equal(footerOnly[0]!.request.insertPosition, "before");
  assert.equal(footerOnly[0]!.request.afterPosition, null);
  assert.deepEqual(
    canvasInsertionSeams([
      block("derived", 0, { position: "layout", before: false, after: false }),
    ]),
    [],
  );
});

void test("only valid main-block insertion metadata is accepted", async () => {
  const window = new Window();
  const element = window.document.createElement("div");
  const read = () => readBlockInsertion(element as unknown as Element);
  assert.equal(read(), undefined);
  for (const value of ["null", "{}", "{", '{"position":2,"before":true,"after":true}']) {
    element.setAttribute("data-camox-block-insertion", value);
    assert.equal(read(), undefined);
  }
  const insertion = { position: "a0", before: false, after: true, afterPosition: null };
  element.setAttribute("data-camox-block-insertion", JSON.stringify(insertion));
  assert.deepEqual(read(), insertion);
  await window.happyDOM.close();
});
