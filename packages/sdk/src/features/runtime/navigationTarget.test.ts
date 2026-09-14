import assert from "node:assert/strict";
import { test } from "node:test";

import { getNavigationTarget } from "./navigationTarget";

void test("curated, derived and studio routes all use client navigation", () => {
  for (const path of ["/", "/about", "/pokemon/pikachu", "/camox", "/camox/content"]) {
    assert.equal(getNavigationTarget(path, "https://site.test/about", "")?.pathname, path);
  }
});

void test("mounted runtimes preserve base paths, queries and hashes", () => {
  const target = getNavigationTarget(
    "/pokemon/pikachu?q=1#details",
    "https://site.test/site/",
    "/site",
  );
  assert.equal(target?.url.href, "https://site.test/site/pokemon/pikachu?q=1#details");
  assert.equal(target?.pathname, "/pokemon/pikachu");
  assert.equal(
    getNavigationTarget("https://site.test/site/camox/content", "https://site.test/site/", "/site")
      ?.pathname,
    "/camox/content",
  );
});

void test("external origins, protocols, host routes and runtime endpoints are not intercepted", () => {
  for (const path of [
    "https://other.test/",
    "mailto:hello@example.com",
    "https://site.test/host",
    "/_camox/data",
    "/og",
    "/sitemap.xml",
  ]) {
    assert.equal(getNavigationTarget(path, "https://site.test/site/", "/site"), null);
  }
});
