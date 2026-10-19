import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";

import { localesResponse, pageListResponse } from "./api.fixtures";
import { handleCamoxRequest, type PageRenderInput, type RuntimeOptions } from "./runtime";

const MEMBER_SESSION = "camox_auth_cookie=valid";
const MEASUREMENT_ID = "G-TEST123";

const unauthorized = () =>
  Response.json(
    { json: { defined: false, code: "UNAUTHORIZED", status: 401, message: "Sign in" } },
    { status: 401 },
  );

/**
 * An API where only the valid session is a member, and whose project has the given analytics
 * providers. Like the real API, naming a draft without a session is refused.
 */
function mockApi(
  t: { mock: { method: typeof test.mock.method } },
  analytics: { ga4: { measurementId: string } | null } = { ga4: { measurementId: MEASUREMENT_ID } },
) {
  const project = { id: 1, name: "Real project", slug: "test", updatedAt: 1, analytics };
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const url = new URL(request.url);
    const session = request.headers.get("Better-Auth-Cookie");
    if (session && session !== "valid") return unauthorized();
    if (request.headers.get("x-camox-draft") && !session) return unauthorized();
    if (url.pathname.endsWith("/locales/list")) return localesResponse();
    if (url.pathname.endsWith("/getBySlug")) {
      if (!session) return unauthorized();
      return Response.json({ json: project });
    }
    if (url.pathname.endsWith("/listBySlug"))
      return pageListResponse([
        { id: 1, fullPath: "/about", pathSegment: "about", updatedAt: 1, layoutId: null },
      ]);
    if (url.pathname.endsWith("/getByPath"))
      return Response.json({
        json: {
          page: { id: 1, fullPath: "/about", pathSegment: "about", metaTitle: "About" },
          layout: null,
          project,
          projectName: project.name,
          blocks: [],
          files: [],
          repeatableItems: [],
        },
      });
    if (url.pathname.endsWith("/getPageMarkdown"))
      return Response.json({ json: { markdown: "# About" } });
    if (url.pathname.endsWith("/layouts/get"))
      return Response.json({
        json: {
          projectName: project.name,
          project,
          layout: {
            id: 2,
            layoutId: "pokedex",
            beforeBlockIds: [],
            afterBlockIds: [],
            updatedAt: 1,
          },
          blocks: [],
          files: [],
          repeatableItems: [],
        },
      });
    throw new Error(`Unexpected request: ${url}`);
  });
}

const pokedex = {
  _internal: {
    id: "pokedex",
    kind: "singleton",
    title: "Pokédex",
    buildMetaTitle: ({ pageMetaTitle }: { pageMetaTitle: string }) => pageMetaTitle,
  },
};
const hero = { _internal: { id: "hero", title: "Hero" } };

const runtimeOptions: RuntimeOptions = {
  apiUrl: "https://api.test",
  authenticationUrl: "https://auth.test",
  projectSlug: "test",
  pageClientEntryUrl: "/client.js",
  getCamoxApp: async () =>
    ({
      getLayouts: () => [pokedex],
      getLayoutById: () => null,
      getBlockById: (id: string) => (id === "hero" ? hero : undefined),
      getCollectionById: () => undefined,
    }) as never,
  renderPage: async () => "<main>Page</main>",
  renderStudio: async () => "<nav>Studio</nav>",
};

async function request(
  path: string,
  { cookie, developmentDraft }: { cookie?: string; developmentDraft?: boolean } = {},
) {
  const response = await handleCamoxRequest(
    new Request(`https://site.test${path}`, { headers: cookie ? { Cookie: cookie } : {} }),
    { ...runtimeOptions, developmentDraft },
  );
  return { body: await response!.text(), kind: kindOf(response!.headers.get("Content-Type")) };
}

type Reply = Awaited<ReturnType<typeof request>>;

/** What a response is: an HTML document, the data route's render input, or Markdown. */
function kindOf(contentType: string | null) {
  const mediaType = contentType?.split(";")[0];
  switch (mediaType) {
    case "text/html":
      return "document" as const;
    case "application/json":
      return "data" as const;
    case "text/markdown":
      return "markdown" as const;
    default:
      throw new Error(`Unexpected content type: ${contentType}`);
  }
}

/** The scripts a document loads from elsewhere. */
function externalScripts(html: string) {
  return [...html.matchAll(/<script\b([^>]*)\bsrc="([^"]*)"([^>]*)>/g)].map((match) => ({
    src: match[2]!.replaceAll("&amp;", "&"),
    async: /\basync\b/.test(`${match[1]} ${match[3]}`),
  }));
}

