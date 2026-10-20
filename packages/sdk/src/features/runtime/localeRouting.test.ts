import assert from "node:assert/strict";
import { test } from "node:test";

import { DRAFT_HEADER, LOCALE_HEADER } from "@camox/api-contract/drafts";

import type { CamoxApp } from "../../core/createApp";
import { localesResponse, pageListResponse } from "./api.fixtures";
import { handleCamoxRequest, type PageRenderInput, type RuntimeOptions } from "./runtime";

// A non-default locale's paths sit under its prefix (`/de/preise`); the default locale's have
// none. The runtime reads the locales of the request's scope, Live's or the URL's draft's, and
// renders the locale the path names.

const project = { id: 1, name: "Real project", slug: "test", updatedAt: 1 };
const DRAFT = "0199f0a0-0000-7000-8000-00000000d1d1";
const session = { Cookie: "camox_auth_cookie=valid" };

/** Each locale's pages by path. French is a locale only the draft has. */
const PAGES: Record<string, Record<string, string>> = {
  en: { "/pricing": "Pricing", "/": "Home" },
  de: { "/preise": "Preise", "/": "Startseite" },
  fr: { "/prix": "Prix" },
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
    {
      _internal: {
        id: "forecast",
        kind: "singleton",
        title: "Forecast",
        buildMetaTitle,
        // Data from outside Camox, which a loader fetches in the page's locale if it can.
        loader: async ({ locale }: { locale: string }) => ({
          kind: "data",
          data: { summary: locale === "de" ? "Sonnig" : "Sunny" },
        }),
      },
    },
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

type ApiRead = { procedure: string; path?: string; locale: string | null; draft: string | null };

const notFound = () =>
  Response.json(
    { json: { defined: false, code: "NOT_FOUND", status: 404, message: "Not found" } },
    { status: 404 },
  );

/**
 * An API whose Live has English, the default locale, and German, and whose draft also has
 * French. The valid session is a member's. Records the reads naming a locale or a page.
 */
function mockApi(t: { mock: { method: typeof test.mock.method } }) {
  const reads: ApiRead[] = [];
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const procedure = new URL(request.url).pathname.replace(/^\/rpc\//, "");
    const locale = request.headers.get(LOCALE_HEADER);
    const draft = request.headers.get(DRAFT_HEADER);
    const member = request.headers.get("Better-Auth-Cookie") !== null;
    if (procedure === "projects/getBySlug")
      return member ? Response.json({ json: project }) : notFound();
    if (procedure === "locales/list") {
      reads.push({ procedure, locale, draft });
      return localesResponse(draft === DRAFT && member ? ["en", "de", "fr"] : ["en", "de"]);
    }
    if (procedure === "pages/listBySlug") return pageListResponse();
    if (procedure === "pages/getByPath") {
      const { json: input } = (await request.json()) as { json: { path: string } };
      reads.push({ procedure, path: input.path, locale, draft });
      const inScope = locale !== "fr" || (draft === DRAFT && member);
      const title = inScope ? PAGES[locale ?? "en"]?.[input.path] : undefined;
      if (!title) return notFound();
      return Response.json({
        json: {
          page: {
            id: "0199f0a0-0000-7000-8000-000000000001",
            fullPath: input.path,
            pathSegment: input.path.slice(1),
            metaTitle: title,
            locale: locale ?? "en",
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
    if (procedure === "blocks/getPageMarkdown")
      return Response.json({ json: { markdown: `# In ${locale ?? "en"}` } });
    if (procedure === "layouts/get") {
      reads.push({ procedure, locale, draft });
      return Response.json({
        json: {
          projectName: project.name,
          project,
          layout: { id: "2", layoutId: "pokedex", beforeBlockIds: [], afterBlockIds: [] },
          blocks: [],
          files: [],
          repeatableItems: [],
        },
      });
    }
    throw new Error(`Unexpected API request ${procedure}`);
  });
  return reads;
}

const options: RuntimeOptions = {
  apiUrl: "https://api.test",
  authenticationUrl: "https://auth.test",
  projectSlug: "test",
  getCamoxApp: async () => app,
  getDocument: async () => ({ htmlAttrs: { lang: "x-site", class: "dark" } }),
  renderPage: async (input) => `<main>${input.locale.tag}</main>`,
  renderStudio: async () => "<nav>Studio</nav>",
};

const visit = (path: string, headers: Record<string, string> = {}) =>
  handleCamoxRequest(new Request(`https://site.test${path}`, { headers }), options);

/** The render input a document embeds for hydration. */
async function hydrationOf(response: Response | null): Promise<PageRenderInput> {
  const html = await response!.text();
  const data = html.match(/<script id="__CAMOX_DATA__" type="application\/json">(.*?)<\/script>/s);
  return JSON.parse(data![1]!) as PageRenderInput;
}

const en = { tag: "en", isDefault: true };
const de = { tag: "de", isDefault: false };

void test("a path under a locale's prefix renders that locale's page, with the locale's lang", async (t) => {
  const reads = mockApi(t);
  const response = await visit("/de/preise");
  assert.equal(response?.status, 200);
  const html = await response!.clone().text();
  // The rendered locale overrides the Document's lang.
  assert.match(html, /<html[^>]* lang="de"/);
  assert.doesNotMatch(html, /x-site/);
  assert.match(html, /<link[^>]*rel="alternate"[^>]*href="https:\/\/site.test\/de\/preise.md"/);
  const input = await hydrationOf(response);
  assert.deepEqual(input.locale, de);
  assert.deepEqual(input.locales, [en, de]);
  assert.equal(input.pathname, "/de/preise");
  assert.deepEqual(
    reads.filter((read) => read.procedure === "pages/getByPath"),
    [{ procedure: "pages/getByPath", path: "/preise", locale: "de", draft: null }],
  );
});

void test("a path without a prefix renders the default locale's page", async (t) => {
  const reads = mockApi(t);
  const response = await visit("/pricing");
  assert.equal(response?.status, 200);
  assert.match(await response!.clone().text(), /<html[^>]* lang="en"/);
  const input = await hydrationOf(response);
  assert.deepEqual(input.locale, en);
  assert.equal(input.pathname, "/pricing");
  const home = await hydrationOf(await visit("/de"));
  assert.deepEqual(home.locale, de);
  assert.deepEqual(
    reads
      .filter((read) => read.procedure === "pages/getByPath")
      .map(({ path, locale }) => ({ path, locale })),
    [
      { path: "/pricing", locale: null },
      { path: "/", locale: "de" },
    ],
  );
});

void test("a page missing from a locale is a 404, and a locale only a draft has names nothing on Live", async (t) => {
  const reads = mockApi(t);
  // The default locale's path under German's prefix: no German page has it.
  assert.equal((await visit("/de/pricing"))?.status, 404);
  // A visitor reads Live, which has no French: the path is the default locale's.
  assert.equal((await visit("/fr/prix"))?.status, 404);
  assert.deepEqual(
    reads
      .filter((read) => read.procedure === "pages/getByPath")
      .map(({ path, locale }) => ({ path, locale })),
    [
      { path: "/pricing", locale: "de" },
      { path: "/fr/prix", locale: null },
    ],
  );
});

void test("a draft link under a locale's prefix renders the draft's page in that locale", async (t) => {
  const reads = mockApi(t);
  const response = await visit(`/fr/prix?camox-draft=${DRAFT}`, session);
  assert.equal(response?.status, 200);
  const input = await hydrationOf(response);
  assert.equal(input.draftId, DRAFT);
  assert.deepEqual(input.locale, { tag: "fr", isDefault: false });
  assert.deepEqual(
    input.locales.map(({ tag }) => tag),
    ["en", "de", "fr"],
  );
  assert.match(input.previewDocument!, /<html[^>]* lang="fr"/);
  assert.deepEqual(
    reads.filter((read) => read.procedure !== "layouts/get"),
    [
      { procedure: "locales/list", locale: null, draft: DRAFT },
      { procedure: "pages/getByPath", path: "/prix", locale: "fr", draft: DRAFT },
    ],
  );
});

void test("client navigation renders the locale its path names", async (t) => {
  mockApi(t);
  const response = await visit(`/_camox/data?path=${encodeURIComponent("/de/preise")}`);
  assert.equal(response?.status, 200);
  const input = (await response!.json()) as PageRenderInput;
  assert.deepEqual(input.locale, de);
  assert.equal(input.pathname, "/de/preise");
  assert.equal(
    (await visit(`/_camox/data?path=${encodeURIComponent("/de/pricing")}`))?.status,
    404,
  );
});

void test("singleton and derived pages under a locale's prefix render in that locale", async (t) => {
  const reads = mockApi(t);
  const singleton = await visit("/de/pokedex");
  assert.equal(singleton?.status, 200);
  assert.match(await singleton!.clone().text(), /<html[^>]* lang="de"/);
  const shown = await hydrationOf(singleton);
  assert.deepEqual(shown.locale, de);
  assert.equal(shown.pathname, "/de/pokedex");
  assert.deepEqual(shown.derived?.result, { kind: "data", data: { count: 12 } });

  const derived = await hydrationOf(await visit("/de/pokemon/pikachu"));
  assert.deepEqual(derived.locale, de);
  assert.deepEqual(derived.derived?.result, { kind: "data", data: { name: "pikachu" } });
  assert.deepEqual(
    reads.filter((read) => read.procedure === "layouts/get").map(({ locale }) => locale),
    ["de", "de"],
  );
});

void test("a loader receives the page's locale, and its data renders as it returns it", async (t) => {
  mockApi(t);
  const german = await hydrationOf(await visit("/de/forecast"));
  assert.deepEqual(german.derived?.result, { kind: "data", data: { summary: "Sonnig" } });
  const english = await hydrationOf(await visit("/forecast"));
  assert.deepEqual(english.derived?.result, { kind: "data", data: { summary: "Sunny" } });
});

void test("the studio's routes under a locale's prefix carry that locale", async (t) => {
  mockApi(t);
  const response = await visit(
    `/_camox/data?path=${encodeURIComponent("/de/camox/content")}`,
    session,
  );
  assert.equal(response?.status, 200);
  const input = (await response!.json()) as PageRenderInput;
  assert.equal(input.routeKind, "studio-content");
  assert.deepEqual(input.locale, de);
  assert.equal(input.pathname, "/de/camox/content");
});

void test("a page's Markdown under a locale's prefix is that locale's", async (t) => {
  const reads = mockApi(t);
  const response = await visit("/de/preise.md");
  assert.equal(response?.status, 200);
  const markdown = await response!.text();
  assert.ok(markdown.endsWith("\n# In de"), "the body is the locale's");
  assert.match(
    markdown,
    /^url: "https:\/\/site\.test\/de\/preise"$/m,
    "the front matter links the page under its prefix",
  );
  assert.deepEqual(
    reads
      .filter((read) => read.procedure === "pages/getByPath")
      .map(({ path, locale }) => ({ path, locale })),
    [{ path: "/preise", locale: "de" }],
  );
});
