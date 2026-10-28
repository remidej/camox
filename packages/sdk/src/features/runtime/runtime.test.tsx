import assert from "node:assert/strict";
import { test } from "node:test";

import type { CamoxApp } from "../../core/createApp";
import {
  localesResponse,
  markdownBody,
  pageListResponse,
  pageMarkdownResponse,
} from "./api.fixtures";
import {
  handleCamoxRequest,
  isPublicRequest,
  type PageRenderInput,
  type RuntimeOptions,
} from "./runtime";

const project = { id: "1", name: "Real project", slug: "test", updatedAt: "2026-01-01" };
const layout = {
  id: "2",
  layoutId: "pokemon.$name",
  beforeBlockIds: [],
  afterBlockIds: [],
  updatedAt: "2026-01-01",
};
/** The `toTitle`, `toDescription` and `toStructuredData` a layout gets by default. */
const meta = {
  toTitle: ({ page }: { page: { title: string } }) => page.title,
  toDescription: ({ page }: { page: { description?: string } }) => page.description,
  toStructuredData: () => undefined,
};
const app = {
  getLayouts: () => [
    {
      _internal: {
        id: "pokedex",
        kind: "singleton",
        title: "Pokédex",
        ...meta,
        loader: async () => ({ kind: "data", data: { count: 12 } }),
      },
    },
    { _internal: { id: "about-camox", kind: "singleton", title: "About Camox", ...meta } },
    {
      _internal: {
        id: "pokemon.$name",
        kind: "derived",
        title: "Pokemon",
        ...meta,
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
      projectUuid: "test",
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

void test("a studio sign-in's token is exchanged by the Worker, which redirects signed in", async (t) => {
  const verifications: { url: string; cookieHeader: string | null; body: unknown }[] = [];
  let refuse = false;
  // The exchange passes its URL as a string and its body as JSON. Content reads pass a Request.
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string | Request, init: RequestInit & { body: string }) => {
      if (typeof url !== "string") throw new Error("Content read");
      verifications.push({
        url,
        cookieHeader: new Headers(init.headers).get("Better-Auth-Cookie"),
        body: JSON.parse(init.body),
      });
      if (refuse) return Response.json({ message: "Invalid token" }, { status: 400 });
      return Response.json(
        { session: { token: "session" }, user: { id: "user" } },
        {
          headers: {
            "Set-Better-Auth-Cookie":
              "__Secure-better-auth.session_token=session.signature; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax",
          },
        },
      );
    },
  );
  let rendered = 0;
  const options: RuntimeOptions = {
    apiUrl: "https://api.test/",
    authenticationUrl: "https://auth.test",
    projectUuid: "test",
    renderPage: async () => {
      rendered++;
      return "";
    },
  };
  const signIn = new Request("https://site.test/about?camox-draft=draft&ott=token");
  assert.equal(isPublicRequest(signIn, options), false, "no shared cache keeps the redirect");

  const response = await handleCamoxRequest(signIn, options);
  assert.deepEqual(verifications, [
    {
      url: "https://api.test/api/auth/one-time-token/verify",
      cookieHeader: "",
      body: { token: "token" },
    },
  ]);
  assert.equal(response?.status, 302);
  assert.equal(response?.headers.get("Location"), "/about?camox-draft=draft");
  assert.equal(response?.headers.get("Cache-Control"), "private, no-store");
  const setCookie = response?.headers.get("Set-Cookie") ?? "";
  assert.match(
    setCookie,
    /^camox_auth_cookie=__Secure-better-auth.session_token%3Dsession.signature; Path=\/; /,
  );
  assert.match(setCookie, /; Secure$/);
  assert.equal(rendered, 0, "the page renders after the redirect, for the member");

  // A token the API refuses leaves the page to the browser, which says why it can't sign in.
  refuse = true;
  await assert.rejects(
    handleCamoxRequest(new Request("https://site.test/about?ott=used"), options),
    /Content read/,
  );
  assert.equal(verifications.length, 2);
});

void test("runtime returns complete route payloads for curated, singleton, derived and studio navigation", async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    if (new URL(request.url).pathname.endsWith("/locales/list")) return localesResponse();
    const path = new URL(request.url).pathname;
    calls.push(path);
    if (path.endsWith("/getByUuid")) return Response.json({ json: project });
    if (path.endsWith("/listBySlug")) return pageListResponse();
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
    projectUuid: "test",
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
    "/camox/unknown",
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
        path === "/camox/settings"
          ? "studio-settings"
          : path === "/camox/unknown"
            ? "studio-nested"
            : "studio-content",
      );
    if (!path.startsWith("/camox/")) {
      assert.match(input.previewDocument!, /href="\/site.css"/);
      assert.match(input.previewDocument!, /class="dark"/);
      // The renderer frame renders the page into it: the studio renders none.
      assert.doesNotMatch(input.previewDocument!, /site-content/);
      assert.match(input.previewDocument!, /<div id="root" data-camox-preview-root><\/div>/);
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

void test("visitors and members load the same curated page, and only members with a studio session get the Studio", async (t) => {
  const pageReads: Array<string | null> = [];
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    if (new URL(request.url).pathname.endsWith("/locales/list")) return localesResponse();
    const path = new URL(request.url).pathname;
    if (path.endsWith("/getByUuid")) {
      assert.match(
        request.headers.get("Better-Auth-Cookie") ?? "",
        /^(?:__Secure-)?better-auth.session_token=valid$/,
      );
      return Response.json({ json: project });
    }
    if (path.endsWith("/listBySlug")) return pageListResponse();
    if (path.endsWith("/getByPath")) {
      const { json: input } = (await request.json()) as { json: { path: string } };
      assert.deepEqual(input, { path: "/new-curated-page", projectUuid: "test" });
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
    projectUuid: "test",
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
      `camox_auth_cookie=${encodeURIComponent("better-auth.session_token=valid")}`,
      `camox_auth_cookie=${encodeURIComponent("__Secure-better-auth.session_token=valid")}`,
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
  t.mock.method(globalThis, "fetch", async (request: Request) =>
    request.url.endsWith("/locales/list")
      ? localesResponse()
      : pageListResponse([
          { id: "1", nickname: "About", fullPath: "/about", updatedAt: "2026-01-01" },
          { id: "2", nickname: "Contact", fullPath: "/contact", updatedAt: "2026-01-02" },
        ]),
  );
  const response = await handleCamoxRequest(new Request("https://site.test/site/sitemap.xml"), {
    apiUrl: "https://api.test",
    projectUuid: "test",
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
  t.mock.method(globalThis, "fetch", async (request: Request) =>
    new URL(request.url).pathname.endsWith("/locales/list")
      ? localesResponse()
      : Response.json(
          {
            json: { defined: false, code: "UNAUTHORIZED", status: 401, message: "Session expired" },
          },
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
      projectUuid: "test",
    },
  );
  assert.equal(((await response!.json()) as PageRenderInput).presentation, "public");
  assert.match(response!.headers.get("Set-Cookie")!, /Max-Age=0/);
  assert.equal(response!.headers.get("Cache-Control"), "private, no-store");
});

void test("anonymous studio navigation never validates a missing cookie or grants chrome", async (t) => {
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    // Live's locales are public.
    if (new URL(request.url).pathname.endsWith("/locales/list")) return localesResponse();
    throw new Error("Unexpected auth request");
  });
  const response = await handleCamoxRequest(
    new Request("https://site.test/_camox/data?path=/camox/content"),
    {
      apiUrl: "https://api.test",
      authenticationUrl: "https://auth.test",
      projectUuid: "test",
    },
  );
  const input = (await response!.json()) as PageRenderInput;
  assert.equal(input.presentation, "public");
  assert.equal(input.project, undefined);
});

void test("the Canvas route opens the page app with nothing selected", async (t) => {
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    if (new URL(request.url).pathname.endsWith("/locales/list")) return localesResponse();
    const path = new URL(request.url).pathname;
    if (path.endsWith("/getByUuid")) return Response.json({ json: project });
    throw new Error(`Unexpected API request ${path}`);
  });
  const options: RuntimeOptions = {
    apiUrl: "https://api.test",
    authenticationUrl: "https://auth.test",
    projectUuid: "test",
    runtimeBasePath: "/site",
    pageClientEntryUrl: "/page-client.js",
    studioClientEntryUrl: "/studio-client.js",
    stylesheetUrl: "/site.css",
    studioStylesheetUrl: "/studio.css",
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

  await t.test("the Canvas opens its page app with nothing selected", async () => {
    const response = await request("/_camox/data?path=/camox/canvas");
    assert.equal(response?.status, 200);
    const input = (await response!.json()) as PageRenderInput;
    assert.equal(input.canvasOnly, true);
    assert.equal(input.pathname, "/camox/canvas");
    assert.equal(input.presentation, "studio");
    assert.equal(input.routeKind, undefined, "the Canvas stays mounted, not a Studio page");

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
    assert.equal(
      await draft("/_camox/data?path=/camox/canvas&camox-draft=spring", {}, false),
      undefined,
      "anyone else sees Live",
    );
  });
});

void test("a curated page's Markdown is one read of the API, without a session", async (t) => {
  const requested: Array<{ path: string; input: unknown; session: string | null }> = [];
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    requested.push({
      path: new URL(request.url).pathname,
      input: ((await request.clone().json()) as { json: unknown }).json,
      session: request.headers.get("Better-Auth-Cookie"),
    });
    return pageMarkdownResponse(request, {
      tags: ["en", "fr"],
      pageAt: ({ path }) =>
        path === "/about" ? { page: { id: "7", fullPath: "/about" }, markdown: "# About" } : null,
    });
  });
  const response = await handleCamoxRequest(
    new Request("https://site.test/fr/about", {
      headers: { Accept: "text/markdown", Cookie: "camox_auth_cookie=valid" },
    }),
    { apiUrl: "https://api.test", projectUuid: "test" },
  );
  assert.equal(markdownBody(await response!.text()), "# About");
  // The API finds the path's locale itself: nothing reads the locales first.
  assert.deepEqual(requested, [
    {
      path: "/rpc/pages/getMarkdown",
      input: { path: "/fr/about", projectUuid: "test" },
      session: null,
    },
  ]);
});

void test("a page's .md URL serves its Markdown whatever the request accepts", async (t) => {
  const requestedPaths: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (request: Request) =>
    pageMarkdownResponse(request, {
      pageAt: ({ path }) => {
        requestedPaths.push(path);
        return path === "/missing" ? null : { page: { id: "7" }, markdown: "# Page" };
      },
    }),
  );
  const request = (path: string) =>
    handleCamoxRequest(new Request(`https://site.test${path}`, { headers: { Accept: "*/*" } }), {
      apiUrl: "https://api.test",
      projectUuid: "test",
    });

  for (const path of ["/index.md", "/blog/post.md"]) {
    const response = await request(path);
    assert.equal(response?.headers.get("Content-Type"), "text/markdown; charset=utf-8");
    assert.equal(markdownBody(await response!.text()), "# Page");
  }
  assert.deepEqual(requestedPaths, ["/", "/blog/post"]);
  assert.equal((await request("/missing.md"))?.status, 404);
});

