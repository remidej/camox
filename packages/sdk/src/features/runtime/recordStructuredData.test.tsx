import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { LOCALE_HEADER } from "@camox/api-contract/drafts";
import * as React from "react";

import { createApp } from "../../core/createApp";
import { createCollection } from "../../core/createCollection";
import { createLayout } from "../../core/createLayout";
import { localesResponse, pageListResponse } from "./api.fixtures";
import { handleCamoxRequest, type RuntimeOptions } from "./runtime";

// Collection records are linked entities: each record has one node, with an `@id` per record and
// locale, which every page referencing the record links. The API evaluates records' nodes from
// their collections' templates; the runtime gives them their `@id`s, adds each once to the
// graphs that link them, lists the records content references but nothing places as the page's
// `mentions`, and makes a record page's record its main entity.

Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true, React });

// The image renderer, which the SDK imports through its own package exports, from source.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier !== "camox/_internal/imageResponse") return nextResolve(specifier, context);
    return nextResolve(new URL("../og/imageResponse.ts", import.meta.url).href, context);
  },
});

const project = { id: 1, name: "Real project", slug: "test", updatedAt: 1 };

const ADA = "0199f0a0-0000-7000-8000-0000000000a1";
const GRACE = "0199f0a0-0000-7000-8000-0000000000a2";
const ACME = "0199f0a0-0000-7000-8000-0000000000a3";
const POST = "0199f0a0-0000-7000-8000-0000000000a4";
const BO = "0199f0a0-0000-7000-8000-0000000000a5";
const BLOCKS = ["b1", "b2", "b3"].map((n) => `0199f0a0-0000-7000-8000-0000000000${n}`);

const FIRST_PUBLISHED = Date.UTC(2026, 0, 2, 9, 30);
const LAST_PUBLISHED = Date.UTC(2026, 5, 7, 16, 45);

const link = (id: string) => ({ "@id": `camox:record:${id}` });

/** Records' nodes as the API evaluates them, in each locale. */
const personNode = (locale: string) => ({
  "@type": "Person",
  "@id": `camox:record:${ADA}`,
  name: "Ada",
  description: locale === "de" ? "Schreibt über Inhalte" : "Writes about content",
  sameAs: "https://ada.test",
});
const NODES = (locale: string) => ({
  [ADA]: personNode(locale),
  [GRACE]: { "@type": "Person", "@id": `camox:record:${GRACE}`, name: "Grace" },
  [ACME]: { "@type": "Organization", "@id": `camox:record:${ACME}`, name: "Acme" },
});

/** Three testimonials by Ada about Acme, and a byline naming Grace that places no node. */
const HELP_BLOCKS = Object.fromEntries(
  BLOCKS.map((id, index) => [
    id,
    [
      {
        "@type": "Review",
        reviewBody: `Great ${index}`,
        author: link(ADA),
        itemReviewed: link(ACME),
      },
    ],
  ]),
);

/** The post a record page renders: by Ada, edited by Bo, whose staff have no Structured Data. */
const post = (locale: string) => ({
  id: POST,
  title: "Hello",
  description: "A first post",
  content: { title: "Hello", slug: "hello", author: ADA, editor: BO },
  references: {
    author: {
      id: ADA,
      collectionId: "people",
      title: "Ada",
      description: null,
      content: { name: "Ada" },
    },
    editor: { id: BO, collectionId: "staff", title: "Bo", description: null, content: {} },
  },
  updatedAt: 1,
  firstPublishedAt: FIRST_PUBLISHED,
  publishedAt: LAST_PUBLISHED,
  structuredData: {
    node: {
      "@type": "BlogPosting",
      "@id": `camox:record:${POST}`,
      headline: "Hello",
      author: link(ADA),
    },
    records: { nodes: { [ADA]: personNode(locale) }, referenced: [ADA] },
  },
});

const notFound = () =>
  Response.json(
    { json: { defined: false, code: "NOT_FOUND", status: 404, message: "Not found" } },
    { status: 404 },
  );

