import assert from "node:assert/strict";
import { test } from "node:test";

import { CANVAS_DEVICES, getCanvasPages, validateCanvasPageInput } from "./canvasPages";

void test("canvas contains curated pages, singleton pages, and one frame per derived layout", () => {
  const pages = getCanvasPages(
    [{ id: 7, nickname: "Home", fullPath: "/" }],
    [
      { _internal: { id: "regular", kind: "curated", title: "Regular" } },
      { _internal: { id: "about", kind: "singleton", title: "About" } },
      { _internal: { id: "articles.$slug", kind: "derived", title: "Article" } },
    ],
  );
  assert.deepEqual(pages, [
    { key: "page:7", title: "Home", pathname: "/", pageId: 7 },
    {
      key: "singleton:about",
      title: "About",
      pathname: "/about",
      layoutId: "about",
    },
    {
      key: "derived:articles.$slug",
      title: "Article",
      pathname: null,
      derivedLayoutId: "articles.$slug",
      pattern: "/articles/:slug",
      layoutId: "articles.$slug",
    },
  ]);
});

void test("fixed derived routes can preview without choosing a page path", () => {
  const pages = getCanvasPages(
    [],
    [{ _internal: { id: "articles", kind: "derived", title: "Articles" } }],
  );
  assert.equal(pages[0]?.pathname, "/articles");
});

void test("device presets are fixed dimensions independent of the Studio viewport", () => {
  assert.deepEqual(Object.keys(CANVAS_DEVICES), ["desktop", "tablet", "mobile"]);
  assert.equal(CANVAS_DEVICES.desktop.width, 1366);
  assert.equal(CANVAS_DEVICES.mobile.width, 390);
  assert.ok(Object.values(CANVAS_DEVICES).every((device) => device.height > 0));
});

void test("derived layout frames reject curated routes that shadow the route pattern", () => {
  const input = {
    pathname: "/articles/foo",
    previewDocument: "<html></html>",
    dehydratedState: { queries: [] },
  };
  assert.doesNotThrow(() => validateCanvasPageInput(input, "/articles/foo"));
  assert.throws(
    () => validateCanvasPageInput(input, "/articles/foo", "articles.$slug"),
    /does not render the selected derived layout/,
  );
  assert.doesNotThrow(() =>
    validateCanvasPageInput(
      { ...input, derived: { layoutId: "articles.$slug" } },
      "/articles/foo",
      "articles.$slug",
    ),
  );
  assert.throws(() => validateCanvasPageInput(input, "/other"), /did not return a page preview/);
});