void test("a curated page's Markdown opens with its head's title and description, and its URL", async (t) => {
  t.mock.method(globalThis, "fetch", async (request: Request) =>
    pageMarkdownResponse(request, {
      pageAt: () => ({
        page: {
          id: "7",
          fullPath: "/blog/post",
          pathSegment: "post",
          metaTitle: 'Say "hi"\nto Camox',
          metaDescription: "A post",
        },
        layout: { layoutId: "post" },
        projectName: "Real project",
        markdown: "# Post",
      }),
    }),
  );
  const postLayout = {
    _internal: {
      id: "post",
      toTitle: ({ page, project }: { page: { title: string }; project: { name: string } }) =>
        `${page.title} | ${project.name}`,
      toDescription: ({ page }: { page: { description: string } }) => `${page.description}, by us`,
    },
  };
  const response = await handleCamoxRequest(new Request("https://site.test/blog/post.md"), {
    apiUrl: "https://api.test",
    projectUuid: "test",
    getCamoxApp: async () =>
      ({
        getLayouts: () => [],
        getLayoutById: (id: string) => (id === "post" ? postLayout : undefined),
      }) as unknown as CamoxApp,
  });
  assert.equal(
    await response!.text(),
    [
      "---",
      // Quoted, so any title stays a single YAML value.
      'title: "Say \\"hi\\"\\nto Camox | Real project"',
      'description: "A post, by us"',
      'url: "https://site.test/blog/post"',
      "---",
      "",
      "# Post",
    ].join("\n"),
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
  t.mock.method(globalThis, "fetch", async (request: Request) =>
    request.url.endsWith("/locales/list") ? localesResponse() : pageListResponse(),
  );
  const response = await handleCamoxRequest(new Request("https://site.test/sitemap.xml"), {
    apiUrl: "https://api.test",
    projectUuid: "test",
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
  t.mock.method(globalThis, "fetch", async (request: Request) =>
    request.url.endsWith("/locales/list") ? localesResponse() : pageListResponse(),
  );
  t.mock.method(console, "error", () => {});
  for (const routes of [
    () => ({ data: [{ params: { name: "a/b" } }] }),
    async () => {
      throw new Error("PokéAPI is down");
    },
  ]) {
    const response = await handleCamoxRequest(new Request("https://site.test/sitemap.xml"), {
      apiUrl: "https://api.test",
      projectUuid: "test",
      getCamoxApp: async () => appWithRoutes(routes),
    });
    assert.equal(response?.status, 500);
    assert.match(((await response!.json()) as { message: string }).message, /pokemon|PokéAPI/);
  }
});

void test("sitemaps fail loudly when Live's locales or pages can't be read", async (t) => {
  const unavailable = () =>
    Response.json(
      { json: { defined: false, code: "INTERNAL_SERVER_ERROR", status: 500, message: "Down" } },
      { status: 500 },
    );
  t.mock.method(console, "error", () => {});
  for (const failing of ["/locales/list", "/listBySlug"]) {
    t.mock.method(globalThis, "fetch", async (request: Request) =>
      request.url.endsWith(failing)
        ? unavailable()
        : request.url.endsWith("/locales/list")
          ? localesResponse(["en", "de"])
          : pageListResponse(),
    );
    const response = await handleCamoxRequest(new Request("https://site.test/sitemap.xml"), {
      apiUrl: "https://api.test",
      projectUuid: "test",
    });
    assert.equal(response?.status, 500, failing);
    assert.match(((await response!.json()) as { message: string }).message, /sitemap/);
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
    projectUuid: "test",
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
    if (new URL(request.url).pathname.endsWith("/locales/list")) return localesResponse();
    const path = new URL(request.url).pathname;
    if (path.endsWith("/listBySlug")) return pageListResponse();
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

void test("the renderer document loads the renderer's client, privately, without reading anything", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("The renderer reads its pages itself, once loaded");
  });
  const options: RuntimeOptions = {
    apiUrl: "https://api.test",
    authenticationUrl: "https://auth.test",
    projectUuid: "test",
    runtimeBasePath: "/site",
    rendererClientEntryUrl: "/_chunks/camox-renderer-client.mjs",
  };
  const response = await handleCamoxRequest(
    new Request("https://site.test/site/_camox/renderer?camox-draft=spring"),
    options,
  );
  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get("Cache-Control"), "private, no-store");
  assert.match(response!.headers.get("Content-Type")!, /^text\/html/);
  const html = await response!.text();
  assert.match(
    html,
    /<script type="module" src="\/_chunks\/camox-renderer-client\.mjs"><\/script>/,
  );
  const data = html.match(/<script id="__CAMOX_DATA__" type="application\/json">(.*?)<\/script>/);
  assert.deepEqual(JSON.parse(data![1]!), {
    apiUrl: "https://api.test",
    authenticationUrl: "https://auth.test",
    projectUuid: "test",
    runtimeBasePath: "/site",
  });
  assert.equal(
    isPublicRequest(new Request("https://site.test/site/_camox/renderer"), options),
    false,
    "no shared cache keeps it",
  );
});

void test("a runtime without an API or project says which of its routes it can't serve, reading nothing", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("An unconfigured runtime has no API to read");
  });
  const unconfigured: RuntimeOptions = {
    authenticationUrl: "https://auth.test",
    renderPage: async () => "",
    renderStudio: async () => "",
  };
  const answer = async (url: string) => {
    const response = await handleCamoxRequest(new Request(url), unconfigured);
    return { status: response?.status, body: (await response!.json()) as Record<string, string> };
  };

  for (const url of [
    "https://site.test/camox/content",
    "https://site.test/_camox/data?path=/camox/content",
  ]) {
    const { status, body } = await answer(url);
    assert.equal(status, 500);
    assert.match(body.message!, /Studio renderer is not configured/);
    assert.equal(body.kind, "studio-content");
    assert.equal(body.pathname, "/camox/content");
  }
  for (const url of ["https://site.test/about", "https://site.test/_camox/data?path=/about"]) {
    const { status, body } = await answer(url);
    assert.equal(status, 500);
    assert.match(body.message!, /page loader is not configured/);
  }
});