/** An API whose Live has a help page in English and German, and a post. */
function mockApi(t: { mock: { method: typeof test.mock.method } }) {
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const procedure = new URL(request.url).pathname.replace(/^\/rpc\//, "");
    const locale = request.headers.get(LOCALE_HEADER) ?? "en";
    const page = {
      id: "0199f0a0-0000-7000-8000-000000000001",
      fullPath: "/help",
      layoutId: "regular",
      metaTitle: "Help",
      metaDescription: "Answers",
      firstPublishedAt: null,
      publishedAt: null,
    };
    if (procedure === "projects/getByUuid") return notFound();
    if (procedure === "locales/list") return localesResponse(["en", "de"]);
    if (procedure === "pages/listBySlug")
      return pageListResponse([{ ...page, nickname: "Help", updatedAt: 1 }], project.name);
    if (procedure === "pages/getByPath") {
      const { json: input } = (await request.json()) as { json: { path: string } };
      if (input.path !== page.fullPath) return notFound();
      return Response.json({
        json: {
          page: { ...page, pathSegment: "help", blockIds: BLOCKS, locale },
          layout: { id: 1, layoutId: "regular", beforeBlockIds: [], afterBlockIds: [] },
          project,
          projectName: project.name,
          blocks: [],
          files: [],
          repeatableItems: [],
          structuredData: HELP_BLOCKS,
          recordStructuredData: { nodes: NODES(locale), referenced: [ADA, GRACE] },
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
          structuredData: {},
          recordStructuredData: { nodes: {}, referenced: [] },
        },
      });
    }
    if (procedure === "collectionDefinitions/findRecordsByField") {
      const { json: input } = (await request.json()) as { json: { value: string } };
      return Response.json({ json: input.value === "hello" ? [post(locale)] : [] });
    }
    if (procedure === "collectionDefinitions/listRecordPageValues") {
      return Response.json({ json: [{ id: POST, value: "hello", title: "Hello" }] });
    }
    throw new Error(`Unexpected API request ${procedure}`);
  });
}

const people = createCollection({
  id: "people",
  title: "People",
  description: "",
  content: (field) => ({ name: field.string() }),
  toTitle: ({ content }) => content.name,
  toDescription: () => undefined,
  toStructuredData: () => ({ "@type": "Person" }),
});
const staff = createCollection({
  id: "staff",
  title: "Staff",
  description: "",
  content: (field) => ({ name: field.string() }),
  toTitle: ({ content }) => content.name,
  toDescription: () => undefined,
});
const posts = createCollection({
  id: "posts",
  title: "Posts",
  description: "",
  content: (field) => ({
    title: field.string(),
    slug: field.string(),
    author: field.reference(people),
    editor: field.reference(staff),
  }),
  toTitle: ({ content }) => content.title,
  toDescription: () => undefined,
  toStructuredData: ({ content }) => ({ "@type": "BlogPosting", author: content.author }),
});

const layoutOptions = {
  description: "",
  blocks: { before: [], after: [] },
  toReact: () => <main />,
  toTitle: ({ page }: { page: { title: string } }) => page.title,
};

