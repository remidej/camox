import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToString } from "react-dom/server";

import type { CamoxApp } from "../../core/createApp";
import { artifactFrameProps } from "../../core/lib/artifact";
import { handleCamoxRequest, type PageRenderInput, type RuntimeOptions } from "./runtime";

const project = { id: "1", name: "Real project", slug: "test", updatedAt: "2026-01-01" };
const layout = {
  id: "2",
  layoutId: "pokemon.$name",
  beforeBlockIds: [],
  afterBlockIds: [],
  updatedAt: "2026-01-01",
};
const buildMetaTitle = ({ pageMetaTitle }: { pageMetaTitle: string }) => pageMetaTitle;
const app = {
  getLayouts: () => [
    {
      _internal: {
        id: "pokedex",
        kind: "singleton",
        title: "Pokédex",
        buildMetaTitle,
        loader: async () => ({ kind: "data", data: { count: 12 } }),
      },
    },
    { _internal: { id: "about-camox", kind: "singleton", title: "About Camox", buildMetaTitle } },
    {
      _internal: {
        id: "pokemon.$name",
        kind: "derived",
        title: "Pokemon",
        buildMetaTitle,
        loader: async ({ params }: { params: { name: string } }) => ({
          kind: "data",
          data: { name: params.name },
        }),
      },
    },
  ],
  getLayoutById: () => null,
} as unknown as CamoxApp;

void test("preview authenticates before loading the page", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("No content requests should precede the token exchange");
  });
  const response = await handleCamoxRequest(
    new Request("http://localhost:3000/new-page?camox-preview=target&ott=token"),
    {
      apiUrl: "https://api.test",
      authenticationUrl: "https://auth.test",
      projectSlug: "test",
      pageClientEntryUrl: "/client.js",
      renderPage: async (input) => {
        assert.equal(input.previewHandoff, true);
        assert.equal(input.pathname, "/new-page");
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
          page: { id: "1", fullPath: body.json.path, pathSegment: "about" },
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
      return Response.json({
        json: {
          projectName: project.name,
          project,
          layout,
          blocks: [],
          files: [],
          repeatableItems: [],
        },
      });
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
    "/camox/settings",
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
      assert.equal(
        input.routeKind,
        path === "/camox/settings" ? "studio-nested" : "studio-content",
      );
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
    // Curated pages always have Markdown; layouts only when they declare toMarkdown.
    if (path === "/about")
      assert.match(head, /<link[^>]*rel="alternate"[^>]*href="https:\/\/site.test\/about.md"/);
    if (path === "/pokemon/pikachu") assert.doesNotMatch(head, /rel="alternate"/);
  }
  assert.ok(calls.includes("/rpc/layouts/get"));
});

void test("visitors and members load the same curated page, and only members with native session cookies get the Studio", async (t) => {
  const pageReads: Array<string | null> = [];
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith("/getBySlug")) {
      assert.match(
        request.headers.get("Better-Auth-Cookie") ?? "",
        /^(?:__Secure-)?better-auth.session_token=valid$/,
      );
      return Response.json({ json: project });
    }
    if (path.endsWith("/listBySlug")) return Response.json({ json: [] });
    if (path.endsWith("/getByPath")) {
      const { json: input } = (await request.json()) as { json: { path: string } };
      assert.deepEqual(input, { path: "/new-curated-page", projectSlug: "test" });
      pageReads.push(request.headers.get("Better-Auth-Cookie"));
      return Response.json({
        json: {
          page: { id: "3", fullPath: input.path, pathSegment: "new-curated-page" },
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
    renderPage: async (input) =>
      `<main>${input.loaderData ? "Page" : "No"} for ${input.presentation}</main>`,
  };
  for (const path of ["/new-curated-page", "/_camox/data?path=/new-curated-page"]) {
    const anonymous = await handleCamoxRequest(new Request(`https://site.test${path}`), options);
    assert.equal(anonymous?.status, 200);
    if (path.startsWith("/_camox/")) {
      assert.equal(((await anonymous!.json()) as PageRenderInput).presentation, "public");
    } else {
      assert.equal(anonymous?.headers.get("Cache-Control"), null);
      assert.match(await anonymous!.text(), /Page for public/);
    }
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
        assert.equal(input.presentation, "studio");
        assert.equal(input.project?.name, project.name);
      } else {
        assert.match(await response!.text(), /Page for studio/);
      }
    }
  }
  // Members read with their session, so linked records resolve their saved drafts.
  assert.deepEqual(pageReads.map(Boolean), [false, true, true, false, true, true]);
});

