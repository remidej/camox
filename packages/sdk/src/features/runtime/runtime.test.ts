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
        id: "pokemon.$name",
        kind: "derived",
        title: "Pokemon",
        loader: async ({ params }: { params: { name: string } }) => ({ name: params.name }),
      },
    },
  ],
  getLayoutById: () => null,
} as unknown as CamoxApp;

void test("runtime returns complete route payloads for curated, derived and studio navigation", async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const path = new URL(request.url).pathname;
    calls.push(path);
    if (path.endsWith("/getBySlug")) return Response.json({ json: project });
    if (path.endsWith("/listBySlug")) return Response.json({ json: [] });
    if (path.endsWith("/getByPath")) {
      const body = (await request.json()) as { json: { path: string } };
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
  for (const path of ["/about", "/pokemon/pikachu", "/camox/content"]) {
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
    if (path.startsWith("/pokemon/")) assert.deepEqual(input.derived?.data, { name: "pikachu" });
    if (path.startsWith("/camox/")) assert.equal(input.routeKind, "studio-content");
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
