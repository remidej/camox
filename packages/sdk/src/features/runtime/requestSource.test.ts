import assert from "node:assert/strict";
import { test } from "node:test";

import { createApp } from "../../core/createApp";
import { createLayout } from "../../core/createLayout";
import { getRecordLookup, type LayoutRequestContext } from "../../core/requestContext";
import { handleCamoxRequest, type PageRenderInput, type RuntimeOptions } from "./runtime";

/** The source the context's record lookup reads, as the API receives it. */
async function readSource(context: LayoutRequestContext) {
  const [entry] = await getRecordLookup(context).listPageValues({
    collectionId: "sources",
    field: "source",
  });
  return entry!.value;
}

const VALID_SESSION = "camox_auth_cookie=valid";
const EXPIRED_SESSION = "camox_auth_cookie=expired";

const layoutOptions = {
  description: "",
  blocks: { before: [], after: [] },
  component: () => null,
};

/** Layouts whose loader and routes report the source of the context they receive. */
function sourceReportingApp() {
  const pokemon = createLayout("pokemon.$name")({
    ...layoutOptions,
    title: "Pokémon",
    kind: "derived",
    loader: async ({ params, context }) => ({
      kind: "data",
      data: { name: params.name, source: await readSource(context) },
    }),
    routes: async ({ context }) => ({ data: [{ params: { name: await readSource(context) } }] }),
    toMarkdown: ({ data }) => [`# ${data.name} read ${data.source}`],
    buildMetaTitle: ({ data }) => `Read ${data.source}`,
  });
  const pokedex = createLayout("pokedex")({
    ...layoutOptions,
    title: "Pokédex",
    kind: "singleton",
    loader: async ({ context }) => ({ kind: "data", data: { source: await readSource(context) } }),
    toMarkdown: ({ data }) => [`# Pokédex read ${data.source}`],
    buildMetaTitle: ({ data }) => `Read ${data.source}`,
  });
  return createApp({ blocks: [], layouts: [pokemon, pokedex] });
}

/** An API where only the valid session can read drafts. */
function mockApi(t: { mock: { method: typeof test.mock.method } }) {
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const url = new URL(request.url);
    const session = request.headers.get("Better-Auth-Cookie");
    if (session && session !== "valid")
      return Response.json(
        { json: { defined: false, code: "UNAUTHORIZED", status: 401, message: "Session expired" } },
        { status: 401 },
      );
    if (url.pathname.endsWith("/getBySlug"))
      return Response.json({ json: { id: 1, name: "Real project", slug: "test", updatedAt: 1 } });
    if (url.pathname.endsWith("/listBySlug")) return Response.json({ json: [] });
    if (url.pathname.endsWith("/getByPath"))
      return Response.json(
        { json: { defined: false, code: "NOT_FOUND", status: 404, message: "Not found" } },
        { status: 404 },
      );
    if (url.pathname.endsWith("/collectionDefinitions/listRecordPageValues")) {
      // Reports the source each lookup asked for, so layouts can show it.
      const { json: input } = (await request.json()) as { json: { source: string } };
      return Response.json({ json: [{ id: input.source, value: input.source }] });
    }
    if (url.pathname.endsWith("/getLayoutMarkdown"))
      return Response.json({ json: { before: "", after: "" } });
    if (url.pathname.endsWith("/layouts/get"))
      return Response.json({
        json: {
          projectName: "Real project",
          project: { id: 1, updatedAt: 1 },
          layout: { id: 2, layoutId: "pokemon.$name", beforeBlockIds: [], afterBlockIds: [] },
          blocks: [],
          files: [],
          repeatableItems: [],
        },
      });
    throw new Error(`Unexpected request: ${url}`);
  });
}

const runtimeOptions: RuntimeOptions = {
  apiUrl: "https://api.test",
  authenticationUrl: "https://auth.test",
  projectSlug: "test",
  getCamoxApp: async () => sourceReportingApp(),
  renderPage: async (input) => `<main>${JSON.stringify(input.derived?.result?.data)}</main>`,
};

function request(path: string, init: { cookie?: string; accept?: string } = {}) {
  const headers: Record<string, string> = {};
  if (init.cookie) headers.Cookie = init.cookie;
  if (init.accept) headers.Accept = init.accept;
  return handleCamoxRequest(new Request(`https://site.test${path}`, { headers }), runtimeOptions);
}

void test("page HTML and data load with the editor's source", async (t) => {
  mockApi(t);
  for (const path of ["/pokemon/pikachu", "/pokedex"]) {
    for (const [cookie, expected] of [
      [VALID_SESSION, "draft"],
      [undefined, "live"],
      [EXPIRED_SESSION, "live"],
    ] as const) {
      const html = await request(path, { cookie });
      assert.match(
        await html!.text(),
        new RegExp(`<main>[^<]*"source":"${expected}"`),
        `${path} ${cookie}`,
      );
      const data = await request(`/_camox/data?path=${path}`, { cookie });
      const input = (await data!.json()) as PageRenderInput;
      assert.equal(input.source, expected);
      assert.equal(
        (input.derived!.result!.data as { source: string }).source,
        expected,
        `${path} ${cookie}`,
      );
      if (cookie === EXPIRED_SESSION) assert.match(data!.headers.get("Set-Cookie")!, /Max-Age=0/);
    }
  }
});

void test("Markdown and the sitemap read live content even for an editor", async (t) => {
  mockApi(t);
  const derived = await request("/pokemon/pikachu", {
    cookie: VALID_SESSION,
    accept: "text/markdown",
  });
  assert.equal(await derived!.text(), "# pikachu read live");
  const singleton = await request("/pokedex", { cookie: VALID_SESSION, accept: "text/markdown" });
  assert.equal(await singleton!.text(), "# Pokédex read live");
  const sitemap = await request("/sitemap.xml", { cookie: VALID_SESSION });
  const xml = await sitemap!.text();
  assert.match(xml, /<loc>https:\/\/site.test\/pokemon\/live<\/loc>/);
  assert.doesNotMatch(xml, /draft/);
});

void test("the routes endpoint discovers pages with the editor's source", async (t) => {
  mockApi(t);
  for (const [cookie, expected] of [
    [VALID_SESSION, "draft"],
    [undefined, "live"],
    [EXPIRED_SESSION, "live"],
  ] as const) {
    const response = await request("/_camox/routes?layoutId=pokemon.$name", { cookie });
    assert.deepEqual(await response!.json(), { path: `/pokemon/${expected}` }, String(cookie));
    if (cookie === EXPIRED_SESSION) assert.match(response!.headers.get("Set-Cookie")!, /Max-Age=0/);
  }
});