void test("sitemaps include curated pages and singleton destinations with the runtime base path and no invented lastmod", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      json: [
        { id: "1", nickname: "About", fullPath: "/about", updatedAt: "2026-01-01" },
        { id: "2", nickname: "Contact", fullPath: "/contact", updatedAt: "2026-01-02" },
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
  assert.match(xml, /https:\/\/site.test\/site\/contact</);
  assert.equal(xml.match(/<lastmod>/g)?.length, 2);
  assert.doesNotMatch(xml, /pokemon|\$name/);
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

void test("Canvas-only routes open the page app on the Canvas or a block, or redirect home", async (t) => {
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
    assert.deepEqual(input.canvasOnly, { blockId: "hero" });
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

  await t.test("the Canvas opens Edit Mode's page app with nothing selected", async () => {
    const response = await request("/_camox/data?path=/camox/canvas");
    assert.equal(response?.status, 200);
    const input = (await response!.json()) as PageRenderInput;
    assert.deepEqual(input.canvasOnly, {});
    assert.equal(input.pathname, "/camox/canvas");
    assert.equal(input.presentation, "studio");
    assert.equal(input.routeKind, undefined, "the Canvas stays mounted, not a Studio page");
    assert.match(input.previewDocument!, /href="\/site.css"/, "block frames get the site head");

    const html = await (await request("/camox/canvas"))!.text();
    assert.match(html, /page-client.js/);
    assert.doesNotMatch(html, /studio-client.js/);
    assert.match(html, /<title>Canvas<\/title>/);
  });

  // Navigation remounts the whole studio when the draft changes, so it must
  // see the same draft as the Page it leaves.
  await t.test("the Canvas keeps the draft a member's request names", async () => {
    const draft = async (path: string, runtime: Partial<RuntimeOptions> = {}, cookie = true) => {
      const response = await handleCamoxRequest(
        new Request(`https://site.test/site${path}`, {
          headers: cookie ? { Cookie: "camox_auth_cookie=token%3Dtest" } : {},
        }),
        { ...options, ...runtime },
      );
      return ((await response!.json()) as PageRenderInput).draftId;
    };
    assert.equal(await draft("/_camox/data?path=/camox/canvas"), undefined, "Live");
    assert.equal(await draft("/_camox/data?path=/camox/canvas&camox-draft=spring"), "spring");
    assert.equal(await draft("/_camox/data?path=/camox/blocks/hero&camox-draft=spring"), "spring");
    assert.equal(
      await draft("/_camox/data?path=/camox/canvas", { developmentDraft: true }),
      "development",
    );
    assert.equal(
      await draft("/_camox/data?path=/camox/canvas&camox-draft=spring", {}, false),
      undefined,
      "anyone else sees Live",
    );
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

void test("public Markdown responses read the page without a session", async (t) => {
  const requested: Array<{ path: string; input: unknown; session: string | null }> = [];
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const path = new URL(request.url).pathname;
    requested.push({
      path,
      input: ((await request.json()) as { json: unknown }).json,
      session: request.headers.get("Better-Auth-Cookie"),
    });
    if (path.endsWith("/pages/getByPath")) return Response.json({ json: { page: { id: "7" } } });
    return Response.json({ json: { markdown: "# About", blocks: [] } });
  });
  const response = await handleCamoxRequest(
    new Request("https://site.test/about", {
      headers: { Accept: "text/markdown", Cookie: "better-auth.session_token=valid" },
    }),
    { apiUrl: "https://api.test", projectSlug: "test" },
  );
  assert.equal(await response?.text(), "# About");
  assert.deepEqual(requested, [
    {
      path: "/rpc/pages/getByPath",
      input: { path: "/about", projectSlug: "test" },
      session: null,
    },
    { path: "/rpc/blocks/getPageMarkdown", input: { pageId: "7" }, session: null },
  ]);
});

void test("a page's .md URL serves its Markdown whatever the request accepts", async (t) => {
  const requestedPaths: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith("/pages/getByPath")) {
      const { json } = (await request.json()) as { json: { path: string } };
      requestedPaths.push(json.path);
      if (json.path === "/missing")
        return Response.json(
          { json: { defined: false, code: "NOT_FOUND", status: 404, message: "Not found" } },
          { status: 404 },
        );
      return Response.json({ json: { page: { id: "7" } } });
    }
    return Response.json({ json: { markdown: "# Page", blocks: [] } });
  });
  const request = (path: string) =>
    handleCamoxRequest(new Request(`https://site.test${path}`, { headers: { Accept: "*/*" } }), {
      apiUrl: "https://api.test",
      projectSlug: "test",
    });

  for (const path of ["/index.md", "/blog/post.md"]) {
    const response = await request(path);
    assert.equal(response?.headers.get("Content-Type"), "text/markdown; charset=utf-8");
    assert.equal(await response?.text(), "# Page");
  }
  assert.deepEqual(requestedPaths, ["/", "/blog/post"]);
  assert.equal((await request("/missing.md"))?.status, 404);
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

async function renderPageWithBlocks(chunks: Record<string, string[]> | null) {
  const response = await handleCamoxRequest(new Request("http://localhost:3000/about"), {
    apiUrl: "https://api.test",
    authenticationUrl: "https://auth.test",
    projectSlug: "test",
    pageClientEntryUrl: "/client.js",
    getCamoxApp: async () => app,
    renderPage: async () => "<main>Site content</main>",
    blockPreloads: {
      modulePaths: {
        hero: "/src/blocks/hero.tsx",
        faq: "/src/blocks/faq.tsx",
        footer: "/src/blocks/footer.tsx",
      },
      chunks,
    },
  });
  assert.equal(response?.status, 200);
  return response!.text();
}

function mockPageWithBlocks(
  t: { mock: { method: typeof import("node:test").mock.method } },
  types: string[],
) {
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith("/listBySlug")) return Response.json({ json: [] });
    if (path.endsWith("/getByPath"))
      return Response.json({
        json: {
          page: { id: "1", fullPath: "/about", pathSegment: "about", status: "published" },
          layout: null,
          project,
          projectName: project.name,
          blocks: types.map((type, index) => ({
            id: `block-${index}`,
            type,
            content: {},
            settings: {},
            position: "a",
          })),
          files: [],
          repeatableItems: [],
        },
      });
    throw new Error(`Unexpected API request ${path}`);
  });
}

