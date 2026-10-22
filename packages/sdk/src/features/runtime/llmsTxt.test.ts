import assert from "node:assert/strict";
import { test } from "node:test";

import { DRAFT_HEADER } from "@camox/api-contract/drafts";

import { createApp } from "../../core/createApp";
import { createCollection } from "../../core/createCollection";
import { createLayout } from "../../core/createLayout";
import { localesResponse, pageListResponse } from "./api.fixtures";
import { LLMS_TXT_DERIVED_LAYOUT_CAP } from "./llmsTxt";
import { handleCamoxRequest, type RuntimeOptions } from "./runtime";

const articles = createCollection({
  id: "articles",
  title: "Articles",
  description: "",
  content: (field) => ({ title: field.string(), slug: field.string() }),
  toTitle: ({ content }) => content.title,
  toDescription: () => undefined,
});

const layoutOptions = {
  description: "",
  blocks: { before: [], after: [] },
  toReact: () => null,
  toTitle: ({ page }: { page: { title: string } }) => page.title,
};

const defaultLayout = createLayout("default")({
  ...layoutOptions,
  kind: "curated",
  title: "Page",
  toReact: ({ children }) => children,
});

type MockPage = {
  id: string;
  fullPath: string;
  layoutId: string;
  nickname: string;
  metaTitle: string | null;
  metaDescription: string | null;
  updatedAt: number;
  needsLayout?: boolean;
  shadowed?: boolean;
};

const page = (fullPath: string, rest: Partial<MockPage> = {}): MockPage => ({
  id: fullPath,
  fullPath,
  layoutId: "default",
  nickname: fullPath,
  metaTitle: null,
  metaDescription: null,
  updatedAt: Date.UTC(2026, 0, 1),
  ...rest,
});

type MockRecord = { id: string; slug: string; title: string };

/** Records the API lists for route discovery, and the requests the runtime sent it. */
function mockApi(
  t: { mock: { method: typeof test.mock.method } },
  { pages = [] as MockPage[], records = [] as MockRecord[], projectName = "Pokédex" } = {},
) {
  const requests: Array<{ path: string; draft: string | null; session: string | null }> = [];
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const path = new URL(request.url).pathname;
    requests.push({
      path,
      draft: request.headers.get("x-camox-draft"),
      session: request.headers.get("Better-Auth-Cookie"),
    });
    if (path.endsWith("/pages/listBySlug")) return pageListResponse(pages, projectName);
    if (path.endsWith("/locales/list")) return localesResponse();
    if (path.endsWith("/collectionDefinitions/listRecordPageValues"))
      return Response.json({
        json: records.map((record) => ({ id: record.id, value: record.slug, title: record.title })),
      });
    throw new Error(`Unexpected API request ${path}`);
  });
  return requests;
}

function llmsTxt(
  layouts: Parameters<typeof createApp>[0]["layouts"],
  {
    path = "/llms.txt",
    headers = {} as Record<string, string>,
    ...options
  }: Partial<RuntimeOptions> & {
    path?: string;
    headers?: Record<string, string>;
  } = {},
) {
  return handleCamoxRequest(new Request(`https://site.test${path}`, { headers }), {
    apiUrl: "https://api.test",
    projectUuid: "test",
    getCamoxApp: async () => createApp({ blocks: [], layouts, collections: [articles] }),
    ...options,
  });
}

void test("llms.txt names the project, summarizes it with the home page's description and lists curated pages' Markdown", async (t) => {
  mockApi(t, {
    pages: [
      page("/contact", { metaTitle: "Contact us", metaDescription: "Where to find us." }),
      page("/", { metaTitle: "Home", metaDescription: "Every Pokémon, described." }),
      page("/team", { metaTitle: "Team" }),
    ],
  });
  const response = await llmsTxt([defaultLayout]);
  assert.equal(response?.status, 200);
  assert.equal(
    await response!.text(),
    `# Pokédex

> Every Pokémon, described.

## Page

- [Home](https://site.test/index.md): Every Pokémon, described.
- [Contact us](https://site.test/contact.md): Where to find us.
- [Team](https://site.test/team.md)
`,
  );
});

const pricingLayout = createLayout("pricing")({
  ...layoutOptions,
  kind: "singleton",
  title: "Pricing",
  toMarkdown: () => ["Plans"],
});
const aboutLayout = createLayout("about")({ ...layoutOptions, kind: "singleton", title: "About" });
const articleLayout = createLayout("articles.$slug")({
  ...layoutOptions,
  kind: "derived",
  title: "Article",
  ...articles.pages({ by: "slug", param: "slug" }),
  toMarkdown: () => ["Article"],
});
/** A code-owned layout whose Route Discovery is `routes`. */
const pokemonDiscovering = (routes: () => Promise<{ data: { params: { name: string } }[] }>) =>
  createLayout("pokemon.$name")({
    ...layoutOptions,
    kind: "derived",
    title: "Pokémon",
    loader: async ({ params }) => ({ kind: "data" as const, data: params }),
    routes,
  });
