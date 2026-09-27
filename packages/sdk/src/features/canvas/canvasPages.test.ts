import assert from "node:assert/strict";
import { test } from "node:test";

import { CANVAS_DEVICES, getCanvasPages, validateCanvasPageInput } from "./canvasPages";

void test("canvas contains curated pages, singleton pages, and one frame per template", () => {
  const pages = getCanvasPages(
    [{ id: 7, nickname: "Home", fullPath: "/" }],
    [
      { _internal: { id: "regular", kind: "curated", title: "Regular" } },
      { _internal: { id: "about", kind: "singleton", title: "About" } },
      { _internal: { id: "articles.$slug", kind: "derived", title: "Article" } },
    ],
  );
  assert.deepEqual(pages, [
    { key: "page:7", title: "Home", pathname: "/" },
    { key: "singleton:about", title: "About", pathname: "/about" },
    {
      key: "template:articles.$slug",
      title: "Article",
      pathname: null,
      templateId: "articles.$slug",
      pattern: "/articles/:slug",
    },
  ]);
});

void test("fixed derived routes can preview without choosing an instance", () => {
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

void test("template frames reject curated routes that shadow the template pattern", () => {
  const input = {
    pathname: "/articles/foo",
    previewDocument: "<html></html>",
    dehydratedState: { queries: [] },
  };
  assert.doesNotThrow(() => validateCanvasPageInput(input, "/articles/foo"));
  assert.throws(
    () => validateCanvasPageInput(input, "/articles/foo", "articles.$slug"),
    /does not render the selected template/,
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
