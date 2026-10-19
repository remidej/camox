import assert from "node:assert/strict";
import { test } from "node:test";

import { createApp } from "../../core/createApp";
import { createCollection } from "../../core/createCollection";
import { createLayout, type LayoutCollectionItemResult } from "../../core/createLayout";
import { plainTextToLexicalState } from "../../core/lib/lexicalState";
import { markdownBody, pageListResponse } from "./api.fixtures";
import { handleCamoxRequest, type PageRenderInput, type RuntimeOptions } from "./runtime";

const VALID_SESSION = "camox_auth_cookie=valid";

const authors = createCollection({
  id: "authors",
  title: "Authors",
  description: "",
  content: (field) => ({ name: field.string() }),
  label: "name",
});

const articles = createCollection({
  id: "articles",
  title: "Articles",
  description: "",
  content: (field) => ({
    title: field.string(),
    slug: field.string(),
    author: field.reference(authors),
  }),
  label: "title",
});

const layoutOptions = {
  title: "Article",
  description: "",
  blocks: { before: [], after: [] },
  component: () => null,
  buildMetaTitle: ({ pageMetaTitle }: { pageMetaTitle: string }) => pageMetaTitle,
};

const FIRST_ID = "00000000-0000-4000-8000-000000000001";
const SECOND_ID = "00000000-0000-4000-8000-000000000002";
const RICH_ID = "00000000-0000-4000-8000-000000000005";
const LINKED_ID = "00000000-0000-4000-8000-000000000006";
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000008";
const AUTHOR = {
  id: "00000000-0000-4000-8000-000000000007",
  collectionId: "authors",
  label: "Ada",
  content: { name: "Ada" },
};
const TWIN_IDS = ["00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000004"];

type MockRecord = {
  id: string;
  content: Record<string, unknown>;
  references?: unknown;
  updatedAt?: number;
};

const first: MockRecord = { id: FIRST_ID, content: { title: "First title", slug: "first" } };
const second: MockRecord = { id: SECOND_ID, content: { title: "Second title", slug: "second" } };
const twins: MockRecord[] = TWIN_IDS.map((id) => ({
  id,
  content: { title: "Twin", slug: "twin" },
}));

/** Records with their current content, as the API's field lookup returns them for `slug`. */
const records: MockRecord[] = [first, second, ...twins];

/** Records whose fields and links layout.Item, Markdown and meta read. */
const withRenderedRecords: MockRecord[] = [
  ...records,
  { id: RICH_ID, content: { title: plainTextToLexicalState("Rich title"), slug: "rich" } },
  {
    id: LINKED_ID,
    content: { title: "Linked", slug: "linked", author: AUTHOR.id },
    references: { author: AUTHOR },
  },
];

/** The records route discovery can list, without the twins. */
const discoverable: MockRecord[] = [first, second];

