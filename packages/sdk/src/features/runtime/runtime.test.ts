import assert from "node:assert/strict";
import { test } from "node:test";

import type { CamoxApp } from "../../core/createApp";
import { handleCamoxRequest, type PageRenderInput, type RuntimeOptions } from "./runtime";

const project = { id: 1, name: "Real project", slug: "test", updatedAt: "2026-01-01" };
const layout = {
  id: 2,
  layoutId: "pokemon.$name",
  beforeBlockIds: [],
  afterBlockIds: [],
  updatedAt: "2026-01-01",
};
const app = {
  getLayouts: () => [
    {
      _internal: {
        id: "pokedex",
        kind: "singleton",
        title: "Pokédex",
        loader: async () => ({ kind: "data", data: { count: 12 } }),
      },
    },
    { _internal: { id: "about-camox", kind: "singleton", title: "About Camox" } },
    {
      _internal: {
        id: "pokemon.$name",
        kind: "derived",
        title: "Pokemon",
        loader: async ({ params }: { params: { name: string } }) => ({
          kind: "data",
          data: { name: params.name },
        }),
      },
    },
  ],
  getLayoutById: () => null,
} as unknown as CamoxApp;

void test("preview authenticates before loading an unpublished path", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("No content requests should precede the token exchange");
  });
  const response = await handleCamoxRequest(
    new Request("http://localhost:3000/draft-only?camox-preview=target&ott=token"),
    {
      apiUrl: "https://api.test",
      authenticationUrl: "https://auth.test",
      environmentName: "dev:me@example.test",
      projectSlug: "test",
      pageClientEntryUrl: "/client.js",
      renderPage: async (input) => {
        assert.equal(input.previewHandoff, true);
        assert.equal(input.pathname, "/draft-only");
        assert.equal(input.loaderData, null);
        return "Signing in to draft preview…";
      },
    },
  );
  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response?.headers.get("Referrer-Policy"), "no-referrer");
  const html = await response!.text();
  assert.match(html, /client.js/);
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
});

void test("runtime returns complete route payloads for curated, singleton, derived and studio navigation", async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const path = new URL(request.url).pathname;
    calls.push(path);
    if (path.endsWith("/getBySlug")) return Response.json({ json: project });
    if (path.endsWith("/listBySlug")) return Response.json({ json: [] });
    if (path.endsWith("/getByPath")) {
      const body = (await request.json()) as { json: { path: string } };
      assert.ok(
        !["/pokedex", "/about-camox"].includes(body.json.path),
        "Singleton routes must not query curated page records",
      );
      if (body.json.path.startsWith("/pokemon/"))
        return Response.json(
          { json: { defined: false, code: "NOT_FOUND", status: 404, message: "Not found" } },
          { status: 404 },
        );
      return Response.json({
        json: {
          page: { id: 1, fullPath: body.json.path, pathSegment: "about", status: "draft" },
          layout: null,
          project,
          projectName: project.name,
          blocks: [],
          files: [],
          repeatableItems: [],
        },
      });
    }
    if (path.endsWith("/layouts/get"))
      return Response.json({ json: { layout, blocks: [], files: [], repeatableItems: [] } });
    throw new Error(`Unexpected API request ${path}`);
  });
  const options: RuntimeOptions = {
    apiUrl: "https://api.test",
    authenticationUrl: "https://auth.test",
    projectSlug: "test",
    getCamoxApp: async () => app,
    stylesheetUrl: "/site.css",
    studioStylesheetUrl: "/studio.css",
    getDocument: async () => ({
      htmlAttrs: { class: "dark" },
      bodyAttrs: { class: "site-body" },
      script: [{ innerHTML: "window.siteTheme = true" }],
    }),
    renderPage: async (input) =>
      input.presentation === "public"
        ? '<main id="site-content">Site content</main>'
        : "<nav>Studio</nav>",
    renderStudio: async () => "<nav>Studio</nav>",
  };
  for (const path of [
    "/about",
    "/pokedex",
    "/about-camox",
    "/pokemon/pikachu",
    "/camox/content",
    "/camox/content/assets",
    "/camox/content/collections/articles",
    "/camox/content/collections/articles/new",
    "/camox/content/collections/articles/a6479288-341f-4008-b118-dea6d8dd9158/edit",
    "/camox/canvas",
  ]) {
    const response = await handleCamoxRequest(
      new Request(`https://site.test/_camox/data?path=${encodeURIComponent(path)}`, {
        headers: { Cookie: "camox_auth_cookie=token%3Dtest" },
      }),
      options,
    );
    assert.equal(response?.status, 200);
    const input = (await response!.json()) as PageRenderInput;
    assert.equal(input.pathname, path);
    assert.equal(input.project?.name, "Real project");
    assert.equal(input.presentation, "studio");
    assert.ok(input.dehydratedState);
    assert.equal(response?.headers.get("Cache-Control"), "private, no-store");
    if (path === "/pokedex")
      assert.deepEqual(input.derived?.result, { kind: "data", data: { count: 12 } });
    if (path === "/about-camox") {
      assert.equal(input.derived?.layoutId, "about-camox");
      assert.equal(input.derived?.result, undefined);
    }
    if (path.startsWith("/pokemon/"))
      assert.deepEqual(input.derived?.result, { kind: "data", data: { name: "pikachu" } });
    if (path.startsWith("/camox/"))
      assert.equal(input.routeKind, path === "/camox/canvas" ? "studio-nested" : "studio-content");
    if (!path.startsWith("/camox/")) {
      assert.match(input.previewDocument!, /href="\/site.css"/);
      assert.match(input.previewDocument!, /class="dark"/);
      assert.match(input.previewDocument!, /site-content/);
      assert.doesNotMatch(input.previewDocument!, /studio.css|camox:studio:theme/);
    }

    const documentResponse = await handleCamoxRequest(
      new Request(`https://site.test${path}`, {
        headers: { Cookie: "camox_auth_cookie=token%3Dtest" },
      }),
      options,
    );
    const html = await documentResponse!.text();
    const hydration = JSON.parse(
      html.match(/<script id="__CAMOX_DATA__" type="application\/json">([\s\S]*?)<\/script>/)![1],
    ) as PageRenderInput;
    assert.deepEqual(
      hydration.derived,
      input.derived,
      "document and navigation carry the same envelope",
    );
    const head = html.split('<script id="__CAMOX_DATA__"')[0];
    assert.match(head, /href="\/studio.css"/);
    assert.match(head, /data-camox-studio/);
    assert.doesNotMatch(head, /site.css|siteTheme|class="dark"/);
    assert.ok(head.indexOf("camox:studio:theme") < head.indexOf('href="/studio.css"'));
    assert.ok(head.indexOf("camoxPlatform") >= 0);
    assert.ok(head.indexOf("camoxPlatform") < head.indexOf('href="/studio.css"'));
  }
  assert.ok(calls.includes("/rpc/layouts/get"));
});