const pokemonRoutes = (names: string[]) =>
  pokemonDiscovering(async () => ({ data: names.map((name) => ({ params: { name } })) }));
const pokemonLayout = pokemonRoutes(["pikachu", "eevee"]);

const articleRecords: MockRecord[] = [
  { id: "00000000-0000-4000-8000-000000000001", slug: "evolution", title: "How evolution works" },
  { id: "00000000-0000-4000-8000-000000000002", slug: "catching", title: "Catching them all" },
];

void test("llms.txt lists singletons and discovered pages under their layouts, linking Markdown only where it exists", async (t) => {
  mockApi(t, {
    pages: [
      page("/team", { metaTitle: "Team" }),
      page("/old", { metaTitle: "Old", needsLayout: true }),
      page("/pricing", { metaTitle: "Shadowed pricing", shadowed: true }),
    ],
    records: articleRecords,
  });
  const response = await llmsTxt([
    defaultLayout,
    pricingLayout,
    aboutLayout,
    articleLayout,
    pokemonLayout,
  ]);
  assert.equal(
    await response!.text(),
    `# Pokédex

## Page

- [Team](https://site.test/team.md)

## Pricing

- [Pricing](https://site.test/pricing.md)

## About

- [About](https://site.test/about)

## Article

- [Catching them all](https://site.test/articles/catching.md)
- [How evolution works](https://site.test/articles/evolution.md)

## Pokémon

- [/pokemon/eevee](https://site.test/pokemon/eevee)
- [/pokemon/pikachu](https://site.test/pokemon/pikachu)
`,
  );
});

/** The URLs of a llms.txt's entries. */
const linkedUrls = (text: string) =>
  [...text.matchAll(/^- \[.*\]\((.*)\)/gm)].map(([, url]) => url);

void test("llms.txt links under the runtime base path", async (t) => {
  mockApi(t, { pages: [page("/", { metaTitle: "Home" })] });
  const response = await llmsTxt([defaultLayout, aboutLayout, pokemonRoutes(["pikachu"])], {
    path: "/site/llms.txt",
    runtimeBasePath: "/site",
  });
  assert.deepEqual(linkedUrls(await response!.text()), [
    "https://site.test/site/index.md",
    "https://site.test/site/about",
    "https://site.test/site/pokemon/pikachu",
  ]);
});

void test("llms.txt caps each derived layout's entries and points to the sitemap for the rest", async (t) => {
  mockApi(t);
  const names = Array.from(
    { length: LLMS_TXT_DERIVED_LAYOUT_CAP + 2 },
    (_, index) => `pokemon-${index}`,
  );
  const text = await (await llmsTxt([pokemonRoutes(names)]))!.text();
  assert.deepEqual(
    linkedUrls(text),
    [...names]
      .sort()
      .slice(0, LLMS_TXT_DERIVED_LAYOUT_CAP)
      .map((name) => `https://site.test/pokemon/${name}`),
  );
  // Not a list entry: LLMs would read it as one more page.
  const lastLine = text.trimEnd().split("\n").at(-1)!;
  assert.doesNotMatch(lastLine, /^- /);
  assert.match(lastLine, /\(https:\/\/site\.test\/sitemap\.xml\)/);

  const atCap = await (await llmsTxt([
    pokemonRoutes(names.slice(0, LLMS_TXT_DERIVED_LAYOUT_CAP)),
  ]))!.text();
  assert.doesNotMatch(atCap, /sitemap/);
});

void test("llms.txt reads Live, even for a signed-in editor viewing a draft", async (t) => {
  const requests = mockApi(t, { pages: [page("/team")], records: articleRecords });
  const response = await llmsTxt([defaultLayout, articleLayout], {
    path: "/llms.txt?camox-draft=0190a000-0000-7000-8000-000000000000",
    headers: {
      Cookie: "better-auth.session_token=valid",
      [DRAFT_HEADER]: "0190a000-0000-7000-8000-000000000000",
    },
  });
  assert.equal(response?.status, 200);
  assert.deepEqual(
    requests.map(({ path }) => path),
    ["/rpc/pages/listBySlug", "/rpc/collectionDefinitions/listRecordPageValues"],
  );
  for (const request of requests) {
    assert.equal(request.draft, null);
    assert.equal(request.session, null);
  }
});

void test("llms.txt fails visibly when Route Discovery fails", async (t) => {
  mockApi(t, { pages: [page("/team")] });
  t.mock.method(console, "error", () => {});
  const failing = pokemonDiscovering(async () => {
    throw new Error("PokéAPI is down");
  });
  const response = await llmsTxt([defaultLayout, failing]);
  assert.equal(response?.status, 500);
  assert.match(((await response!.json()) as { message: string }).message, /PokéAPI is down/);
});

void test("llms.txt fails when the API isn't configured", async () => {
  const response = await llmsTxt([defaultLayout], { apiUrl: undefined });
  assert.equal(response?.status, 500);
});

