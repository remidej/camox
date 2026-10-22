import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { LOCALE_HEADER } from "@camox/api-contract/drafts";
import * as React from "react";

import { createApp } from "../../core/createApp";
import { createCollection } from "../../core/createCollection";
import { createLayout } from "../../core/createLayout";
import { localesResponse, pageListResponse } from "./api.fixtures";
import { renderPageWithApp } from "./pageServer";
import { handleCamoxRequest, type RuntimeOptions } from "./runtime";

// Every layout output is a `to*` option receiving one context: the page (its undecorated title,
// description, path and locale), the project, the loader's data and params on code-owned pages,
// and the record's values as `content` on record pages. The old option names keep working.

Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true, React });

// The image renderer is the built package's wasm module: a plain response stands in for it.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier !== "camox/_internal/imageResponse") return nextResolve(specifier, context);
    const body = "export class ImageResponse extends Response {}";
    return { url: `data:text/javascript,${encodeURIComponent(body)}`, shortCircuit: true };
  },
});

const project = { id: 1, name: "Real project", slug: "test", updatedAt: 1 };
const PRICING = "0199f0a0-0000-7000-8000-000000000001";
const HELLO = "0199f0a0-0000-7000-8000-0000000000a1";

/** Each locale's curated page, with its editor metadata. */
const PAGES: Record<string, { fullPath: string; metaTitle: string; metaDescription: string }> = {
  en: { fullPath: "/pricing", metaTitle: "Pricing", metaDescription: "What it costs" },
  de: { fullPath: "/preise", metaTitle: "Preise", metaDescription: "Was es kostet" },
};

/** Each locale's article record. */
const ARTICLES: Record<string, { title: string; slug: string; summary: string }> = {
  en: { title: "Hello", slug: "hello", summary: "A greeting" },
  de: { title: "Hallo", slug: "hallo", summary: "Ein Gruß" },
};

const notFound = () =>
  Response.json(
    { json: { defined: false, code: "NOT_FOUND", status: 404, message: "Not found" } },
    { status: 404 },
  );

