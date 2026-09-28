import assert from "node:assert/strict";
import { test } from "node:test";

import type { Layout } from "../../core/createLayout";
import { getCanvasPages } from "./canvasPages";
import { canvasSelectionUrl, selectedCanvasPage, selectedCanvasPath } from "./canvasSelection";

void test("canvas selection URLs map the bare prefix to home and preserve full encoded paths", () => {
  for (const [path, url] of [
    ["/", "/camox/canvas"],
    ["/about", "/camox/canvas/about"],
    ["/articles/hello%20world", "/camox/canvas/articles/hello%20world"],
    ["/nested/page/", "/camox/canvas/nested/page/"],
  ]) {
    assert.equal(canvasSelectionUrl(path), url);
    assert.equal(selectedCanvasPath(url), path);
  }
  assert.equal(selectedCanvasPath("/camox/canvas/"), "/");
});

void test("selection resolves concrete pages before templates and supports instance deep links", () => {
  const layouts = [
    { _internal: { id: "about", kind: "singleton", title: "About" } },
    { _internal: { id: "articles.$slug", kind: "derived", title: "Article" } },
  ] as Layout[];
  const pages = getCanvasPages(
    [
      { id: 7, nickname: "Home", fullPath: "/" },
      { id: 8, nickname: "Special article", fullPath: "/articles/special" },
    ],
    layouts,
  );
  const select = (url: string) => selectedCanvasPage(pages, layouts, selectedCanvasPath(url));
  assert.equal(select("/camox/canvas")?.key, "page:7");
  assert.equal(select("/camox/canvas/about")?.key, "singleton:about");
  assert.equal(select("/camox/canvas/articles/special")?.key, "page:8");
  assert.equal(select("/camox/canvas/articles/hello%20world")?.key, "template:articles.$slug");
  assert.equal(select("/camox/canvas/missing"), undefined);
});
