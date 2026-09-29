import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";

import { fitCanvasPage, placeCanvasPageAnchor } from "../canvas/canvasCamera";
import {
  capturePreviewAnchor,
  captureViewportAnchor,
  resolveViewportAnchor,
  restorePreviewAnchor,
  ViewportContinuity,
} from "./viewportContinuity";

void test("anchors follow stable blocks through reflow, with local offsets and missing-block fallback", () => {
  const window = new Window();
  const doc = window.document as unknown as Document;
  doc.body.innerHTML = '<section data-camox-viewport-block="42"></section>';
  const block = doc.body.firstElementChild!;
  let top = 400;
  let height = 800;
  block.getBoundingClientRect = () => ({ top, bottom: top + height, height }) as DOMRect;
  const anchor = captureViewportAnchor(doc, 650);
  assert.deepEqual(anchor, { blockId: "42", offset: 250, y: 650 });
  top = 900;
  assert.equal(resolveViewportAnchor(doc, anchor), 1150);
  height = 100;
  assert.equal(resolveViewportAnchor(doc, anchor), 1000, "shortened blocks clamp the local offset");
  block.remove();
  assert.equal(resolveViewportAnchor(doc, anchor), 650);
  assert.deepEqual(captureViewportAnchor(doc, 320), { y: 320, offset: 0 });
});

void test("a snapped page supplies a reading position; unsnapped views use only active-page history", () => {
  const continuity = new ViewportContinuity();
  const camera = { x: -1400, y: -800, scale: 0.7 };
  const history = { blockId: "old", offset: 10, y: 100 };
  const visible = { blockId: "new", offset: 40, y: 900 };
  continuity.history.set("/a", history);
  continuity.canvas = {
    capture: () => ({ camera }),
    restore: () => {},
  };
  continuity.transition(false, "/a");
  assert.equal(continuity.pendingPreview?.anchor, history);
  continuity.transition(false, "/b");
  assert.deepEqual(continuity.pendingPreview?.anchor, { y: 0, offset: 0 });
  continuity.canvas.capture = () => ({ camera, pathname: "/a", anchor: visible, snappedKey: "a" });
  continuity.transition(false, "/a");
  assert.equal(continuity.pendingPreview?.anchor, visible);
  continuity.transition(false, "/b");
  assert.deepEqual(continuity.pendingPreview?.anchor, { y: 0, offset: 0 }, "no cross-page anchor");
});

void test("preview anchors use the site's scroll container and its inset, not window scroll", () => {
  const window = new Window();
  const doc = window.document as unknown as Document;
  doc.body.innerHTML = '<main><section data-camox-viewport-block="42"></section></main>';
  const scroll = doc.body.firstElementChild as HTMLElement;
  const block = scroll.firstElementChild!;
  scroll.style.scrollBehavior = "smooth";
  const scrollTo = scroll.scrollTo.bind(scroll);
  const restored: ScrollToOptions[] = [];
  scroll.scrollTo = (options?: ScrollToOptions | number) => {
    assert.equal(typeof options, "object");
    const requested = options as ScrollToOptions;
    assert.equal(requested.behavior, "instant", "restoration overrides site smooth scrolling");
    restored.push(requested);
    scrollTo(requested);
  };
  scroll.scrollTop = 700;
  scroll.getBoundingClientRect = () => ({ top: 60 }) as DOMRect;
  block.getBoundingClientRect = () => ({ top: -140, bottom: 860, height: 1000 }) as DOMRect;
  const anchor = capturePreviewAnchor(doc, scroll);
  assert.deepEqual(anchor, { blockId: "42", offset: 200, y: 700 });
  scroll.scrollTop = 0;
  block.getBoundingClientRect = () => ({ top: 960, bottom: 1960, height: 1000 }) as DOMRect;
  restorePreviewAnchor(doc, scroll, anchor);
  assert.equal(scroll.scrollTop, 1100, "reflow and container inset are accounted for");
  block.remove();
  restorePreviewAnchor(doc, scroll, anchor);
  assert.equal(scroll.scrollTop, 700, "missing content falls back to container scroll position");
  assert.deepEqual(restored, [
    { top: 1100, behavior: "instant" },
    { top: 700, behavior: "instant" },
  ]);
});

void test("navigation during preparation retargets pending handoffs instead of reusing another page's anchor", () => {
  const continuity = new ViewportContinuity();
  continuity.preview = { capture: () => ({ blockId: "a", offset: 200, y: 500 }) };
  continuity.transition(true, "/a");
  continuity.navigate("/b");
  assert.deepEqual(continuity.pendingCanvas?.anchor, { y: 0, offset: 0 });
  const b = { blockId: "b", offset: 300, y: 600 };
  continuity.history.set("/b", b);
  continuity.navigate("/b");
  assert.equal(continuity.pendingCanvas?.anchor, b);
});

void test("an unchanged preview returns the exact camera, while scrolling or navigation wins", () => {
  const continuity = new ViewportContinuity();
  const camera = { x: -124.25, y: -654.75, scale: 0.43 };
  const anchor = { blockId: "42", offset: 123, y: 900 };
  const restored: unknown[][] = [];
  continuity.canvas = {
    capture: () => ({ camera, pathname: "/a", anchor, snappedKey: "a" }),
    restore: (...args) => restored.push(args),
  };
  continuity.preview = { capture: () => anchor };
  continuity.transition(false, "/a");
  continuity.transition(true, "/a");
  continuity.restoreCanvas();
  assert.deepEqual(restored.pop(), [undefined, camera, "a"]);
  continuity.restoreCanvas();
  assert.equal(restored.length, 0, "readiness is idempotent");
  continuity.previewMoved("/a", anchor);
  continuity.transition(true, "/a");
  continuity.restoreCanvas();
  assert.deepEqual(restored.pop(), [anchor, camera, undefined]);
  continuity.transition(false, "/a");
  continuity.transition(true, "/b");
  continuity.restoreCanvas();
  assert.deepEqual(
    restored.pop(),
    [anchor, camera, undefined],
    "navigation invalidates exact return",
  );
});

void test("camera placement preserves zoom and accounts for the iframe offset and header at page top", () => {
  const viewport = { width: 900, height: 700 };
  const page = { left: 1600, width: 1366 };
  const camera = placeCanvasPageAnchor(viewport, page, 1250, 0.6, 12);
  assert.equal(camera.scale, 0.6);
  assert.equal(camera.y + (1250 + 12) * camera.scale, 0);
  assert.equal(camera.x + (page.left + page.width / 2) * camera.scale, viewport.width / 2);
  assert.equal(placeCanvasPageAnchor(viewport, page, 0, 0.6).y, fitCanvasPage(viewport, page).y);
});