void test("llms.txt is plain text that clients can cache and revalidate", async (t) => {
  let description = "Every Pokémon, described.";
  t.mock.method(globalThis, "fetch", async () =>
    pageListResponse([page("/", { metaDescription: description })]),
  );
  const response = await llmsTxt([defaultLayout]);
  assert.equal(response?.headers.get("Content-Type"), "text/plain; charset=utf-8");
  assert.match(response?.headers.get("Cache-Control") ?? "", /public/);
  assert.match(response?.headers.get("Cache-Control") ?? "", /stale-while-revalidate/);
  const etag = response?.headers.get("ETag");
  assert.ok(etag);

  const revalidated = await llmsTxt([defaultLayout], { headers: { "If-None-Match": etag } });
  assert.equal(revalidated?.status, 304);
  assert.equal(await revalidated!.text(), "");
  assert.equal(revalidated?.headers.get("ETag"), etag);

  description = "Every Pokémon, described again after a publish.";
  const changed = await llmsTxt([defaultLayout], { headers: { "If-None-Match": etag } });
  assert.equal(changed?.status, 200);
  assert.notEqual(changed?.headers.get("ETag"), etag);
  assert.match(await changed!.text(), /after a publish/);
});

void test("llms.txt and the sitemap list the same pages", async (t) => {
  mockApi(t, {
    pages: [
      page("/", { metaTitle: "Home" }),
      page("/team", { metaTitle: "Team" }),
      page("/old", { needsLayout: true }),
      page("/pricing", { shadowed: true }),
    ],
    records: articleRecords,
  });
  const layouts = [defaultLayout, pricingLayout, aboutLayout, articleLayout, pokemonLayout];
  const llms = await (await llmsTxt(layouts))!.text();
  const sitemap = await (await llmsTxt(layouts, { path: "/sitemap.xml" }))!.text();
  const htmlUrl = (url: string) => url.replace(/\/index\.md$/, "/").replace(/\.md$/, "");
  assert.deepEqual(
    linkedUrls(llms).map(htmlUrl).sort(),
    [...sitemap.matchAll(/<loc>(.*)<\/loc>/g)].map(([, url]) => url).sort(),
  );
  assert.equal(linkedUrls(llms).length, 8);
});

void test("HTML pages point LLM tools to llms.txt", async (t) => {
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    if (new URL(request.url).pathname.endsWith("/locales/list")) return localesResponse();
    const path = new URL(request.url).pathname;
    if (path.endsWith("/pages/getByPath"))
      return Response.json({
        json: {
          page: { id: "3", fullPath: "/team", pathSegment: "team" },
          layout: null,
          project: { id: 1, updatedAt: 1 },
          projectName: "Pokédex",
          blocks: [],
          files: [],
          repeatableItems: [],
        },
      });
    if (path.endsWith("/layouts/get"))
      return Response.json({
        json: {
          projectName: "Pokédex",
          project: { id: 1, updatedAt: 1 },
          layout: { id: 2, layoutId: "about", beforeBlockIds: [], afterBlockIds: [] },
          blocks: [],
          files: [],
          repeatableItems: [],
        },
      });
    throw new Error(`Unexpected API request ${path}`);
  });
  for (const [path, runtimeBasePath, link] of [
    ["/team", undefined, '</llms.txt>; rel="llms-txt"'],
    ["/about", undefined, '</llms.txt>; rel="llms-txt"'],
    ["/site/team", "/site", '</site/llms.txt>; rel="llms-txt"'],
  ] as const) {
    const response = await llmsTxt([defaultLayout, aboutLayout], {
      path,
      runtimeBasePath,
      authenticationUrl: "https://auth.test",
      renderPage: async () => "<main>Page</main>",
    });
    assert.equal(response?.status, 200, path);
    assert.match(response?.headers.get("Content-Type") ?? "", /text\/html/);
    assert.equal(response?.headers.get("Link"), link, path);
  }
});

void test("titles and descriptions can't break the index's Markdown", async (t) => {
  mockApi(t, {
    projectName: "Poké*dex*",
    pages: [
      page("/", {
        metaTitle: "[Home](https://evil.test)",
        metaDescription: "Line one\n\n## Not a heading <b>_really_</b>",
      }),
    ],
  });
  const text = await (await llmsTxt([defaultLayout]))!.text();
  assert.equal(
    text,
    `# Poké\\*dex\\*

> Line one ## Not a heading \\<b\\>\\_really\\_\\</b\\>

## Page

- [\\[Home\\](https://evil.test)](https://site.test/index.md): Line one ## Not a heading \\<b\\>\\_really\\_\\</b\\>
`,
  );
  assert.deepEqual(linkedUrls(text), ["https://site.test/index.md"]);
});

void test("characters that would end a Markdown link are percent-encoded in its URL", async (t) => {
  mockApi(t, { pages: [page("/team (old)", { metaTitle: "Old team" })] });
  const text = await (await llmsTxt([defaultLayout, pokemonRoutes(["nidoran(f)"])]))!.text();
  assert.deepEqual(linkedUrls(text), [
    "https://site.test/team%20%28old%29.md",
    "https://site.test/pokemon/nidoran%28f%29",
  ]);
});