const app = createApp({
  blocks: [],
  collections: [people, staff, posts],
  layouts: [
    createLayout("regular")({
      ...layoutOptions,
      title: "Regular",
      kind: "curated",
      toDescription: ({ page }) => page.description,
    }),
    createLayout("blog.$slug")({
      ...layoutOptions,
      title: "Blog post",
      kind: "derived",
      ...posts.pages({ by: "slug", param: "slug" }),
      toDescription: () => undefined,
      toStructuredData: ({ content }) => ({
        "@type": "BlogPosting",
        author: [content.author, content.editor].filter((author) => author !== undefined),
      }),
    }),
    createLayout("notes.$slug")({
      ...layoutOptions,
      title: "Note",
      kind: "derived",
      ...posts.pages({ by: "slug", param: "slug" }),
      toDescription: () => undefined,
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

type Node = Record<string, unknown> & { "@id"?: string; "@type"?: string | string[] };

/** The nodes of a page's JSON-LD graph. */
async function graphOf(path: string) {
  const response = await handleCamoxRequest(new Request(`https://site.test${path}`), options);
  assert.equal(response?.status, 200, path);
  const html = await response!.text();
  const script = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  const graph = (JSON.parse(script![1]!) as { "@graph": Node[] })["@graph"];
  const ofType = (type: string) => graph.filter((node) => [node["@type"]].flat().includes(type));
  const byId = (id: unknown) => graph.filter((node) => node["@id"] === id);
  const [website] = ofType("WebSite");
  const [page] = graph.filter(
    (node) => (node.isPartOf as { "@id"?: string })?.["@id"] === website?.["@id"],
  );
  return { graph, ofType, byId, page: page! };
}

const idOf = (value: unknown) => (value as { "@id"?: string } | undefined)?.["@id"];

void test("a blog post's author links the same Person node as a testimonial on another page", async (t) => {
  mockApi(t);
  const blog = await graphOf("/blog/hello");
  const help = await graphOf("/help");

  const [posting] = blog.ofType("BlogPosting");
  const [author] = [posting!.author].flat();
  const [person] = blog.byId(idOf(author));
  assert.equal(person?.["@type"], "Person");
  assert.equal(person?.name, "Ada");
  const [review] = help.ofType("Review");
  assert.equal(idOf(review!.author), idOf(author));
  assert.match(String(idOf(author)), /^https:\/\/site\.test\//);
});

void test("a record that three blocks reference appears once in the page's graph", async (t) => {
  mockApi(t);
  const { ofType, byId } = await graphOf("/help");

  const reviews = ofType("Review");
  assert.equal(reviews.length, 3);
  const id = idOf(reviews[0]!.author);
  for (const review of reviews) assert.equal(idOf(review.author), id);
  assert.equal(byId(id).length, 1);
  assert.equal(ofType("Organization").filter((node) => node.name === "Acme").length, 1);
});

void test("a reference to a collection without structured data reads as the record's title", async (t) => {
  mockApi(t);
  const { ofType } = await graphOf("/blog/hello");

  const [posting] = ofType("BlogPosting");
  assert.deepEqual([posting!.author].flat()[1], "Bo");
});

void test("a record page whose layout declares nothing has the record as its main entity, with its publish times", async (t) => {
  mockApi(t);
  const { page, byId } = await graphOf("/notes/hello");

  const [entity] = byId(idOf(page.mainEntity));
  assert.equal(entity?.["@type"], "BlogPosting");
  assert.equal(entity?.headline, "Hello");
  assert.deepEqual(entity?.mainEntityOfPage, { "@id": page["@id"] });
  assert.equal(entity?.datePublished, new Date(FIRST_PUBLISHED).toISOString());
  assert.equal(entity?.dateModified, new Date(LAST_PUBLISHED).toISOString());
  assert.equal(page.datePublished, new Date(FIRST_PUBLISHED).toISOString());
  assert.equal(page.dateModified, new Date(LAST_PUBLISHED).toISOString());
  // The record's node links its author, as on every other page.
  assert.equal(byId(idOf(entity?.author))[0]?.name, "Ada");
});

void test("a record page whose record is an article is an article in Open Graph", async (t) => {
  mockApi(t);
  const response = await handleCamoxRequest(new Request("https://site.test/notes/hello"), options);
  const html = await response!.text();

  assert.match(html, /<meta [^>]*property="og:type" content="article"/);
});

void test("referenced records no template places are the page's mentions", async (t) => {
  mockApi(t);
  const { page, byId } = await graphOf("/help");

  const mentions = [page.mentions ?? []].flat().map(idOf);
  assert.equal(mentions.length, 1);
  assert.equal(byId(mentions[0])[0]?.name, "Grace");
});

void test("a German page's record nodes have German content and German @ids", async (t) => {
  mockApi(t);
  const english = await graphOf("/help");
  const german = await graphOf("/de/help");

  const englishId = idOf(english.ofType("Review")[0]!.author);
  const germanId = idOf(german.ofType("Review")[0]!.author);
  assert.notEqual(germanId, englishId);
  assert.match(String(germanId), /^https:\/\/site\.test\/de/);
  assert.equal(german.byId(germanId)[0]?.description, "Schreibt über Inhalte");
});