/** An API where only the valid session is signed in; records are readable by anyone. */
function mockApi(t: { mock: { method: typeof test.mock.method } }, apiRecords = records) {
  const lookups: Array<Record<string, unknown>> = [];
  const markdownRequests: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const url = new URL(request.url);
    const session = request.headers.get("Better-Auth-Cookie");
    if (session && session !== "valid")
      return Response.json(
        { json: { defined: false, code: "UNAUTHORIZED", status: 401, message: "Session expired" } },
        { status: 401 },
      );
    if (url.pathname.endsWith("/getBySlug"))
      return Response.json({ json: { id: 1, name: "Real project", slug: "test", updatedAt: 1 } });
    if (url.pathname.endsWith("/listBySlug")) return pageListResponse();
    if (url.pathname.endsWith("/getByPath"))
      return Response.json(
        { json: { defined: false, code: "NOT_FOUND", status: 404, message: "Not found" } },
        { status: 404 },
      );
    if (url.pathname.endsWith("/getLayoutMarkdown"))
      return Response.json({
        json: { before: "Navbar", after: "Footer", projectName: "Real project" },
      });
    if (url.pathname.endsWith("/collectionDefinitions/recordMarkdown")) {
      const { json: input } = (await request.json()) as { json: { id: string } };
      markdownRequests.push(input);
      // The API fills the builder's tokens with the record's content, as its own tests show.
      return Response.json({ json: input.id === FIRST_ID ? "# First title" : "" });
    }
    if (url.pathname.endsWith("/layouts/get"))
      return Response.json({
        json: {
          projectName: "Real project",
          project: { id: 1, updatedAt: 1 },
          layout: { id: 2, layoutId: "articles.$slug", beforeBlockIds: [], afterBlockIds: [] },
          blocks: [],
          files: [],
          repeatableItems: [],
        },
      });
    if (url.pathname.endsWith("/collectionDefinitions/findRecordsByField")) {
      const { json: input } = (await request.json()) as {
        json: { projectSlug: string; collectionId: string; field: "slug"; value: string };
      };
      lookups.push(input);
      assert.equal(input.projectSlug, "test");
      assert.equal(input.collectionId, "articles");
      return Response.json({
        json: apiRecords.filter((record) => record.content[input.field] === input.value),
      });
    }
    if (url.pathname.endsWith("/collectionDefinitions/listRecordPageValues")) {
      const { json: input } = (await request.json()) as {
        json: { projectSlug: string; collectionId: string; field: "slug" };
      };
      lookups.push(input);
      assert.equal(input.projectSlug, "test");
      assert.equal(input.collectionId, "articles");
      return Response.json({
        json: apiRecords.map((record) => ({
          id: record.id,
          value: record.content[input.field],
          label: record.content.title,
        })),
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  return Object.assign(lookups, { markdownRequests });
}

/** Asserts how many record lookups went out, and that none named a source. */
function assertLookupsWithoutSource(lookups: Array<Record<string, unknown>>, count: number) {
  assert.equal(lookups.length, count);
  for (const lookup of lookups) assert.ok(!("source" in lookup), JSON.stringify(lookup));
}

function request(
  path: string,
  layout: Parameters<typeof createApp>[0]["layouts"] = [
    createLayout("articles.$slug")({
      ...layoutOptions,
      kind: "derived",
      ...articles.pages({ by: "slug", param: "slug" }),
    }),
  ],
  cookie?: string,
  accept?: string,
) {
  const options: RuntimeOptions = {
    apiUrl: "https://api.test",
    authenticationUrl: "https://auth.test",
    projectSlug: "test",
    getCamoxApp: async () =>
      createApp({ blocks: [], layouts: layout, collections: [articles, authors] }),
    renderPage: async (input) => `<main>${JSON.stringify(input.derived?.result)}</main>`,
  };
  const headers: Record<string, string> = {
    ...(cookie ? { Cookie: cookie } : {}),
    ...(accept ? { Accept: accept } : {}),
  };
  return handleCamoxRequest(new Request(`https://site.test${path}`, { headers }), options);
}

async function loadedRecord(path: string, cookie?: string) {
  const response = await request(`/_camox/data?path=${path}`, undefined, cookie);
  assert.equal(response!.status, 200, path);
  return ((await response!.json()) as PageRenderInput).derived!.result;
}

void test("editors and visitors read the record's current content, without naming a source", async (t) => {
  const lookups = mockApi(t);
  const expected = {
    kind: "collection-item",
    collectionId: "articles",
    data: { id: FIRST_ID, content: { title: "First title", slug: "first" } },
  };
  assert.deepEqual(await loadedRecord("/articles/first", VALID_SESSION), expected);
  assert.deepEqual(await loadedRecord("/articles/first"), expected);
  const live = await request(
    "/_camox/data?path=/articles/first&source=live",
    undefined,
    VALID_SESSION,
  );
  assert.deepEqual(((await live!.json()) as PageRenderInput).derived!.result, expected);
  const html = await request("/articles/first");
  assert.match(await html!.text(), /<main>[^<]*First title/);
  assertLookupsWithoutSource(lookups, 4);
});

void test("the record's resolved references travel in the envelope, for layout.Item", async (t) => {
  mockApi(t, withRenderedRecords);
  assert.deepEqual(await loadedRecord("/articles/linked"), {
    kind: "collection-item",
    collectionId: "articles",
    data: {
      id: LINKED_ID,
      content: { title: "Linked", slug: "linked", author: AUTHOR.id },
      references: { author: AUTHOR },
    },
  });
});

void test("the record's last content change travels in the envelope", async (t) => {
  mockApi(t, [{ id: FIRST_ID, content: { title: "Dated", slug: "dated" }, updatedAt: 1700 }]);
  const loaded = (await loadedRecord("/articles/dated", VALID_SESSION)) as {
    data: { updatedAt?: number };
  };
  assert.equal(loaded.data.updatedAt, 1700);
});

void test("a slug no record has is a 404", async (t) => {
  mockApi(t);
  for (const cookie of [VALID_SESSION, undefined]) {
    const html = await request("/articles/missing", undefined, cookie);
    assert.equal(html!.status, 404, `${cookie}`);
    const data = await request("/_camox/data?path=/articles/missing", undefined, cookie);
    assert.equal(data!.status, 404, `${cookie}`);
  }
});

void test("several records sharing the value fail loudly, naming them", async (t) => {
  mockApi(t);
  await assert.rejects(
    async () => request("/articles/twin", undefined, VALID_SESSION),
    (error: Error) => {
      for (const part of ["articles", "slug", "twin", ...TWIN_IDS])
        assert.ok(error.message.includes(part), `${error.message} names ${part}`);
      return true;
    },
  );
});

void test("a wrapper that passes the context through and returns the envelope works", async (t) => {
  mockApi(t);
  const { loader } = articles.pages({ by: "slug", param: "slug" });
  const wrapped = createLayout("articles.$slug")({
    ...layoutOptions,
    kind: "derived",
    loader: async (input): Promise<LayoutCollectionItemResult> => {
      const result = await loader(input);
      return result;
    },
  });
  const response = await request("/_camox/data?path=/articles/first", [wrapped]);
  const input = (await response!.json()) as PageRenderInput;
  assert.deepEqual(input.derived!.result, {
    kind: "collection-item",
    collectionId: "articles",
    data: { id: FIRST_ID, content: { title: "First title", slug: "first" } },
  });
});

void test("the runtime rejects envelopes naming an unregistered collection or a malformed id", async (t) => {
  mockApi(t);
  for (const [collectionId, id] of [
    ["unknown", FIRST_ID],
    ["articles", "not-a-record-id"],
  ]) {
    const layout = createLayout("articles.$slug")({
      ...layoutOptions,
      kind: "derived",
      loader: () => ({ kind: "collection-item", collectionId, data: { id, content: {} } }),
    });
    await assert.rejects(
      async () => request("/articles/first", [layout]),
      /collection-item/,
      `${collectionId} ${id}`,
    );
  }
});

async function sitemapPaths(cookie?: string) {
  const response = await request("/sitemap.xml", undefined, cookie);
  assert.equal(response!.status, 200);
  const xml = await response!.text();
  return [...xml.matchAll(/<loc>https:\/\/site\.test([^<]*)<\/loc>/g)].map(([, path]) => path);
}

async function firstDiscoveredPath(cookie?: string) {
  const response = await request("/_camox/routes?layoutId=articles.$slug", undefined, cookie);
  assert.equal(response!.status, 200);
  return ((await response!.json()) as { path: string | null }).path;
}

void test("the sitemap lists every record page, for visitors and editors alike", async (t) => {
  const lookups = mockApi(t, discoverable);
  assert.deepEqual(await sitemapPaths(), ["/articles/first", "/articles/second"]);
  assert.deepEqual(await sitemapPaths(VALID_SESSION), ["/articles/first", "/articles/second"]);
  assertLookupsWithoutSource(lookups, 2);
});

void test("the Canvas opens editors and visitors on the first record page", async (t) => {
  mockApi(t, discoverable);
  assert.equal(await firstDiscoveredPath(VALID_SESSION), "/articles/first");
  assert.equal(await firstDiscoveredPath(), "/articles/first");
});

void test("an empty collection discovers no pages", async (t) => {
  mockApi(t, []);
  assert.deepEqual(await sitemapPaths(), []);
  assert.equal(await firstDiscoveredPath(VALID_SESSION), null);
});

void test("every discovered page loads its record", async (t) => {
  mockApi(t, discoverable);
  const loadedIds = [];
  for (const path of await sitemapPaths())
    loadedIds.push(((await loadedRecord(path)) as LayoutCollectionItemResult).data.id);
  assert.deepEqual(loadedIds, [FIRST_ID, SECOND_ID]);
});

void test("discovered entries name their record and its Label", async (t) => {
  mockApi(t, discoverable);
  const pages = articles.pages({ by: "slug", param: "slug" });
  let discovered: unknown;
  const layout = createLayout("articles.$slug")({
    ...layoutOptions,
    kind: "derived",
    ...pages,
    routes: async (input) => {
      discovered = await pages.routes(input);
      return pages.routes(input);
    },
  });
  await request("/_camox/routes?layoutId=articles.$slug", [layout], VALID_SESSION);
  assert.deepEqual(discovered, {
    data: [
      {
        params: { slug: "first" },
        target: {
          kind: "collection-item",
          collectionId: "articles",
          id: FIRST_ID,
          label: "First title",
        },
      },
      {
        params: { slug: "second" },
        target: {
          kind: "collection-item",
          collectionId: "articles",
          id: SECOND_ID,
          label: "Second title",
        },
      },
    ],
  });
});

void test("the routes endpoint finds the page of a record", async (t) => {
  const lookups = mockApi(t, discoverable);
  const pathOf = async (recordId: string, cookie?: string) => {
    const response = await request(
      `/_camox/routes?layoutId=articles.$slug&recordId=${recordId}`,
      undefined,
      cookie,
    );
    assert.equal(response!.status, 200);
    return ((await response!.json()) as { path: string | null }).path;
  };
  assert.equal(await pathOf(SECOND_ID, VALID_SESSION), "/articles/second");
  assert.equal(await pathOf(SECOND_ID), "/articles/second");
  assert.equal(await pathOf(UNKNOWN_ID, VALID_SESSION), null);
  assertLookupsWithoutSource(lookups, 3);
});

void test("records sharing a value fail discovery, naming the layout and the records", async (t) => {
  mockApi(t);
  t.mock.method(console, "error", () => {});
  for (const cookie of [undefined, VALID_SESSION]) {
    const sitemap = await request("/sitemap.xml", undefined, cookie);
    assert.equal(sitemap!.status, 500);
    const { message } = (await sitemap!.json()) as { message: string };
    for (const part of ["articles.$slug", "slug", "twin", ...TWIN_IDS])
      assert.ok(message.includes(part), `${message} names ${part}`);
  }
  const routes = await request("/_camox/routes?layoutId=articles.$slug", undefined, VALID_SESSION);
  assert.equal(routes!.status, 500);
});

void test("toMarkdown fills the record's fields between the live layout blocks, even for an editor", async (t) => {
  const lookups = mockApi(t);
  const layout = createLayout("articles.$slug")({
    ...layoutOptions,
    kind: "derived",
    ...articles.pages({ by: "slug", param: "slug" }),
    toMarkdown: ({ item, data }) => [`# ${item.title}`, `By ${item.author.name}`, data.id],
  });
  const response = await request("/articles/first", [layout], VALID_SESSION, "text/markdown");
  assert.equal(markdownBody(await response!.text()), "Navbar\n\n# First title\n\nFooter");
  assert.deepEqual(lookups.markdownRequests, [
    {
      projectSlug: "test",
      collectionId: "articles",
      id: FIRST_ID,
      toMarkdown: ["# {{title}}", "By {{author.name}}", FIRST_ID],
    },
  ]);
  assertLookupsWithoutSource(lookups, 1);
});

void test("meta callbacks get the record's fields as plain text, in the head and the Markdown", async (t) => {
  mockApi(t, withRenderedRecords);
  const layout = createLayout("articles.$slug")({
    ...layoutOptions,
    kind: "derived",
    ...articles.pages({ by: "slug", param: "slug" }),
    buildMetaTitle: ({ item, projectName }) => `${item.title} | ${projectName}`,
    buildMetaDescription: ({ item }) => `About ${item.slug}`,
    toMarkdown: ({ item }) => [`# ${item.title}`],
  });
  const response = await request("/_camox/data?path=/articles/rich", [layout]);
  const { head } = (await response!.json()) as PageRenderInput & {
    head: { meta?: Array<Record<string, string>> };
  };
  assert.deepEqual(head.meta?.slice(0, 2), [
    { title: "Rich title | Real project" },
    { name: "description", content: "About rich" },
  ]);

  const markdown = await request("/articles/rich", [layout], undefined, "text/markdown");
  assert.match(
    await markdown!.text(),
    /^---\ntitle: "Rich title \| Real project"\ndescription: "About rich"\nurl: "https:\/\/site.test\/articles\/rich"\n---\n\n/,
  );
});

void test("a record page layout syncs the collection and field its pages are found by", () => {
  const recordLayout = createLayout("articles.$slug")({
    ...layoutOptions,
    kind: "derived",
    ...articles.pages({ by: "slug", param: "slug" }),
  });
  const plain = createLayout("about")({ ...layoutOptions, kind: "singleton" });
  const app = createApp({ blocks: [], layouts: [recordLayout, plain], collections: [articles] });

  const synced = app.getSerializableLayoutDefinitions();
  assert.deepEqual(synced.find((layout) => layout.layoutId === "articles.$slug")?.recordPages, {
    collectionId: "articles",
    field: "slug",
  });
  assert.equal(synced.find((layout) => layout.layoutId === "about")?.recordPages, undefined);
});