function modulePreloads(html: string) {
  return [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((match) => match[1]);
}

void test("a page preloads the built chunks of the blocks it renders, and only those", async (t) => {
  mockPageWithBlocks(t, ["hero", "faq", "hero"]);
  const html = await renderPageWithBlocks({
    "/src/blocks/hero.tsx": ["_chunks/hero-1.mjs", "_chunks/shaders-2.mjs"],
    "/src/blocks/faq.tsx": ["_chunks/faq-3.mjs", "_chunks/shaders-2.mjs"],
    "/src/blocks/footer.tsx": ["_chunks/footer-4.mjs"],
  });

  assert.deepEqual(modulePreloads(html).sort(), [
    "/_chunks/faq-3.mjs",
    "/_chunks/hero-1.mjs",
    "/_chunks/shaders-2.mjs",
  ]);
});

void test("in dev, a page preloads its blocks' modules", async (t) => {
  mockPageWithBlocks(t, ["hero"]);
  const html = await renderPageWithBlocks(null);

  assert.deepEqual(modulePreloads(html), ["/src/blocks/hero.tsx"]);
});

void test("a public page's hydration data leaves out the artifact sources its frames hold", async (t) => {
  const source = "<!doctype html><title>Orbit diagram</title><svg></svg>";
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith("/listBySlug")) return Response.json({ json: [] });
    if (path.endsWith("/getByPath"))
      return Response.json({
        json: {
          page: { id: "1", fullPath: "/about", pathSegment: "about", status: "published" },
          layout: null,
          project,
          projectName: project.name,
          blocks: [
            { id: 1, type: "hero", content: { visual: source }, settings: {}, position: "a" },
          ],
          files: [],
          repeatableItems: [],
        },
      });
    throw new Error(`Unexpected API request ${path}`);
  });
  const response = await handleCamoxRequest(new Request("http://localhost:3000/about"), {
    apiUrl: "https://api.test",
    authenticationUrl: "https://auth.test",
    projectSlug: "test",
    pageClientEntryUrl: "/client.js",
    getCamoxApp: async () => app,
    renderPage: async () => renderToString(<iframe {...artifactFrameProps(source)} />),
  });
  const html = await response!.text();
  const [head, body] = html.split("</head>");

  assert.ok(body.includes("Orbit diagram"));
  assert.ok(!head.includes("Orbit diagram"));
  assert.ok(head.includes("camox-artifact-source"));
});
