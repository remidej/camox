import assert from "node:assert/strict";
import { test } from "node:test";

import { DRAFT_HEADER, LOCALE_HEADER } from "@camox/api-contract/drafts";
import * as React from "react";

import { createApp } from "../../core/createApp";
import { createCollection } from "../../core/createCollection";
import { createLayout } from "../../core/createLayout";
import { localesResponse, pageListResponse } from "./api.fixtures";
import { handleCamoxRequest, type RuntimeOptions } from "./runtime";

// A nested page's graph places it in the website with a BreadcrumbList, linked from its WebPage:
// the page's ancestors by path that Camox can name without running a loader (curated pages,
// singletons and record pages), from the home page down to the page itself.

Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true, React });

const project = { id: 1, name: "Real project", slug: "test", updatedAt: 1 };
const MEMBER_SESSION = "camox_auth_cookie=valid";
const HELLO = "0199f0a0-0000-7000-8000-0000000000a1";

type StoredPage = { id: string; fullPath: string; metaTitle: string };

const page = (index: number, fullPath: string, metaTitle: string): StoredPage => ({
  id: `0199f0a0-0000-7000-8000-${String(index).padStart(12, "0")}`,
  fullPath,
  metaTitle,
});

/** Each locale's Live pages. A page keeps its id across locales, not its path. */
const LIVE_PAGES: Record<string, StoredPage[]> = {
  en: [
    page(1, "/", "Home"),
    page(2, "/docs", "Docs"),
    page(3, "/docs/install", "Install"),
    page(4, "/pokemon/pikachu/moves", "Moves"),
    page(5, "/articles/hello/comments", "Comments"),
    page(6, "/pokedex/legends", "Legends"),
    page(7, "/a/b/c/d/e", "Deep"),
    page(8, "/a/b", "Shallow"),
  ],
  de: [
    page(1, "/", "Startseite"),
    page(2, "/doku", "Doku"),
    page(3, "/doku/installation", "Installation"),
    page(5, "/articles/hallo/kommentare", "Kommentare"),
  ],
};

/** The draft renames the docs. */
const DRAFT_PAGES: Record<string, StoredPage[]> = {
  en: LIVE_PAGES.en!.map((stored) =>
    stored.fullPath === "/docs" ? { ...stored, metaTitle: "Documentation" } : stored,
  ),
};

const ARTICLES: Record<string, { title: string; slug: string }> = {
  en: { title: "Hello", slug: "hello" },
  de: { title: "Hallo", slug: "hallo" },
};

const notFound = () =>
  Response.json(
    { json: { defined: false, code: "NOT_FOUND", status: 404, message: "Not found" } },
    { status: 404 },
  );

