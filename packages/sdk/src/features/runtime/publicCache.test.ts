import assert from "node:assert/strict";
import { test } from "node:test";

import { respondThroughPublicCache, type PublicCache } from "./publicCache";
import { isPublicRequest, type RuntimeOptions } from "./runtime";

/** Stands in for Cloudflare's cache: keeps one response per URL, as `put` gave it. */
function memoryCache() {
  const kept = new Map<string, Response>();
  const cache = {
    async match(request: Request) {
      return kept.get(request.url)?.clone();
    },
    async put(request: Request, response: Response) {
      kept.set(request.url, response);
    },
  } as unknown as Cache;
  return { cache, kept };
}

/** A website whose public renders go through the cache, with Live and the build as given. */
function website({
  render = async () => new Response("<h1>Live</h1>", { headers: { "Content-Type": "text/html" } }),
  openCache,
}: {
  render?: (request: Request) => Promise<Response | null>;
  openCache?: () => Promise<Cache>;
} = {}) {
  const { cache, kept } = memoryCache();
  const state = { liveCacheKey: "live-1" as string | null, build: "build-1", renders: 0 };
  const pending: Promise<unknown>[] = [];
  const publicCache = (): PublicCache => ({
    cache: openCache ?? (async () => cache),
    liveCacheKey: async () => state.liveCacheKey,
    build: state.build,
    waitUntil: (promise) => pending.push(promise),
  });
  const serve = async (request: Request) => {
    const response = await respondThroughPublicCache(request, publicCache(), async () => {
      state.renders += 1;
      return render(request);
    });
    await Promise.all(pending);
    return response;
  };
  return { state, serve, kept };
}

void test("a visitor's page renders once, then the edge answers it", async () => {
  const { state, serve } = website();

  const first = await serve(new Request("https://site.test/about"));
  const second = await serve(new Request("https://site.test/about"));

  assert.equal(state.renders, 1);
  assert.equal(await first!.text(), "<h1>Live</h1>");
  assert.equal(await second!.text(), "<h1>Live</h1>");
});

void test("a change to Live renders the page again, under the new Live cache key", async () => {
  const { state, serve } = website();
  await serve(new Request("https://site.test/about"));

  state.liveCacheKey = "live-2";
  await serve(new Request("https://site.test/about"));

  assert.equal(state.renders, 2);
});

void test("a release renders the page again, so it never names the last release's assets", async () => {
  const { state, serve } = website();
  await serve(new Request("https://site.test/about"));

  state.build = "build-2";
  await serve(new Request("https://site.test/about"));

  assert.equal(state.renders, 2);
});

void test("without a Live cache key, every request renders and nothing is kept", async () => {
  const { state, serve, kept } = website();
  state.liveCacheKey = null;

  await serve(new Request("https://site.test/about"));
  await serve(new Request("https://site.test/about"));

  assert.equal(state.renders, 2);
  assert.equal(kept.size, 0);
});

void test("a page's Markdown Representation is kept apart from its HTML", async () => {
  const { state, serve } = website({
    render: async (request) =>
      new Response(request.headers.get("Accept") === "text/markdown" ? "# Live" : "<h1>Live</h1>"),
  });
  await serve(new Request("https://site.test/about"));

  const markdown = await serve(
    new Request("https://site.test/about", { headers: { Accept: "text/markdown" } }),
  );

  assert.equal(state.renders, 2);
  assert.equal(await markdown!.text(), "# Live");
});

for (const [kind, response] of [
  ["private", () => new Response("Studio", { headers: { "Cache-Control": "private, no-store" } })],
  ["no-store", () => new Response("Studio", { headers: { "Cache-Control": "no-store" } })],
  [
    "cookie-setting",
    () => new Response("Signed out", { headers: { "Set-Cookie": "a=; Max-Age=0" } }),
  ],
  ["missing", () => new Response("Not found", { status: 404 })],
] as const) {
  void test(`a ${kind} response is never kept, even for a request that looked public`, async () => {
    const { state, serve, kept } = website({ render: async () => response() });

    await serve(new Request("https://site.test/camox"));
    await serve(new Request("https://site.test/camox"));

    assert.equal(state.renders, 2);
    assert.equal(kept.size, 0);
  });
}

