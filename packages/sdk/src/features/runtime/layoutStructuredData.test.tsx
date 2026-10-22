import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import * as React from "react";

import { createApp } from "../../core/createApp";
import { createLayout } from "../../core/createLayout";
import { localesResponse, pageListResponse } from "./api.fixtures";
import { handleCamoxRequest, type RuntimeOptions } from "./runtime";

// A layout's `toStructuredData` says what its pages are: a kind of web page, which the page's
// node becomes, or a main entity, which Camox emits as its own node, links to the page, and
// fills from what it knows about the page.

Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true, React });

// The image renderer, which the SDK imports through its own package exports, from source.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier !== "camox/_internal/imageResponse") return nextResolve(specifier, context);
    return nextResolve(new URL("../og/imageResponse.ts", import.meta.url).href, context);
  },
});

const project = { id: 1, name: "Real project", slug: "test", updatedAt: 1 };

const FIRST_PUBLISHED = Date.UTC(2026, 0, 2, 9, 30);
const LAST_PUBLISHED = Date.UTC(2026, 5, 7, 16, 45);

/** Live's curated pages, each with its layout. */
const PAGES = [
  { path: "/about", layoutId: "about", title: "About us", description: "Who we are" },
  { path: "/pricing", layoutId: "regular", title: "Pricing", description: "What it costs" },
  { path: "/notes", layoutId: "post", title: "Launch notes", description: "What shipped" },
  { path: "/news", layoutId: "news", title: "Big news", description: "We raised" },
].map((page, index) => ({
  id: `0199f0a0-0000-7000-8000-00000000000${index}`,
  fullPath: page.path,
  layoutId: page.layoutId,
  metaTitle: page.title,
  metaDescription: page.description,
  firstPublishedAt: FIRST_PUBLISHED,
  publishedAt: LAST_PUBLISHED,
}));

const notFound = () =>
  Response.json(
    { json: { defined: false, code: "NOT_FOUND", status: 404, message: "Not found" } },
    { status: 404 },
  );