void test("new unpublished curated pages load with native session cookies but stay private", async (t) => {
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith("/getBySlug")) return Response.json({ json: project });
    if (path.endsWith("/listBySlug")) return Response.json({ json: [] });
    if (path.endsWith("/getByPath")) {
      const { json: input } = (await request.json()) as { json: { source: string; path: string } };
      assert.equal(input.path, "/new-curated-page");
      if (input.source === "live")
        return Response.json(
          { json: { defined: false, code: "NOT_FOUND", status: 404, message: "Not published" } },
          { status: 404 },
        );
      assert.match(
        request.headers.get("Better-Auth-Cookie") ?? "",
        /^(?:__Secure-)?better-auth.session_token=valid$/,
      );
      return Response.json({
        json: {
          page: {
            id: 3,
            fullPath: input.path,
            pathSegment: "new-curated-page",
            status: "draft",
            livePublishedCheckpointId: null,
          },
          layout: null,
          project,
          projectName: project.name,
          blocks: [],
          files: [],
          repeatableItems: [],
        },
      });
    }
    throw new Error(`Unexpected API request ${path}`);
  });
  const options: RuntimeOptions = {
    apiUrl: "https://api.test",
    authenticationUrl: "https://auth.test",
    projectSlug: "test",
    renderPage: async (input) => `<main>${input.source} page</main>`,
  };
  for (const path of ["/new-curated-page", "/_camox/data?path=/new-curated-page"]) {
    const anonymous = await handleCamoxRequest(new Request(`https://site.test${path}`), options);
    assert.equal(anonymous?.status, 404);
    for (const cookie of [
      "better-auth.session_token=valid",
      "__Secure-better-auth.session_token=valid",
    ]) {
      const response = await handleCamoxRequest(
        new Request(`https://site.test${path}`, { headers: { Cookie: cookie } }),
        options,
      );
      assert.equal(response?.status, 200);
      assert.equal(response?.headers.get("Cache-Control"), "private, no-store");
      if (path.startsWith("/_camox/")) {
        const input = (await response!.json()) as PageRenderInput;
        assert.equal(input.source, "draft");
        assert.equal(input.presentation, "studio");
      } else {
        assert.match(await response!.text(), /draft page/);
      }
    }
  }
});

