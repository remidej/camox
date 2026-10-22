import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { DRAFT_HEADER, LOCALE_HEADER } from "@camox/api-contract/drafts";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { createApp } from "../../core/createApp";
import { createCollection } from "../../core/createCollection";
import { createLayout } from "../../core/createLayout";
import { localesResponse, pageListResponse } from "./api.fixtures";
import { handleCamoxRequest, type RuntimeOptions } from "./runtime";

// `/og` renders the website's real pages: it loads the page its path names, runs its layout's
// loader, and renders the layout's `toImage`, or Camox's default image, with the page's context.

Object.assign(globalThis, {
  __CAMOX_TELEMETRY_DISABLED__: true,
  React,
  // The image renderer is the built package's wasm module: the image's markup stands in for it.
  __renderOgImage: (element: React.ReactElement) => renderToStaticMarkup(element),
});
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier !== "camox/_internal/imageResponse") return nextResolve(specifier, context);
    const body = `export class ImageResponse extends Response {
      constructor(element) { super(globalThis.__renderOgImage(element)); }
    }`;
    return { url: `data:text/javascript,${encodeURIComponent(body)}`, shortCircuit: true };
  },
});

const project = { id: 1, name: "Real project", slug: "test", updatedAt: 1 };
const PRICING = "0199f0a0-0000-7000-8000-000000000001";
const HELLO = "0199f0a0-0000-7000-8000-0000000000a1";

interface CuratedPage {
  fullPath: string;
  metaTitle: string;
  metaDescription: string;
  layoutId: string;
  customOgImageUrl?: string;
}

/** The API's Live: each locale's curated page and article record. */
interface Site {
  pages: Record<string, CuratedPage>;
  articles: Record<string, { title: string; slug: string; summary: string }>;
}

const defaultSite = (): Site => ({
  pages: {
    en: {
      fullPath: "/pricing",
      metaTitle: "Pricing",
      metaDescription: "What it costs",
      layoutId: "regular",
    },
    de: {
      fullPath: "/preise",
      metaTitle: "Preise",
      metaDescription: "Was es kostet",
      layoutId: "regular",
    },
  },
  articles: {
    en: { title: "Hello", slug: "hello", summary: "A greeting" },
    de: { title: "Hallo", slug: "hallo", summary: "Ein Gruß" },
  },
});

const notFound = () =>
  Response.json(
    { json: { defined: false, code: "NOT_FOUND", status: 404, message: "Not found" } },
    { status: 404 },
  );

/**
 * An API whose Live has English, the default locale, and German. Only the valid session is a
 * member, and a draft it names retitles the curated page.
 */