/** An API whose Live has the pages above, in English only. */
function mockApi(t: { mock: { method: typeof test.mock.method } }) {
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const procedure = new URL(request.url).pathname.replace(/^\/rpc\//, "");
    if (procedure === "projects/getByUuid") return notFound();
    if (procedure === "locales/list") return localesResponse(["en"]);
    if (procedure === "pages/listBySlug")
      return pageListResponse(
        PAGES.map((page) => ({ ...page, nickname: page.fullPath, updatedAt: 1 })),
        project.name,
      );
    if (procedure === "pages/getByPath") {
      const { json: input } = (await request.json()) as { json: { path: string } };
      const page = PAGES.find(({ fullPath }) => fullPath === input.path);
      if (!page) return notFound();
      return Response.json({
        json: {
          page: { ...page, pathSegment: page.fullPath.slice(1), blockIds: [], locale: "en" },
          layout: { id: 1, layoutId: page.layoutId, beforeBlockIds: [], afterBlockIds: [] },
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
    throw new Error(`Unexpected API request ${procedure}`);
  });
}

const curated = {
  description: "",
  blocks: { before: [], after: [] },
  toReact: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  toTitle: ({ page, project }: { page: { title: string }; project: { name: string } }) =>
    `${page.title} | ${project.name}`,
  toDescription: ({ page }: { page: { description: string | undefined } }) => page.description,
};

/** What the store's loader finds for each product. */
const PRODUCTS: Record<string, { name: string; price: number }> = {
  lamp: { name: "Desk lamp", price: 49 },
};

const app = createApp({
  blocks: [],
  layouts: [
    createLayout("regular")({ ...curated, kind: "curated", title: "Regular" }),
    createLayout("about")({
      ...curated,
      kind: "curated",
      title: "About",
      toStructuredData: () => ({ "@type": "AboutPage" }),
    }),
    createLayout("post")({
      ...curated,
      kind: "curated",
      title: "Post",
      toStructuredData: () => ({ "@type": "BlogPosting" }),
    }),
    createLayout("news")({
      ...curated,
      kind: "curated",
      title: "News",
      toStructuredData: () => ({
        "@type": "NewsArticle",
        headline: "Set by the layout",
        datePublished: "2025-12-24T00:00:00.000Z",
      }),
    }),
    createLayout("blog.$slug")({
      title: "Blog post",
      description: "",
      kind: "derived",
      blocks: { before: [], after: [] },
      loader: async ({ params }) => ({ kind: "data", data: { slug: params.slug, words: 812 } }),
      toReact: () => <main />,
      toTitle: ({ params, project }) => `${params.slug} | ${project.name}`,
      toDescription: ({ params }) => `A post about ${params.slug}`,
      toStructuredData: ({ data }) => ({ "@type": "BlogPosting", wordCount: data.words }),
    }),
    createLayout("products.$slug")({
      title: "Product",
      description: "",
      kind: "derived",
      blocks: { before: [], after: [] },
      loader: async ({ params }) => ({ kind: "data", data: PRODUCTS[params.slug]! }),
      toReact: () => <main />,
      toTitle: ({ data }) => data.name,
      toDescription: () => undefined,
      toStructuredData: ({ data }) => ({
        "@type": "Product",
        offers: { price: data.price, priceCurrency: "EUR" },
      }),
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

const visit = (path: string) =>
  handleCamoxRequest(new Request(`https://site.test${path}`), options);

type Node = Record<string, unknown> & { "@id"?: string; "@type"?: string | string[] };

const decode = (text: string) =>
  text.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'");

/** A page's head: its meta tags by name or property, and the nodes of its JSON-LD graph. */
async function readPage(path: string) {
  const response = await visit(path);
  assert.equal(response?.status, 200, path);
  const html = await response!.text();
  const head = html.slice(0, html.indexOf("</head>"));
  const scripts = [
    ...head.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g),
  ];
  assert.equal(scripts.length, 1, "one JSON-LD script");
  const graph = (JSON.parse(scripts[0]![1]!) as { "@graph": Node[] })["@graph"];
  const meta = (key: string) => {
    const tag = [...head.matchAll(/<meta [^>]*>/g)]
      .map((match) => match[0])
      .find((tag) => tag.includes(`name="${key}"`) || tag.includes(`property="${key}"`));
    const content = tag?.match(/content="([^"]*)"/)?.[1];
    return content === undefined ? undefined : decode(content);
  };
  const byId = (reference: unknown) =>
    graph.find((node) => node["@id"] === (reference as { "@id"?: string })?.["@id"]);
  const ofType = (type: string) => graph.filter((node) => [node["@type"]].flat().includes(type));
  return {
    graph,
    meta,
    byId,
    ofType,
    title: decode(head.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? ""),
    /** The page's own node: the one the WebSite contains. */
    pageNode: () => {
      const [website] = ofType("WebSite");
      const nodes = graph.filter(
        (node) => (node.isPartOf as { "@id"?: string })?.["@id"] === website?.["@id"],
      );
      assert.equal(nodes.length, 1, "one page node");
      return nodes[0]!;
    },
  };
}

void test("a layout returning a kind of web page makes its pages' node that kind, with Camox's defaults intact", async (t) => {
  mockApi(t);
  const about = await readPage("/about");
  const node = about.pageNode();
  assert.ok([node["@type"]].flat().includes("AboutPage"), String(node["@type"]));
  assert.equal(node.name, "About us | Real project");
  assert.equal(node.description, "Who we are");
  assert.equal(node.url, "https://site.test/about");
  assert.equal(node.inLanguage, "en");
  assert.equal(node.datePublished, "2026-01-02T09:30:00.000Z");
  assert.equal(node.dateModified, "2026-06-07T16:45:00.000Z");
  assert.ok(node.primaryImageOfPage);
  assert.equal(about.meta("og:type"), "website");

  // A layout that declares nothing keeps the plain WebPage.
  assert.deepEqual([(await readPage("/pricing")).pageNode()["@type"]].flat(), ["WebPage"]);
});

void test("a layout returning a main entity emits it as the page's main entity, filled from the page", async (t) => {
  mockApi(t);
  const post = await readPage("/blog/hello-world");
  const page = post.pageNode();
  const entity = post.byId(page.mainEntity);
  assert.ok(entity, "the page names its main entity");
  assert.equal(entity["@type"], "BlogPosting");
  assert.deepEqual(entity.mainEntityOfPage, { "@id": page["@id"] });
  assert.equal(entity.wordCount, 812, "what the layout says, from its loader's data");
  assert.equal(entity.headline, "hello-world | Real project");
  assert.equal(entity.headline, post.title);
  assert.equal(entity.description, "A post about hello-world");
  assert.equal(entity.url, "https://site.test/blog/hello-world");
  assert.equal(entity.inLanguage, "en");
  const [organization] = post.ofType("Organization");
  assert.deepEqual(entity.publisher, { "@id": organization!["@id"] });
  const image = (post.byId(entity.image) ?? entity.image) as Node;
  assert.equal(image.url, post.meta("og:image"));
  // The page itself stays a web page.
  assert.deepEqual([page["@type"]].flat(), ["WebPage"]);
});

void test("a main entity states when its page was first and last published", async (t) => {
  mockApi(t);
  const notes = await readPage("/notes");
  const entity = notes.byId(notes.pageNode().mainEntity)!;
  assert.equal(entity["@type"], "BlogPosting");
  assert.equal(entity.headline, "Launch notes | Real project");
  assert.equal(entity.datePublished, "2026-01-02T09:30:00.000Z");
  assert.equal(entity.dateModified, "2026-06-07T16:45:00.000Z");
});

void test("what the layout sets wins over what Camox fills", async (t) => {
  mockApi(t);
  const news = await readPage("/news");
  const entity = news.byId(news.pageNode().mainEntity)!;
  assert.equal(entity.headline, "Set by the layout");
  assert.equal(entity.datePublished, "2025-12-24T00:00:00.000Z");
  // What it leaves out is still filled.
  assert.equal(entity.dateModified, "2026-06-07T16:45:00.000Z");
  assert.equal(entity.description, "We raised");
});

void test("an Article main entity makes the page an article in Open Graph, other main entities don't", async (t) => {
  mockApi(t);
  assert.equal((await readPage("/blog/hello-world")).meta("og:type"), "article");
  assert.equal((await readPage("/notes")).meta("og:type"), "article");
  assert.equal((await readPage("/news")).meta("og:type"), "article");
  assert.equal((await readPage("/products/lamp")).meta("og:type"), "website");
  assert.equal((await readPage("/pricing")).meta("og:type"), "website");
});

void test("a main entity that isn't a creative work is named, not headlined, and has no publisher", async (t) => {
  mockApi(t);
  const lamp = await readPage("/products/lamp");
  const entity = lamp.byId(lamp.pageNode().mainEntity)!;
  assert.equal(entity["@type"], "Product");
  assert.equal(entity.name, "Desk lamp");
  assert.equal("headline" in entity, false);
  assert.equal("publisher" in entity, false);
  assert.equal("inLanguage" in entity, false);
  assert.equal(entity.url, "https://site.test/products/lamp");
  assert.deepEqual(entity.offers, { price: 49, priceCurrency: "EUR" });
});
