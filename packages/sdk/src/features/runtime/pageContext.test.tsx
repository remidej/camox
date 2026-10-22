import assert from "node:assert/strict";
import { test } from "node:test";

import * as React from "react";

import { createApp } from "../../core/createApp";
import { createCollection } from "../../core/createCollection";
import { createLayout } from "../../core/createLayout";
import { localesResponse, pageListResponse } from "./api.fixtures";
import { handleCamoxRequest, type RuntimeOptions } from "./runtime";

// Every layout `to*` option reads the same `page`: its undecorated title, which indexes such as
// llms.txt list it by too, and its first and last publish times while it is on Live.

Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true, React });

const project = { id: 1, name: "Real project", slug: "test", updatedAt: 1 };

const FIRST_PUBLISHED = Date.UTC(2026, 0, 2, 9, 30);
const LAST_PUBLISHED = Date.UTC(2026, 5, 7, 16, 45);
const RECORD_FIRST_PUBLISHED = Date.UTC(2025, 2, 3, 8, 0);
const RECORD_LAST_PUBLISHED = Date.UTC(2025, 4, 5, 12, 15);

/** Live's curated pages: one published, one never published and still without a meta title. */
const PAGES = [
  {
    id: "0199f0a0-0000-7000-8000-000000000001",
    fullPath: "/about",
    pathSegment: "about",
    nickname: "About page",
    metaTitle: "About us",
    firstPublishedAt: FIRST_PUBLISHED,
    publishedAt: LAST_PUBLISHED,
  },
  {
    id: "0199f0a0-0000-7000-8000-000000000002",
    fullPath: "/team",
    pathSegment: "team",
    nickname: "Our team",
    metaTitle: null,
    firstPublishedAt: null,
    publishedAt: null,
  },
].map((page) => ({ ...page, layoutId: "regular", metaDescription: null }));

const POST = {
  id: "0199f0a0-0000-7000-8000-0000000000a1",
  title: "Hello",
  description: null,
  content: { title: "Hello", slug: "hello" },
  updatedAt: 1,
  firstPublishedAt: RECORD_FIRST_PUBLISHED,
  publishedAt: RECORD_LAST_PUBLISHED,
};

const notFound = () =>
  Response.json(
    { json: { defined: false, code: "NOT_FOUND", status: 404, message: "Not found" } },
    { status: 404 },
  );

function mockApi(t: { mock: { method: typeof test.mock.method } }) {
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const procedure = new URL(request.url).pathname.replace(/^\/rpc\//, "");
    if (procedure === "projects/getByUuid") return notFound();
    if (procedure === "locales/list") return localesResponse(["en"]);
    if (procedure === "pages/listBySlug")
      return pageListResponse(
        PAGES.map((page) => ({ ...page, updatedAt: 1 })),
        project.name,
      );
    if (procedure === "pages/getByPath") {
      const { json: input } = (await request.json()) as { json: { path: string } };
      const page = PAGES.find(({ fullPath }) => fullPath === input.path);
      if (!page) return notFound();
      return Response.json({
        json: {
          page: { ...page, blockIds: [], locale: "en" },
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
    if (procedure === "collectionDefinitions/findRecordsByField") {
      const { json: input } = (await request.json()) as { json: { value: string } };
      return Response.json({ json: input.value === "hello" ? [POST] : [] });
    }
    if (procedure === "collectionDefinitions/listRecordPageValues")
      return Response.json({ json: [{ id: POST.id, value: "hello", title: POST.title }] });
    throw new Error(`Unexpected API request ${procedure}`);
  });
}

const posts = createCollection({
  id: "posts",
  title: "Posts",
  description: "",
  content: (field) => ({ title: field.string(), slug: field.string() }),
  toTitle: ({ content }) => content.title,
  toDescription: () => undefined,
});

/** A description stating when the page was published, as every layout here writes it. */
const publishTimes = ({ page }: { page: { firstPublishedAt?: Date; lastPublishedAt?: Date } }) =>
  `first ${page.firstPublishedAt?.toISOString() ?? "never"}, last ${
    page.lastPublishedAt?.toISOString() ?? "never"
  }`;

const layoutOptions = {
  description: "",
  blocks: { before: [], after: [] },
  toReact: () => <main />,
  toTitle: ({ page }: { page: { title: string } }) => page.title,
  toDescription: publishTimes,
};

const app = createApp({
  blocks: [],
  collections: [posts],
  layouts: [
    createLayout("regular")({ ...layoutOptions, title: "Regular", kind: "curated" }),
    createLayout("blog.$slug")({
      ...layoutOptions,
      title: "Blog post",
      kind: "derived",
      ...posts.pages({ by: "slug", param: "slug" }),
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

/** A page's head title and description. */
async function readHead(path: string) {
  const response = await visit(path);
  assert.equal(response?.status, 200, path);
  const html = await response!.text();
  return {
    title: html.match(/<title>([^<]*)<\/title>/)?.[1],
    description: html.match(/<meta name="description" content="([^"]*)"/)?.[1],
  };
}

void test("a curated page's layout reads when the page was first and last published to Live", async (t) => {
  mockApi(t);
  const { description } = await readHead("/about");
  assert.equal(
    description,
    `first ${new Date(FIRST_PUBLISHED).toISOString()}, last ${new Date(LAST_PUBLISHED).toISOString()}`,
  );
});

void test("a curated page never published to Live has no publish times", async (t) => {
  mockApi(t);
  const { description } = await readHead("/team");
  assert.equal(description, "first never, last never");
});

void test("a record page's layout reads when its record was first and last published to Live", async (t) => {
  mockApi(t);
  const { description } = await readHead("/blog/hello");
  assert.equal(
    description,
    `first ${new Date(RECORD_FIRST_PUBLISHED).toISOString()}, last ${new Date(
      RECORD_LAST_PUBLISHED,
    ).toISOString()}`,
  );
});

void test("a curated page without a meta title has the same title in its head and in llms.txt", async (t) => {
  mockApi(t);
  const { title } = await readHead("/team");
  assert.equal(title, "Our team");
  const llms = await (await visit("/llms.txt"))!.text();
  assert.match(llms, /- \[Our team\]\(https:\/\/site\.test\/team\.md\)/);
});