/** The commands the document's inline scripts queue for gtag.js, run as a browser would. */
function gtagCommands(html: string) {
  const context = vm.createContext({ Date }) as { window?: unknown; dataLayer?: unknown[] };
  context.window = context;
  for (const [, attributes, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    // External scripts, data, and the Studio's own scripts, which need a real browser.
    if (/\bsrc=|type="application\/json"|data-camox-studio/.test(attributes!)) continue;
    vm.runInContext(body!, context);
  }
  // Out of the script's realm, so they compare as plain values.
  const commands = (context.dataLayer ?? []).map((args) => Array.from(args as ArrayLike<unknown>));
  return JSON.parse(JSON.stringify(commands)) as unknown[][];
}

/** The render input a document hydrates with, if it has one. */
function hydrationInput(html: string) {
  const json = html.match(
    /<script id="__CAMOX_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  return json ? (JSON.parse(json[1]!) as PageRenderInput) : undefined;
}

/** The render input a reply carries: the data route answers with it, a document embeds it. */
function renderInput({ body, kind }: Reply) {
  switch (kind) {
    case "data":
      return JSON.parse(body) as PageRenderInput;
    case "document":
      return hydrationInput(body);
    case "markdown":
      return undefined;
  }
}

function assertCountsVisitor({ body: html, kind }: Reply, label: string) {
  assert.equal(kind, "document", label);
  const gtag = externalScripts(html).find(({ src }) =>
    src.startsWith("https://www.googletagmanager.com/gtag/js"),
  );
  assert.ok(gtag, `${label}: loads gtag.js`);
  assert.equal(new URL(gtag.src).searchParams.get("id"), MEASUREMENT_ID, label);
  assert.equal(gtag.async, true, `${label}: gtag.js doesn't block the page`);
  const config = gtagCommands(html).find(([command]) => command === "config");
  assert.deepEqual(config, ["config", MEASUREMENT_ID, { send_page_view: false }], label);
  assert.deepEqual(
    hydrationInput(html)?.analytics,
    { ga4: { measurementId: MEASUREMENT_ID } },
    `${label}: the page client sends the page views`,
  );
}

function assertCountsNobody(reply: Reply, label: string) {
  assert.doesNotMatch(reply.body, /googletagmanager/, label);
  if (reply.kind === "document") assert.deepEqual(gtagCommands(reply.body), [], label);
  assert.equal(renderInput(reply)?.analytics, undefined, label);
}

const PAGES = ["/about", "/pokedex"];

void test("a visitor's Live page loads gtag.js with automatic page views off", async (t) => {
  mockApi(t);
  for (const path of PAGES) assertCountsVisitor(await request(path), path);
});

void test("a visitor whose URL names a draft they can't see gets Live, with gtag.js", async (t) => {
  mockApi(t);
  for (const path of PAGES) assertCountsVisitor(await request(`${path}?camox-draft=d1`), path);
});

void test("a member's page loads no analytics, on Live or in a draft", async (t) => {
  mockApi(t);
  for (const path of PAGES) {
    assertCountsNobody(await request(path, { cookie: MEMBER_SESSION }), path);
    assertCountsNobody(
      await request(`${path}?camox-draft=d1`, { cookie: MEMBER_SESSION }),
      `${path} in a draft`,
    );
  }
});

void test("a development draft's pages load no analytics, for members or anyone else", async (t) => {
  mockApi(t);
  for (const path of PAGES) {
    for (const cookie of [MEMBER_SESSION, undefined]) {
      assertCountsNobody(
        await request(path, { cookie, developmentDraft: true }),
        `${path} ${cookie}`,
      );
    }
  }
});

void test("the preview sign-in hand-off loads no analytics", async (t) => {
  mockApi(t);
  assertCountsNobody(await request("/about?camox-preview=target&ott=token"), "hand-off");
});

void test("the studio, Canvas, Block Catalog, data and Markdown routes load no analytics", async (t) => {
  mockApi(t);
  for (const cookie of [MEMBER_SESSION, undefined]) {
    for (const path of [
      "/camox",
      "/camox/content",
      "/camox/canvas",
      "/camox/blocks/hero",
      "/_camox/data?path=/about",
      "/_camox/data?path=/pokedex",
      "/about.md",
    ]) {
      assertCountsNobody(await request(path, { cookie }), `${path} ${cookie}`);
    }
  }
});

void test("a project without a measurement ID loads no analytics", async (t) => {
  mockApi(t, { ga4: null });
  for (const path of PAGES) assertCountsNobody(await request(path), path);
});