function mockApi(t: { mock: { method: typeof test.mock.method } }, site: Site = defaultSite()) {
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const procedure = new URL(request.url).pathname.replace(/^\/rpc\//, "");
    const locale = request.headers.get(LOCALE_HEADER) ?? "en";
    const member = request.headers.get("Better-Auth-Cookie") === "valid";
    const draft = member ? request.headers.get(DRAFT_HEADER) : null;
    if (procedure === "projects/getByUuid")
      return member ? Response.json({ json: project }) : notFound();
    if (procedure === "locales/list") return localesResponse(["en", "de"]);
    if (procedure === "pages/listBySlug") return pageListResponse([], project.name);
    if (procedure === "pages/getByPath") {
      const { json: input } = (await request.json()) as { json: { path: string } };
      const page = site.pages[locale];
      if (!page || page.fullPath !== input.path) return notFound();
      const { layoutId, ...row } = page;
      return Response.json({
        json: {
          page: {
            id: PRICING,
            ...row,
            ...(draft && { metaTitle: `${row.metaTitle} in ${draft}` }),
            pathSegment: page.fullPath.slice(1),
            blockIds: [],
            locale,
          },
          layout: { id: 1, layoutId, beforeBlockIds: [], afterBlockIds: [] },
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
      const article = site.articles[locale];
      return Response.json({
        json:
          article?.slug === input.value
            ? [{ id: HELLO, title: article.title, description: null, content: article }]
            : [],
      });
    }
    if (procedure === "collectionDefinitions/listRecordPageValues") {
      const article = site.articles[locale];
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

const shared = { description: "", blocks: { before: [], after: [] } };

const regular = createLayout("regular")({
  ...shared,
  title: "Regular",
  kind: "curated",
  toReact: ({ children }) => children,
  toTitle: ({ page, project }) => `${page.title} | ${project.name}`,
  toDescription: ({ page }) => page.description,
  toImage: ({ page }) => <h1>{`Image of ${page.title}`}</h1>,
});

type Layouts = Parameters<typeof createApp>[0]["layouts"];

const visit = (
  layouts: Layouts,
  path: string,
  headers: Record<string, string> = {},
): Promise<Response> => {
  const app = createApp({ blocks: [], collections: [articles], layouts });
  const options: RuntimeOptions = {
    apiUrl: "https://api.test",
    authenticationUrl: "https://auth.test",
    projectUuid: "test",
    getCamoxApp: async () => app,
    renderPage: async () => "<main></main>",
  };
  return handleCamoxRequest(new Request(`https://site.test${path}`, { headers }), options).then(
    (response) => response!,
  );
};

const decode = (value: string | undefined) => value?.replaceAll("&amp;", "&");

/** The `og:image` a page's head names. */
async function ogImageOf(layouts: Layouts, path: string): Promise<string | undefined> {
  const html = await (await visit(layouts, path)).text();
  return decode(html.match(/<meta property="og:image" content="([^"]*)"/)?.[1]);
}

/** The image a page's `og:image` names, fetched from the site. */
async function imageOf(layouts: Layouts, path: string): Promise<Response> {
  const url = await ogImageOf(layouts, path);
  assert.ok(url?.startsWith("https://site.test/og?path="), url);
  return visit(layouts, url!.slice("https://site.test".length));
}

void test("a page's og:image is /og for that page, showing its real title", async (t) => {
  mockApi(t);
  const image = await imageOf([regular], "/de/preise");
  assert.equal(image.status, 200);
  assert.equal(await image.text(), "<h1>Image of Preise</h1>");
});

void test("/og ignores a title in its query string", async (t) => {
  mockApi(t);
  const url = new URL((await ogImageOf([regular], "/de/preise"))!);
  url.searchParams.set("title", "Free money");
  url.searchParams.set("description", "Click here");
  const image = await visit([regular], `${url.pathname}${url.search}`);
  assert.equal(await image.text(), "<h1>Image of Preise</h1>");
});

void test("a record page's toImage reads the record's values", async (t) => {
  mockApi(t);
  const layout = createLayout("articles.$slug")({
    ...shared,
    title: "Article",
    kind: "derived",
    ...articles.pages({ by: "slug", param: "slug" }),
    toReact: () => null,
    toTitle: ({ page }) => page.title,
    toDescription: ({ content }) => content.summary,
    toImage: ({ content, params }) => (
      <h1>{`${content.title}: ${content.summary} (${params.slug})`}</h1>
    ),
  });
  const image = await imageOf([layout], "/de/articles/hallo");
  assert.equal(await image.text(), "<h1>Hallo: Ein Gruß (hallo)</h1>");
});

void test("a page with a custom image uses it", async (t) => {
  const site = defaultSite();
  site.pages.de!.customOgImageUrl = "https://api.test/files/serve/cover.png";
  mockApi(t, site);
  assert.equal(await ogImageOf([regular], "/de/preise"), "https://api.test/files/serve/cover.png");
});

void test("a layout without toImage gets Camox's default image", async (t) => {
  mockApi(t);
  const plain = createLayout("regular")({
    ...shared,
    title: "Regular",
    kind: "curated",
    toReact: ({ children }) => children,
    toTitle: ({ page }) => page.title,
    toDescription: ({ page }) => page.description,
  });
  const image = await imageOf([plain], "/de/preise");
  assert.equal(image.status, 200);
  const markup = await image.text();
  assert.match(markup, />Preise</);
  assert.match(markup, />Real project</);
});

void test("/og answers a repeat request with not modified until the page changes", async (t) => {
  const site = defaultSite();
  mockApi(t, site);
  const url = (await ogImageOf([regular], "/de/preise"))!.slice("https://site.test".length);
  const first = await visit([regular], url);
  const etag = first.headers.get("ETag");
  assert.ok(etag);
  assert.match(first.headers.get("Cache-Control") ?? "", /no-cache/);

  const repeat = await visit([regular], url, { "If-None-Match": etag });
  assert.equal(repeat.status, 304);
  assert.equal(await repeat.text(), "");

  site.pages.de!.metaTitle = "Neue Preise";
  const changed = await visit([regular], url, { "If-None-Match": etag });
  assert.equal(changed.status, 200);
  assert.equal(await changed.text(), "<h1>Image of Neue Preise</h1>");
  assert.notEqual(changed.headers.get("ETag"), etag);
});

void test("/og shows a member the draft its URL names, and nobody else", async (t) => {
  mockApi(t);
  const url = `${(await ogImageOf([regular], "/de/preise"))!.slice("https://site.test".length)}&camox-draft=spring`;
  const member = await visit([regular], url, { Cookie: "camox_auth_cookie=valid" });
  assert.equal(await member.text(), "<h1>Image of Preise in spring</h1>");
  assert.equal(member.headers.get("Cache-Control"), "private, no-store");
  const visitor = await visit([regular], url);
  assert.equal(await visitor.text(), "<h1>Image of Preise</h1>");
});

void test("/og answers not found for a path that isn't a page", async (t) => {
  mockApi(t);
  for (const query of [
    "?path=/de/nowhere",
    "?path=/nowhere",
    "?layoutId=regular&title=Free+money",
    "?path=/sitemap.xml",
    "",
  ]) {
    const response = await visit([regular], `/og${query}`);
    assert.equal(response.status, 404, query);
  }
});
