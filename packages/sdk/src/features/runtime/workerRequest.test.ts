import assert from "node:assert/strict";
import { test } from "node:test";

import { shouldHandleRequest, withDevHtml } from "./workerRequest";

function request(path: string, init: RequestInit & { accept?: string } = {}) {
  return new Request(`https://site.test${path}`, {
    ...init,
    headers: { Accept: init.accept ?? "text/html" },
  });
}

void test("the Worker answers pages, their Markdown and the runtime's own routes", () => {
  for (const path of ["/", "/about", "/about.md", "/_camox/data", "/og", "/sitemap.xml", "/camox"])
    assert.equal(shouldHandleRequest(request(path), ""), true, path);
  assert.equal(shouldHandleRequest(request("/about", { accept: "text/markdown" }), ""), true);
});

void test("the Worker leaves files, Vite's modules and non-page requests alone", () => {
  for (const path of ["/logo.png", "/@vite/client", "/src/main.tsx", "/node_modules/x"])
    assert.equal(shouldHandleRequest(request(path), ""), false, path);
  assert.equal(shouldHandleRequest(request("/about", { method: "POST" }), ""), false);
  assert.equal(shouldHandleRequest(request("/about", { accept: "application/json" }), ""), false);
});

void test("a mounted runtime only answers under its base path", () => {
  assert.equal(shouldHandleRequest(request("/site"), "/site"), true);
  assert.equal(shouldHandleRequest(request("/site/about"), "/site"), true);
  assert.equal(shouldHandleRequest(request("/about"), "/site"), false);
  assert.equal(shouldHandleRequest(request("/siteabout"), "/site"), false);
});

void test("dev HTML lands inside the page's head and body", async () => {
  const page = new Response(
    '<html><head lang="en"><title>A</title></head><body><p>B</p></body></html>',
    {
      headers: { "Content-Type": "text/html; charset=utf-8", "Content-Length": "79" },
    },
  );
  const response = await withDevHtml(page, {
    head: "<script>h</script>",
    body: "<script>b</script>",
  });
  assert.equal(
    await response.text(),
    '<html><head lang="en"><script>h</script><title>A</title></head><body><p>B</p><script>b</script></body></html>',
  );
  assert.equal(response.headers.get("Content-Length"), null);
});

void test("builds and non-HTML responses pass through untouched", async () => {
  const page = new Response("<html><head></head></html>", {
    headers: { "Content-Type": "text/html" },
  });
  assert.equal(await withDevHtml(page, null), page);
  const markdown = new Response("# A", { headers: { "Content-Type": "text/markdown" } });
  assert.equal(await withDevHtml(markdown, { head: "x", body: "y" }), markdown);
});