/** An API with English and German. Only the valid session is a member. Returns its requests. */
function mockApi(t: { mock: { method: typeof test.mock.method } }) {
  const procedures: string[] = [];
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const procedure = new URL(request.url).pathname.replace(/^\/rpc\//, "");
    procedures.push(procedure);
    const locale = request.headers.get(LOCALE_HEADER) ?? "en";
    const session = request.headers.get("Better-Auth-Cookie");
    const draft = request.headers.get(DRAFT_HEADER);
    const pages = (draft && session ? DRAFT_PAGES : LIVE_PAGES)[locale] ?? [];
    if (procedure === "projects/getByUuid")
      return session === "valid" ? Response.json({ json: project }) : notFound();
    if (procedure === "locales/list") return localesResponse(["en", "de"]);
    if (procedure === "pages/listBySlug")
      return pageListResponse(
        pages.map((stored) => ({
          ...stored,
          pathSegment: stored.fullPath.split("/").at(-1),
          nickname: `Nickname of ${stored.fullPath}`,
          metaDescription: null,
          layoutId: "regular",
          updatedAt: 1,
        })),
        project.name,
      );
    if (procedure === "pages/getByPath") {
      const { json: input } = (await request.json()) as { json: { path: string } };
      const found = pages.find(({ fullPath }) => fullPath === input.path);
      if (!found) return notFound();
      return Response.json({
        json: {
          page: {
            ...found,
            pathSegment: found.fullPath.split("/").at(-1),
            metaDescription: null,
            blockIds: [],
            locale,
          },
          layout: { id: 1, layoutId: "regular", beforeBlockIds: [], afterBlockIds: [] },
          project,
          projectName: project.name,
          blocks: [],
          files: [],
          repeatableItems: [],
        },
      });
    }
    if (procedure === "layouts/get") {
      const { json: input } = (await request.json()) as { json: { layoutId: string } };
      return Response.json({
        json: {
          projectName: project.name,
          project,
          layout: { id: 2, layoutId: input.layoutId, beforeBlockIds: [], afterBlockIds: [] },
          blocks: [],
          files: [],
          repeatableItems: [],
        },
      });
    }
    if (procedure === "collectionDefinitions/findRecordsByField") {
      const { json: input } = (await request.json()) as { json: { value: string } };
      const article = ARTICLES[locale];
      return Response.json({
        json:
          article?.slug === input.value
            ? [{ id: HELLO, title: article.title, description: null, content: article }]
            : [],
      });
    }
    if (procedure === "collectionDefinitions/listRecordPageValues") {
      const article = ARTICLES[locale];
      return Response.json({
        json: article ? [{ id: HELLO, value: article.slug, title: article.title }] : [],
      });
    }
    throw new Error(`Unexpected API request ${procedure}`);
  });
  return procedures;
}

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
  toReact: () => <main />,
  // A decorated title: crumbs name pages by their undecorated title.
  toTitle: ({ page, project }: { page: { title: string }; project: { name: string } }) =>
    `${page.title} | ${project.name}`,
  toDescription: () => undefined,
};

let pokemonLoaderRuns = 0;

const app = createApp({
  blocks: [],
  collections: [articles],
  layouts: [
    createLayout("regular")({ ...layoutOptions, title: "Regular", kind: "curated" }),
    createLayout("pokedex")({ ...layoutOptions, title: "Pokédex", kind: "singleton" }),
    createLayout("pokemon.$name")({
      ...layoutOptions,
      title: "Pokémon",
      kind: "derived",
      loader: async ({ params }) => {
        pokemonLoaderRuns++;
        return { kind: "data", data: { name: params.name } };
      },
    }),
    createLayout("articles.$slug")({
      ...layoutOptions,
      title: "Article",
      kind: "derived",
      ...articles.pages({ by: "slug", param: "slug" }),
    }),
  ],
});

const options: RuntimeOptions = {
  apiUrl: "https://api.test",
  authenticationUrl: "https://auth.test",
  projectUuid: "test",
  getCamoxApp: async () => app,
  renderPage: async () => "<main></main>",
};

const visit = (path: string, init: { cookie?: string } = {}) =>
  handleCamoxRequest(
    new Request(`https://site.test${path}`, {
      headers: init.cookie ? { Cookie: init.cookie } : {},
    }),
    options,
  );

type Node = Record<string, unknown> & { "@id"?: string; "@type"?: string | string[] };

/** The crumbs of the breadcrumb the page's WebPage links, in order, or undefined without one. */
async function breadcrumbOf(response: Response | null) {
  assert.equal(response?.status, 200);
  const html = await response!.text();
  const head = html.slice(0, html.indexOf("</head>"));
  const script = head.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  const graph = (JSON.parse(script![1]!) as { "@graph": Node[] })["@graph"];
  const webpage = graph.find((node) => node["@type"] === "WebPage")!;
  const lists = graph.filter((node) => node["@type"] === "BreadcrumbList");
  if (!webpage.breadcrumb) {
    assert.equal(lists.length, 0, "no BreadcrumbList without a link from the page");
    return undefined;
  }
  const id = (webpage.breadcrumb as { "@id": string })["@id"];
  const list = graph.find((node) => node["@id"] === id);
  assert.ok(list, "the page links a BreadcrumbList in its graph");
  assert.equal(list["@type"], "BreadcrumbList");
  const items = list.itemListElement as Array<{ position: number; name: string; item: string }>;
  assert.deepEqual(
    items.map((item) => item.position),
    items.map((_, index) => index + 1),
    "crumbs are numbered in order",
  );
  return items.map(({ name, item }) => [name, item]);
}

