import assert from "node:assert/strict";
import { test } from "node:test";

import type { Layout } from "../../core/createLayout";
import { getCanvasPages } from "./canvasPages";
import { selectedCanvasPage } from "./canvasSelection";

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
  const select = (pathname: string) => selectedCanvasPage(pages, layouts, pathname);
  assert.equal(select("/")?.key, "page:7");
  assert.equal(select("/about")?.key, "singleton:about");
  assert.equal(select("/articles/special")?.key, "page:8");
  assert.equal(select("/articles/hello%20world")?.key, "template:articles.$slug");
  assert.equal(select("/missing"), undefined);
});
