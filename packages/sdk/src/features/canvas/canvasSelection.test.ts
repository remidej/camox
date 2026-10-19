import assert from "node:assert/strict";
import { test } from "node:test";

import type { Layout } from "../../core/createLayout";
import { getCanvasPages } from "./canvasPages";
import { selectedCanvasPage } from "./canvasSelection";

void test("selection resolves concrete pages before derived layouts and supports page path deep links", () => {
  const layouts = [
    { _internal: { id: "about", kind: "singleton", title: "About" } },
    { _internal: { id: "articles.$slug", kind: "derived", title: "Article" } },
  ] as Layout[];
  const pages = getCanvasPages(
    [
      { id: "7", nickname: "Home", fullPath: "/" },
      { id: "8", nickname: "Special article", fullPath: "/articles/special" },
    ],
    layouts,
  );
  const select = (pathname: string) => selectedCanvasPage(pages, layouts, pathname);
  assert.equal(select("/")?.key, "page:7");
  assert.equal(select("/about")?.key, "singleton:about");
  assert.equal(select("/articles/special")?.key, "page:8");
  assert.equal(select("/articles/hello%20world")?.key, "derived:articles.$slug");
  assert.equal(select("/missing"), undefined);
});

void test("in a non-default locale, pages sit under its prefix and derived routes match after it", () => {
  const de = { tag: "de", isDefault: false };
  const locales = [{ tag: "en", isDefault: true }, de];
  const layouts = [
    { _internal: { id: "about", kind: "singleton", title: "About" } },
    { _internal: { id: "articles.$slug", kind: "derived", title: "Article" } },
  ] as Layout[];
  const pages = getCanvasPages(
    [
      { id: "7", nickname: "Home", fullPath: "/" },
      { id: "9", nickname: "Pricing", fullPath: "/preise" },
    ],
    layouts,
    new Map([["articles.$slug", "/articles/hello"]]),
    de,
  );
  const select = (pathname: string) => selectedCanvasPage(pages, layouts, pathname, locales);

  assert.deepEqual(
    pages.map((page) => page.pathname),
    ["/de", "/de/preise", "/de/about", null],
    "a default-locale record's discovered path isn't the locale's",
  );
  assert.equal(select("/de")?.key, "page:7");
  assert.equal(select("/de/preise")?.key, "page:9");
  assert.equal(select("/de/about")?.key, "singleton:about");
  assert.equal(select("/de/articles/hallo")?.key, "derived:articles.$slug");
});