void test("a curated page under another lists the home page, its parent and itself", async (t) => {
  mockApi(t);
  assert.deepEqual(await breadcrumbOf(await visit("/docs/install")), [
    ["Home", "https://site.test/"],
    ["Docs", "https://site.test/docs"],
    ["Install", "https://site.test/docs/install"],
  ]);
});

void test("the home page has no breadcrumbs", async (t) => {
  mockApi(t);
  assert.equal(await breadcrumbOf(await visit("/")), undefined);
});

void test("singletons and record pages are crumbs, named by their undecorated titles", async (t) => {
  mockApi(t);
  assert.deepEqual(await breadcrumbOf(await visit("/pokedex/legends")), [
    ["Home", "https://site.test/"],
    ["Pokédex", "https://site.test/pokedex"],
    ["Legends", "https://site.test/pokedex/legends"],
  ]);
  assert.deepEqual(await breadcrumbOf(await visit("/articles/hello/comments")), [
    ["Home", "https://site.test/"],
    ["Hello", "https://site.test/articles/hello"],
    ["Comments", "https://site.test/articles/hello/comments"],
  ]);
  // A record page names itself too.
  assert.deepEqual(await breadcrumbOf(await visit("/articles/hello")), [
    ["Home", "https://site.test/"],
    ["Hello", "https://site.test/articles/hello"],
  ]);
});

void test("an ancestor that isn't a page, or is a derived page, is left out, and no loader runs for it", async (t) => {
  mockApi(t);
  pokemonLoaderRuns = 0;
  assert.deepEqual(await breadcrumbOf(await visit("/pokemon/pikachu/moves")), [
    ["Home", "https://site.test/"],
    ["Moves", "https://site.test/pokemon/pikachu/moves"],
  ]);
  assert.equal(pokemonLoaderRuns, 0);
});

void test("a German page's crumbs use German titles and URLs", async (t) => {
  mockApi(t);
  assert.deepEqual(await breadcrumbOf(await visit("/de/doku/installation")), [
    ["Startseite", "https://site.test/de"],
    ["Doku", "https://site.test/de/doku"],
    ["Installation", "https://site.test/de/doku/installation"],
  ]);
  assert.deepEqual(await breadcrumbOf(await visit("/de/articles/hallo/kommentare")), [
    ["Startseite", "https://site.test/de"],
    ["Hallo", "https://site.test/de/articles/hallo"],
    ["Kommentare", "https://site.test/de/articles/hallo/kommentare"],
  ]);
});

void test("a draft's crumbs come from the draft", async (t) => {
  mockApi(t);
  assert.deepEqual(
    await breadcrumbOf(await visit("/docs/install?camox-draft=d1", { cookie: MEMBER_SESSION })),
    [
      ["Home", "https://site.test/"],
      ["Documentation", "https://site.test/docs"],
      ["Install", "https://site.test/docs/install"],
    ],
  );
});

void test("reading a page's ancestors takes as many API requests however deep the page is", async (t) => {
  const shallow = mockApi(t);
  await breadcrumbOf(await visit("/a/b"));
  const deep = mockApi(t);
  assert.deepEqual(await breadcrumbOf(await visit("/a/b/c/d/e")), [
    ["Home", "https://site.test/"],
    ["Shallow", "https://site.test/a/b"],
    ["Deep", "https://site.test/a/b/c/d/e"],
  ]);
  assert.equal(deep.length, shallow.length);
});