void test("sitemaps include published pages and singleton destinations with the runtime base path and no invented lastmod", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      json: [
        {
          id: 1,
          nickname: "About",
          fullPath: "/about",
          updatedAt: "2026-01-01",
          status: "published",
        },
        {
          id: 2,
          nickname: "Draft",
          fullPath: "/draft-only",
          updatedAt: "2026-01-01",
          status: "draft",
        },
      ],
    }),
  );
  const response = await handleCamoxRequest(new Request("https://site.test/site/sitemap.xml"), {
    apiUrl: "https://api.test",
    projectSlug: "test",
    runtimeBasePath: "/site",
    getCamoxApp: async () => app,
  });
  assert.equal(response?.status, 200);
  const xml = await response!.text();
  assert.match(xml, /https:\/\/site.test\/site\/pokedex/);
  assert.match(xml, /https:\/\/site.test\/site\/about-camox/);
  assert.match(xml, /https:\/\/site.test\/site\/about</);
  assert.equal(xml.match(/<lastmod>/g)?.length, 1);
  assert.doesNotMatch(xml, /pokemon|\$name/);
  assert.doesNotMatch(xml, /draft-only/);
});

void test("expired studio auth clears the mirrored cookie without granting chrome", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(
      { json: { defined: false, code: "UNAUTHORIZED", status: 401, message: "Session expired" } },
      { status: 401 },
    ),
  );
  const response = await handleCamoxRequest(
    new Request("https://site.test/_camox/data?path=/camox/content", {
      headers: { Cookie: "camox_auth_cookie=expired" },
    }),
    {
      apiUrl: "https://api.test",
      authenticationUrl: "https://auth.test",
      projectSlug: "test",
    },
  );
  assert.equal(((await response!.json()) as PageRenderInput).presentation, "public");
  assert.match(response!.headers.get("Set-Cookie")!, /Max-Age=0/);
  assert.equal(response!.headers.get("Cache-Control"), "private, no-store");
});

void test("anonymous studio navigation never validates a missing cookie or grants chrome", async (t) => {
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("Unexpected auth request");
  });
  const response = await handleCamoxRequest(
    new Request("https://site.test/_camox/data?path=/camox/content"),
    {
      apiUrl: "https://api.test",
      authenticationUrl: "https://auth.test",
      projectSlug: "test",
    },
  );
  const input = (await response!.json()) as PageRenderInput;
  assert.equal(input.presentation, "public");
  assert.equal(input.project, undefined);
});

void test("Block Catalog routes open the page app on the block, or redirect home", async (t) => {
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith("/getBySlug")) return Response.json({ json: project });
    throw new Error(`Unexpected API request ${path}`);
  });
  const blocks = [
    { _internal: { id: "hero", title: "Hero", layoutOnly: false } },
    { _internal: { id: "navbar", title: "Navbar", layoutOnly: true } },
  ];
  const options: RuntimeOptions = {
    apiUrl: "https://api.test",
    authenticationUrl: "https://auth.test",
    projectSlug: "test",
    runtimeBasePath: "/site",
    pageClientEntryUrl: "/page-client.js",
    studioClientEntryUrl: "/studio-client.js",
    stylesheetUrl: "/site.css",
    studioStylesheetUrl: "/studio.css",
    getCamoxApp: async () =>
      ({
        ...app,
        getBlockById: (id: string) => blocks.find((block) => block._internal.id === id),
      }) as unknown as CamoxApp,
    getDocument: async () => ({ htmlAttrs: { class: "dark" } }),
    renderPage: async (input) =>
      input.presentation === "public" ? "<main>Site content</main>" : "<nav>Studio</nav>",
  };
  const request = (path: string) =>
    handleCamoxRequest(
      new Request(`https://site.test/site${path}`, {
        headers: { Cookie: "camox_auth_cookie=token%3Dtest" },
      }),
      options,
    );

  await t.test("a block opens Edit Mode's page app with the block selected", async () => {
    const response = await request("/_camox/data?path=/camox/blocks/hero");
    assert.equal(response?.status, 200);
    assert.equal(response?.headers.get("Cache-Control"), "private, no-store");
    const input = (await response!.json()) as PageRenderInput;
    assert.deepEqual(input.catalogBlock, { blockId: "hero" });
    assert.equal(input.pathname, "/camox/blocks/hero");
    assert.equal(input.presentation, "studio");
    assert.equal(input.routeKind, undefined, "the Canvas stays mounted, not a Studio page");
    assert.ok(input.dehydratedState);
    assert.match(input.previewDocument!, /href="\/site.css"/, "block frames get the site head");
    assert.doesNotMatch(input.previewDocument!, /Site content/);

    const html = await (await request("/camox/blocks/hero"))!.text();
    assert.match(html, /page-client.js/);
    assert.doesNotMatch(html, /studio-client.js/);
    assert.match(html, /href="\/studio.css"/);
    assert.match(html, /<title>Hero<\/title>/);
  });

  for (const [name, path] of [
    ["an unknown block", "/camox/blocks/missing"],
    ["a Layout-only Block", "/camox/blocks/navbar"],
  ]) {
    await t.test(`${name} redirects home`, async () => {
      const response = await request(path);
      assert.equal(response?.status, 302);
      assert.equal(response?.headers.get("Location"), "https://site.test/site/");
      // Client navigation falls back to loading the document, which redirects.
      const data = await request(`/_camox/data?path=${path}`);
      assert.equal(data?.status, 404);
    });
  }
});