/** An API whose Live has English, the default locale, and German. */
function mockApi(t: { mock: { method: typeof test.mock.method } }) {
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const procedure = new URL(request.url).pathname.replace(/^\/rpc\//, "");
    const locale = request.headers.get(LOCALE_HEADER) ?? "en";
    if (procedure === "projects/getByUuid") return notFound();
    if (procedure === "locales/list") return localesResponse(["en", "de"]);
    if (procedure === "pages/listBySlug") return pageListResponse([], project.name);
    if (procedure === "pages/getByPath") {
      const { json: input } = (await request.json()) as { json: { path: string } };
      const page = PAGES[locale];
      if (!page || page.fullPath !== input.path) return notFound();
      return Response.json({
        json: {
          page: {
            id: PRICING,
            ...page,
            pathSegment: page.fullPath.slice(1),
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
    if (procedure === "blocks/getPageMarkdown")
      return Response.json({ json: { markdown: "# Page", blocks: [] } });
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
    if (procedure === "blocks/getLayoutMarkdown")
      return Response.json({ json: { before: "", after: "", projectName: project.name } });
    if (procedure === "collectionDefinitions/recordMarkdown")
      return Response.json({ json: "# Article" });
    if (procedure === "collectionDefinitions/findRecordsByField") {
      const { json: input } = (await request.json()) as { json: { value: string } };
      const article = ARTICLES[locale];
      return Response.json({
        json:
          article?.slug === input.value
            ? [{ id: HELLO, title: article.title, description: article.summary, content: article }]
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
}

const articles = createCollection({
  id: "articles",
  title: "Articles",
  description: "",
  content: (field) => ({ title: field.string(), slug: field.string(), summary: field.string() }),
  toTitle: ({ content }) => content.title,
  toDescription: () => undefined,
});

const visit = (
  layouts: Parameters<typeof createApp>[0]["layouts"],
  path: string,
  headers: Record<string, string> = {},
) => {
  const app = createApp({ blocks: [], collections: [articles], layouts });
  const options: RuntimeOptions = {
    apiUrl: "https://api.test",
    authenticationUrl: "https://auth.test",
    projectUuid: "test",
    getCamoxApp: async () => app,
    renderPage: (input) => renderPageWithApp({ ...input, camoxApp: app }),
  };
  return handleCamoxRequest(new Request(`https://site.test${path}`, { headers }), options);
};

/** Text as written in HTML, without its character references. */
function decode(html: string | undefined) {
  return html
    ?.replaceAll("&quot;", '"')
    .replaceAll("&#x2F;", "/")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

/** The title, description and Open Graph texts a page's head carries. */
async function headOf(response: Response | null) {
  assert.equal(response?.status, 200);
  const html = await response!.text();
  const head = html.slice(0, html.indexOf("</head>"));
  const meta = (attribute: string, name: string) =>
    decode(
      head
        .match(new RegExp(`<meta [^>]*${attribute}="${name}"[^>]*>`))?.[0]
        .match(/content="([^"]*)"/)?.[1],
    );
  return {
    title: decode(head.match(/<title>([^<]*)<\/title>/)?.[1]),
    description: meta("name", "description"),
    ogTitle: meta("property", "og:title"),
    ogDescription: meta("property", "og:description"),
  };
}

/** The front matter of a page's Markdown Representation. */
async function frontMatterOf(response: Response | null) {
  assert.equal(response?.status, 200);
  return (await response!.text()).match(/^---\n([\s\S]*?)\n---/)?.[1];
}

const shared = { description: "", blocks: { before: [], after: [] } };

void test("a layout's toTitle and toDescription build the head and front matter buildMetaTitle and buildMetaDescription did", async (t) => {
  mockApi(t);
  const before = [
    createLayout("regular")({
      ...shared,
      title: "Regular",
      kind: "curated",
      component: ({ children }) => children,
      buildMetaTitle: ({ pageMetaTitle, projectName }) => `${pageMetaTitle} | ${projectName}`,
      buildMetaDescription: ({ pageMetaDescription }) => `${pageMetaDescription}.`,
    }),
  ];
  const after = [
    createLayout("regular")({
      ...shared,
      title: "Regular",
      kind: "curated",
      toReact: ({ children }) => children,
      toTitle: ({ page, project }) => `${page.title} | ${project.name}`,
      toDescription: ({ page }) => `${page.description}.`,
    }),
  ];
  const expected = {
    title: "Preise | Real project",
    description: "Was es kostet.",
    ogTitle: "Preise | Real project",
    ogDescription: "Was es kostet.",
  };
  assert.deepEqual(await headOf(await visit(before, "/de/preise")), expected);
  assert.deepEqual(await headOf(await visit(after, "/de/preise")), expected);
  const markdown = { Accept: "text/markdown" };
  assert.equal(
    await frontMatterOf(await visit(after, "/de/preise", markdown)),
    await frontMatterOf(await visit(before, "/de/preise", markdown)),
  );
  assert.match(
    (await frontMatterOf(await visit(after, "/de/preise", markdown))) ?? "",
    /^title: "Preise \| Real project"\ndescription: "Was es kostet\."/,
  );
});

/** A layout of each kind, whose title states what its `toTitle` receives. */
function layoutsWith(toTitle: (context: Record<string, any>) => string) {
  return [
    createLayout("regular")({
      ...shared,
      title: "Regular",
      kind: "curated",
      toReact: ({ children }) => children,
      toTitle,
    }),
    createLayout("pokedex")({
      ...shared,
      title: "Pokedex",
      kind: "singleton",
      toReact: () => null,
      toTitle,
    }),
    createLayout("pokemon.$name")({
      ...shared,
      title: "Pokemon",
      kind: "derived",
      loader: async ({ params }) => ({ kind: "data", data: { name: params.name.toUpperCase() } }),
      toReact: () => null,
      toTitle,
    }),
    createLayout("articles.$slug")({
      ...shared,
      title: "Article",
      kind: "derived",
      ...articles.pages({ by: "slug", param: "slug" }),
      toReact: () => null,
      toTitle,
    }),
  ];
}

void test("page.title is the editor's meta title, the layout's title, or the record's title, beside the page's path, locale and project", async (t) => {
  mockApi(t);
  const layouts = layoutsWith(
    ({ page, project }) => `${page.title}|${page.path}|${page.locale}|${project.name}`,
  );
  const titleOf = async (path: string) => (await headOf(await visit(layouts, path))).title;
  assert.equal(await titleOf("/de/preise"), "Preise|/de/preise|de|Real project");
  assert.equal(await titleOf("/de/pokedex"), "Pokedex|/de/pokedex|de|Real project");
  assert.equal(await titleOf("/pokemon/pikachu"), "Pokemon|/pokemon/pikachu|en|Real project");
  assert.equal(await titleOf("/de/articles/hallo"), "Hallo|/de/articles/hallo|de|Real project");
});

void test("page.description is the editor's description on curated pages, the record's on record pages, and absent elsewhere", async (t) => {
  mockApi(t);
  const layouts = layoutsWith(({ page }) => page.description ?? "none");
  const titleOf = async (path: string) => (await headOf(await visit(layouts, path))).title;
  assert.equal(await titleOf("/de/preise"), "Was es kostet");
  assert.equal(await titleOf("/de/pokedex"), "none");
  assert.equal(await titleOf("/de/articles/hallo"), "Ein Gruß");
});

void test("toTitle and toDescription get the loader's data and params, and the record's values as content", async (t) => {
  mockApi(t);
  const layouts = layoutsWith(({ data, params, content }) =>
    JSON.stringify({ data, params, content }),
  );
  const titleOf = async (path: string) =>
    JSON.parse((await headOf(await visit(layouts, path))).title!);
  assert.deepEqual(await titleOf("/pokemon/pikachu"), {
    data: { name: "PIKACHU" },
    params: { name: "pikachu" },
  });
  assert.deepEqual(await titleOf("/de/articles/hallo"), {
    data: { id: HELLO, title: "Hallo", description: "Ein Gruß", content: ARTICLES.de },
    params: { slug: "hallo" },
    content: { title: "Hallo", slug: "hallo", summary: "Ein Gruß" },
  });
  assert.deepEqual(await titleOf("/de/preise"), {});
});

/** The text a page's `<main>` renders. */
async function mainOf(response: Response | null) {
  assert.equal(response?.status, 200);
  return decode((await response!.text()).match(/<main[^>]*>([\s\S]*?)<\/main>/)?.[1]);
}

void test("layouts render through toReact, with the page's context as props beside children", async (t) => {
  mockApi(t);
  const layouts = [
    createLayout("regular")({
      ...shared,
      title: "Regular",
      kind: "curated",
      toReact: ({ page, project, children }) => (
        <main>
          {`${page.title} in ${page.locale} at ${page.path}, by ${project.name}`}
          {children}
        </main>
      ),
      toTitle: ({ page }) => page.title,
    }),
    createLayout("articles.$slug")({
      ...shared,
      title: "Article",
      kind: "derived",
      ...articles.pages({ by: "slug", param: "slug" }),
      toReact: ({ page, params, content }) => (
        <main>{`${page.title}: ${content.summary} (${params.slug})`}</main>
      ),
      toTitle: ({ page }) => page.title,
    }),
  ];
  assert.equal(
    await mainOf(await visit(layouts, "/de/preise")),
    "Preise in de at /de/preise, by Real project",
  );
  assert.equal(await mainOf(await visit(layouts, "/de/articles/hallo")), "Hallo: Ein Gruß (hallo)");
});

void test("a layout's old component still renders the page", async (t) => {
  mockApi(t);
  const layout = createLayout("regular")({
    ...shared,
    title: "Regular",
    kind: "curated",
    component: ({ children }) => <main>Old{children}</main>,
    buildMetaTitle: ({ pageMetaTitle }) => pageMetaTitle,
  });
  assert.equal(await mainOf(await visit([layout], "/de/preise")), "Old");
});

void test("toImage renders the page's shared image from the page's context", async (t) => {
  mockApi(t);
  const received: unknown[] = [];
  const layout = createLayout("regular")({
    ...shared,
    title: "Regular",
    kind: "curated",
    toReact: ({ children }) => children,
    toTitle: ({ page, project }) => `${page.title} | ${project.name}`,
    toDescription: ({ page }) => `${page.description}.`,
    toImage: (context) => {
      received.push(context);
      return <div>{context.page.title}</div>;
    },
  });
  const html = await (await visit([layout], "/de/preise"))!.text();
  const ogImage = decode(html.match(/<meta property="og:image" content="([^"]*)"/)?.[1]);
  assert.ok(ogImage?.startsWith("https://site.test/og?"), ogImage);
  await visit([layout], ogImage!.slice("https://site.test".length));
  assert.deepEqual(received, [
    {
      page: { title: "Preise", description: "Was es kostet", path: "/de/preise", locale: "de" },
      project: { name: "Real project" },
    },
  ]);
});

void test("a layout's old buildOgImage still gets the built title", async (t) => {
  mockApi(t);
  const received: unknown[] = [];
  const layout = createLayout("pokedex")({
    ...shared,
    title: "Pokedex",
    kind: "singleton",
    component: () => null,
    buildMetaTitle: ({ pageMetaTitle, projectName }) => `${pageMetaTitle} | ${projectName}`,
    buildOgImage: (params) => {
      received.push(params);
      return <div>{params.title}</div>;
    },
  });
  const html = await (await visit([layout], "/pokedex"))!.text();
  const ogImage = decode(html.match(/<meta property="og:image" content="([^"]*)"/)?.[1]);
  await visit([layout], ogImage!.slice("https://site.test".length));
  assert.deepEqual(received, [
    { title: "Pokedex | Real project", description: "", projectName: "Real project" },
  ]);
});

void test("a record page's Markdown front matter comes from toTitle and toDescription", async (t) => {
  mockApi(t);
  const layout = createLayout("articles.$slug")({
    ...shared,
    title: "Article",
    kind: "derived",
    ...articles.pages({ by: "slug", param: "slug" }),
    toReact: () => null,
    toTitle: ({ page, project }) => `${page.title} | ${project.name}`,
    toDescription: ({ content }) => content.summary,
    toMarkdown: () => ["# Article"],
  });
  assert.equal(
    await frontMatterOf(await visit([layout], "/de/articles/hallo", { Accept: "text/markdown" })),
    [
      'title: "Hallo | Real project"',
      'description: "Ein Gruß"',
      'url: "https://site.test/de/articles/hallo"',
    ].join("\n"),
  );
});