void test("visitors' browsers revalidate a render, and no cache downstream keeps the edge's copy", async () => {
  const { serve, kept } = website();

  const first = await serve(new Request("https://site.test/about"));
  const second = await serve(new Request("https://site.test/about"));

  assert.equal(first!.headers.get("Cache-Control"), "public, max-age=0, must-revalidate");
  assert.equal(second!.headers.get("Cache-Control"), "public, max-age=0, must-revalidate");
  const [edgeCopy] = kept.values();
  assert.match(edgeCopy!.headers.get("Cache-Control")!, /s-maxage=\d+/);
});

void test("a versioned render keeps the lifetime it asked browsers for", async () => {
  const { serve } = website({
    render: async () =>
      new Response("png", { headers: { "Cache-Control": "public, max-age=86400" } }),
  });

  await serve(new Request("https://site.test/_camox/logo.png?v=1"));
  const cached = await serve(new Request("https://site.test/_camox/logo.png?v=1"));

  assert.equal(cached!.headers.get("Cache-Control"), "public, max-age=86400");
});

void test("HEAD is answered from the page's render, without its body", async () => {
  const { state, serve } = website();
  await serve(new Request("https://site.test/about"));

  const head = await serve(new Request("https://site.test/about", { method: "HEAD" }));

  assert.equal(state.renders, 1);
  assert.equal(head!.status, 200);
  assert.equal(await head!.text(), "");
});

const options: RuntimeOptions = {
  apiUrl: "https://api.test",
  authenticationUrl: "https://auth.test",
  projectUuid: "test",
  renderPage: async () => "",
};

/** A cache that throws as `caches.default` does in a dispatch namespace's untrusted mode. */
const forbidden = () => new Error("This Worker is not permitted to access the default cache.");

for (const [step, openCache] of [
  [
    "opened",
    async () => {
      throw forbidden();
    },
  ],
  [
    "read",
    async () =>
      ({
        match: async () => {
          throw forbidden();
        },
        put: async () => {},
      }) as unknown as Cache,
  ],
] as const) {
  void test(`a page renders without the edge cache when it can't be ${step}`, async () => {
    const { state, serve } = website({ openCache });

    const first = await serve(new Request("https://site.test/about"));
    const second = await serve(new Request("https://site.test/about"));

    assert.equal(state.renders, 2);
    assert.equal(await first!.text(), "<h1>Live</h1>");
    assert.equal(await second!.text(), "<h1>Live</h1>");
  });
}

void test("a page is still answered when the edge cache can't keep its render", async () => {
  const failing = {
    match: async () => undefined,
    put: () => {
      throw forbidden();
    },
  } as unknown as Cache;
  const { serve } = website({ openCache: async () => failing });

  const response = await serve(new Request("https://site.test/about"));

  assert.equal(response!.status, 200);
  assert.equal(await response!.text(), "<h1>Live</h1>");
});

void test("pages and the runtime's public outputs are public requests for visitors", () => {
  for (const path of [
    "/",
    "/about",
    "/de/about",
    "/about.md",
    "/_camox/data?path=/about",
    "/sitemap.xml",
    "/llms.txt",
    "/og?path=/about",
    "/_camox/logo.png?v=1",
  ]) {
    assert.equal(isPublicRequest(new Request(`https://site.test${path}`), options), true, path);
  }
});

void test("a session, a draft, a preview handoff or a write is never a public request", () => {
  for (const request of [
    new Request("https://site.test/about", {
      headers: { Cookie: "camox_auth_cookie=token%3Dtest" },
    }),
    new Request("https://site.test/about?camox-draft=spring-sale"),
    new Request("https://site.test/about?camox-preview=target&ott=token"),
    new Request("https://site.test/about", { method: "POST" }),
  ]) {
    assert.equal(isPublicRequest(request, options), false, request.url);
  }
});

void test("the Studio, the Canvas and the runtime's member routes are never public requests", () => {
  for (const path of [
    "/camox",
    "/camox/content",
    "/_camox/routes?layoutId=post",
    "/_camox/health",
    "/_camox/registry",
  ]) {
    assert.equal(isPublicRequest(new Request(`https://site.test${path}`), options), false, path);
  }
});
