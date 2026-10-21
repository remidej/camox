import assert from "node:assert/strict";
import { test } from "node:test";

import { createApp } from "../../core/createApp";
import { createLayout } from "../../core/createLayout";
import { getRecordLookup, type LayoutRequestContext } from "../../core/requestContext";
import { localesResponse, markdownBody, pageListResponse } from "./api.fixtures";
import { handleCamoxRequest, type PageRenderInput, type RuntimeOptions } from "./runtime";

/** The source the context's record lookup names, as the API receives it ("none" if absent). */
async function lookupSource(context: LayoutRequestContext) {
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

/** Layouts whose loader and routes report the source their record lookups name. */
function sourceReportingApp() {
  const pokemon = createLayout("pokemon.$name")({
    ...layoutOptions,
    title: "Pokémon",
    kind: "derived",
    loader: async ({ params, context }) => ({
      kind: "data",
      data: { name: params.name, source: await lookupSource(context) },
    }),
    routes: async ({ context }) => ({ data: [{ params: { name: await lookupSource(context) } }] }),
    toMarkdown: ({ data }) => [`# ${data.name} read ${data.source}`],
    buildMetaTitle: ({ data }) => `Read ${data.source}`,
  });
  const pokedex = createLayout("pokedex")({
    ...layoutOptions,
    title: "Pokédex",
    kind: "singleton",
    loader: async ({ context }) => ({
      kind: "data",
      data: { source: await lookupSource(context) },
    }),
    toMarkdown: ({ data }) => [`# Pokédex read ${data.source}`],
    buildMetaTitle: ({ data }) => `Read ${data.source}`,
  });
  return createApp({ blocks: [], layouts: [pokemon, pokedex] });
}

/** An API where only the valid session is signed in. */
function mockApi(t: { mock: { method: typeof test.mock.method } }) {
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const url = new URL(request.url);
    const session = request.headers.get("Better-Auth-Cookie");
    if (session && session !== "valid")
      return Response.json(
        { json: { defined: false, code: "UNAUTHORIZED", status: 401, message: "Session expired" } },
        { status: 401 },
      );
    if (url.pathname.endsWith("/locales/list")) return localesResponse();
    if (url.pathname.endsWith("/getByUuid"))
      return Response.json({ json: { id: 1, name: "Real project", slug: "test", updatedAt: 1 } });
    if (url.pathname.endsWith("/listBySlug")) return pageListResponse();
    if (url.pathname.endsWith("/getByPath"))
      return Response.json(
        { json: { defined: false, code: "NOT_FOUND", status: 404, message: "Not found" } },
        { status: 404 },
      );
    if (url.pathname.endsWith("/collectionDefinitions/listRecordPageValues")) {
      // Reports the source each lookup named, so layouts can show it.
      const { json: input } = (await request.json()) as { json: { source?: string } };
      const source = input.source ?? "none";
      return Response.json({ json: [{ id: source, value: source, label: source }] });
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
  projectUuid: "test",
  getCamoxApp: async () => sourceReportingApp(),
  renderPage: async (input) => `<main>${JSON.stringify(input.derived?.result?.data)}</main>`,
};

function request(path: string, init: { cookie?: string; accept?: string } = {}) {
  const headers: Record<string, string> = {};
  if (init.cookie) headers.Cookie = init.cookie;
  if (init.accept) headers.Accept = init.accept;
  return handleCamoxRequest(new Request(`https://site.test${path}`, { headers }), runtimeOptions);
}

void test("pages take the editor's source, while their record lookups name none", async (t) => {
  mockApi(t);
  for (const path of ["/pokemon/pikachu", "/pokedex"]) {
    for (const [cookie, expected] of [
      [VALID_SESSION, "draft"],
      [undefined, "live"],
      [EXPIRED_SESSION, "live"],
    ] as const) {
      const html = await request(path, { cookie });
      assert.match(await html!.text(), /<main>[^<]*"source":"none"/, `${path} ${cookie}`);
      const data = await request(`/_camox/data?path=${path}`, { cookie });
      const input = (await data!.json()) as PageRenderInput;
      assert.equal(input.presentation, expected === "draft" ? "studio" : "public");
      assert.equal(
        (input.derived!.result!.data as { source: string }).source,
        "none",
        `${path} ${cookie}`,
      );
      if (cookie === EXPIRED_SESSION) assert.match(data!.headers.get("Set-Cookie")!, /Max-Age=0/);
    }
  }
});

void test("Markdown and the sitemap look up records without a source, even for an editor", async (t) => {
  mockApi(t);
  const derived = await request("/pokemon/pikachu", {
    cookie: VALID_SESSION,
    accept: "text/markdown",
  });
  assert.equal(markdownBody(await derived!.text()), "# pikachu read none");
  const singleton = await request("/pokedex", { cookie: VALID_SESSION, accept: "text/markdown" });
  assert.equal(markdownBody(await singleton!.text()), "# Pokédex read none");
  const sitemap = await request("/sitemap.xml", { cookie: VALID_SESSION });
  assert.match(await sitemap!.text(), /<loc>https:\/\/site.test\/pokemon\/none<\/loc>/);
});

void test("the routes endpoint discovers pages without a source, whatever the session", async (t) => {
  mockApi(t);
  for (const cookie of [VALID_SESSION, undefined, EXPIRED_SESSION]) {
    const response = await request("/_camox/routes?layoutId=pokemon.$name", { cookie });
    assert.deepEqual(await response!.json(), { path: "/pokemon/none" }, String(cookie));
    if (cookie === EXPIRED_SESSION) assert.match(response!.headers.get("Set-Cookie")!, /Max-Age=0/);
  }
});