void test("public Markdown responses read the live page", async (t) => {
  const requested: Array<{ path: string; input: unknown }> = [];
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const path = new URL(request.url).pathname;
    requested.push({ path, input: ((await request.json()) as { json: unknown }).json });
    if (path.endsWith("/pages/getByPath")) return Response.json({ json: { page: { id: 7 } } });
    return Response.json({ json: { markdown: "# Live", blocks: [] } });
  });
  const response = await handleCamoxRequest(
    new Request("https://site.test/about", { headers: { Accept: "text/markdown" } }),
    { apiUrl: "https://api.test", projectSlug: "test" },
  );
  assert.equal(await response?.text(), "# Live");
  assert.deepEqual(
    requested.map(({ input }) => (input as { source?: string }).source),
    ["live", "live"],
  );
});

function appWithRoutes(routes: () => unknown) {
  const discovering = {
    _internal: { id: "pokemon.$name", kind: "derived", title: "Pokemon", routes },
  };
  return {
    getLayouts: () => [discovering],
    getLayoutById: (id: string) => (id === discovering._internal.id ? discovering : null),
  } as unknown as CamoxApp;
}

void test("sitemaps list the pages derived layouts discover, encoded and without lastmod", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ json: [] }));
  const response = await handleCamoxRequest(new Request("https://site.test/sitemap.xml"), {
    apiUrl: "https://api.test",
    projectSlug: "test",
    getCamoxApp: async () =>
      appWithRoutes(async () => ({
        data: [{ params: { name: "pikachu" } }, { params: { name: "mr mime" } }],
      })),
  });
  assert.equal(response?.status, 200);
  const xml = await response!.text();
  assert.match(xml, /<loc>https:\/\/site.test\/pokemon\/pikachu<\/loc>/);
  assert.match(xml, /<loc>https:\/\/site.test\/pokemon\/mr%20mime<\/loc>/);
  assert.doesNotMatch(xml, /<lastmod>/);
});

void test("sitemaps fail loudly when route discovery fails", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ json: [] }));
  t.mock.method(console, "error", () => {});
  for (const routes of [
    () => ({ data: [{ params: { name: "a/b" } }] }),
    async () => {
      throw new Error("PokéAPI is down");
    },
  ]) {
    const response = await handleCamoxRequest(new Request("https://site.test/sitemap.xml"), {
      apiUrl: "https://api.test",
      projectSlug: "test",
      getCamoxApp: async () => appWithRoutes(routes),
    });
    assert.equal(response?.status, 500);
    assert.match(((await response!.json()) as { message: string }).message, /pokemon|PokéAPI/);
  }
});

void test("the routes endpoint returns a derived layout's first discovered page", async () => {
  const request = (layoutId: string, routes: () => unknown) =>
    handleCamoxRequest(new Request(`https://site.test/_camox/routes?layoutId=${layoutId}`), {
      getCamoxApp: async () => appWithRoutes(routes),
    });
  const discovered = await request("pokemon.$name", () => ({
    data: [{ params: { name: "mr mime" } }, { params: { name: "pikachu" } }],
  }));
  assert.deepEqual(await discovered?.json(), { path: "/pokemon/mr%20mime" });
  const empty = await request("pokemon.$name", () => ({ data: [] }));
  assert.deepEqual(await empty?.json(), { path: null });
  const unknown = await request("pokedex", () => ({ data: [] }));
  assert.equal(unknown?.status, 404);
});
