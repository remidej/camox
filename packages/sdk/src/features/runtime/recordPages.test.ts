import assert from "node:assert/strict";
import { test } from "node:test";

import { createApp } from "../../core/createApp";
import { createCollection } from "../../core/createCollection";
import { createLayout, type LayoutCollectionItemResult } from "../../core/createLayout";
import { plainTextToLexicalState } from "../../core/lib/lexicalState";
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

const PUBLISHED_ID = "00000000-0000-4000-8000-000000000001";
const DRAFT_ONLY_ID = "00000000-0000-4000-8000-000000000002";
const RICH_ID = "00000000-0000-4000-8000-000000000005";
const LINKED_ID = "00000000-0000-4000-8000-000000000006";
const AUTHOR = {
  id: "00000000-0000-4000-8000-000000000007",
  collectionId: "authors",
  label: "Ada",
  content: { name: "Ada" },
};
const TWIN_IDS = ["00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000004"];

type RecordsBySource = Record<
  "draft" | "live",
  Array<{ id: string; content: Record<string, unknown>; references?: unknown; version?: number }>
>;

/** Records by source, as the API's field lookup returns them for `slug`. */
const records: RecordsBySource = {
  draft: [
    { id: PUBLISHED_ID, content: { title: "Draft title", slug: "new-slug" } },
    { id: DRAFT_ONLY_ID, content: { title: "Draft only", slug: "draft-only" } },
    ...TWIN_IDS.map((id) => ({ id, content: { title: "Twin", slug: "twin" } })),
  ],
  live: [{ id: PUBLISHED_ID, content: { title: "Published title", slug: "old-slug" } }],
};

/** Published records whose fields and links layout.Item, Markdown and meta read. */
const withRenderedRecords: RecordsBySource = {
  draft: records.draft,
  live: [
    ...records.live,
    { id: RICH_ID, content: { title: plainTextToLexicalState("Rich title"), slug: "rich" } },
    {
      id: LINKED_ID,
      content: { title: "Linked", slug: "linked", author: AUTHOR.id },
      references: { author: AUTHOR },
    },
  ],
};

/** An API where only the valid session can read drafts, and only of this project. */
function mockApi(
  t: { mock: { method: typeof test.mock.method } },
  recordsBySource: RecordsBySource = records,
) {
  const lookups: Array<{ source: string; session: string | null }> = [];
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
    if (url.pathname.endsWith("/listBySlug")) return Response.json({ json: [] });
    if (url.pathname.endsWith("/getByPath"))
      return Response.json(
        { json: { defined: false, code: "NOT_FOUND", status: 404, message: "Not found" } },
        { status: 404 },
      );
    if (url.pathname.endsWith("/getLayoutMarkdown"))
      return Response.json({ json: { before: "Navbar", after: "Footer" } });
    if (url.pathname.endsWith("/collectionDefinitions/recordMarkdown")) {
      const { json: input } = (await request.json()) as { json: { id: string } };
      markdownRequests.push(input);
      // The API fills the builder's tokens with the live record, as its own tests show.
      return Response.json({ json: input.id === PUBLISHED_ID ? "# Published title" : "" });
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
        json: {
          projectSlug: string;
          collectionId: string;
          field: "slug";
          value: string;
          source: "draft" | "live";
        };
      };
      lookups.push({ source: input.source, session });
      if (input.source === "draft" && !session)
        return Response.json(
          { json: { defined: false, code: "UNAUTHORIZED", status: 401, message: "Sign in" } },
          { status: 401 },
        );
      assert.equal(input.projectSlug, "test");
      assert.equal(input.collectionId, "articles");
      return Response.json({
        json: recordsBySource[input.source].filter(
          (record) => record.content[input.field] === input.value,
        ),
      });
    }
    if (url.pathname.endsWith("/collectionDefinitions/listRecordPageValues")) {
      const { json: input } = (await request.json()) as {
        json: {
          projectSlug: string;
          collectionId: string;
          field: "slug";
          source: "draft" | "live";
        };
      };
      lookups.push({ source: input.source, session });
      if (input.source === "draft" && !session)
        return Response.json(
          { json: { defined: false, code: "UNAUTHORIZED", status: 401, message: "Sign in" } },
          { status: 401 },
        );
      assert.equal(input.projectSlug, "test");
      assert.equal(input.collectionId, "articles");
      return Response.json({
        json: recordsBySource[input.source].map((record) => ({
          id: record.id,
          value: record.content[input.field],
        })),
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  return Object.assign(lookups, { markdownRequests });
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

void test("editors read the record matching its draft value, visitors its published value", async (t) => {
  const lookups = mockApi(t);
  assert.deepEqual(await loadedRecord("/articles/new-slug", VALID_SESSION), {
    kind: "collection-item",
    collectionId: "articles",
    data: { id: PUBLISHED_ID, content: { title: "Draft title", slug: "new-slug" } },
  });
  assert.deepEqual(await loadedRecord("/articles/draft-only", VALID_SESSION), {
    kind: "collection-item",
    collectionId: "articles",
    data: { id: DRAFT_ONLY_ID, content: { title: "Draft only", slug: "draft-only" } },
  });
  assert.deepEqual(await loadedRecord("/articles/old-slug"), {
    kind: "collection-item",
    collectionId: "articles",
    data: { id: PUBLISHED_ID, content: { title: "Published title", slug: "old-slug" } },
  });
  const html = await request("/articles/old-slug");
  assert.match(await html!.text(), /<main>[^<]*Published title/);
  // Only draft reads carry the editor's session.
  assert.deepEqual(
    lookups.map(({ source, session }) => [source, session]),
    [
      ["draft", "valid"],
      ["draft", "valid"],
      ["live", null],
      ["live", null],
    ],
  );
});

void test("an editor previewing live content reads the record visitors see", async (t) => {
  const lookups = mockApi(t);
  const live = await request(
    "/_camox/data?path=/articles/old-slug&source=live",
    undefined,
    VALID_SESSION,
  );
  assert.equal(live!.status, 200);
  assert.deepEqual(((await live!.json()) as PageRenderInput).derived!.result, {
    kind: "collection-item",
    collectionId: "articles",
    data: { id: PUBLISHED_ID, content: { title: "Published title", slug: "old-slug" } },
  });
  // The draft slug has no live record.
  const draftSlug = await request(
    "/_camox/data?path=/articles/new-slug&source=live",
    undefined,
    VALID_SESSION,
  );
  assert.equal(draftSlug!.status, 404);
  // Asking for drafts never grants them to a visitor.
  const visitor = await request("/_camox/data?path=/articles/new-slug&source=draft");
  assert.equal(visitor!.status, 404);
  assert.deepEqual(
    lookups.map(({ source, session }) => [source, session]),
    [
      ["live", null],
      ["live", null],
      ["live", null],
    ],
  );
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

void test("an editor's record carries its draft version, which edits send as expected", async (t) => {
  mockApi(t, {
    draft: [{ id: PUBLISHED_ID, content: { title: "Draft", slug: "versioned" }, version: 7 }],
    live: [],
  });
  const loaded = (await loadedRecord("/articles/versioned", VALID_SESSION)) as {
    data: { version?: number };
  };
  assert.equal(loaded.data.version, 7);
});

void test("a slug no record has in the request's source is a 404", async (t) => {
  mockApi(t);
  for (const [path, cookie] of [
    ["/articles/missing", VALID_SESSION],
    ["/articles/old-slug", VALID_SESSION],
    ["/articles/new-slug", undefined],
    ["/articles/draft-only", undefined],
  ] as const) {
    const html = await request(path, undefined, cookie);
    assert.equal(html!.status, 404, `${path} ${cookie}`);
    const data = await request(`/_camox/data?path=${path}`, undefined, cookie);
    assert.equal(data!.status, 404, `${path} ${cookie}`);
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
  const response = await request("/_camox/data?path=/articles/old-slug", [wrapped]);
  const input = (await response!.json()) as PageRenderInput;
  assert.deepEqual(input.derived!.result, {
    kind: "collection-item",
    collectionId: "articles",
    data: { id: PUBLISHED_ID, content: { title: "Published title", slug: "old-slug" } },
  });
});

void test("the runtime rejects envelopes naming an unregistered collection or a malformed id", async (t) => {
  mockApi(t);
  for (const [collectionId, id] of [
    ["unknown", PUBLISHED_ID],
    ["articles", "not-a-record-id"],
  ]) {
    const layout = createLayout("articles.$slug")({
      ...layoutOptions,
      kind: "derived",
      loader: () => ({ kind: "collection-item", collectionId, data: { id, content: {} } }),
    });
    await assert.rejects(
      async () => request("/articles/old-slug", [layout]),
      /collection-item/,
      `${collectionId} ${id}`,
    );
  }
});

/** The records editors and visitors can reach, without the draft twins. */
const discoverable: RecordsBySource = {
  draft: records.draft.filter((record) => !TWIN_IDS.includes(record.id)),
  live: records.live,
};

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

void test("the sitemap lists published record pages only, even for an editor", async (t) => {
  const lookups = mockApi(t, discoverable);
  assert.deepEqual(await sitemapPaths(), ["/articles/old-slug"]);
  assert.deepEqual(await sitemapPaths(VALID_SESSION), ["/articles/old-slug"]);
  assert.deepEqual(
    lookups.map(({ source, session }) => [source, session]),
    [
      ["live", null],
      ["live", null],
    ],
  );
});

void test("the Canvas opens an editor on a draft-only record, and a visitor on nothing", async (t) => {
  mockApi(t, { draft: [records.draft[1]!], live: [] });
  assert.equal(await firstDiscoveredPath(VALID_SESSION), "/articles/draft-only");
  assert.equal(await firstDiscoveredPath(), null);
});

void test("an empty collection discovers no pages", async (t) => {
  mockApi(t, { draft: [], live: [] });
  assert.deepEqual(await sitemapPaths(), []);
  assert.equal(await firstDiscoveredPath(VALID_SESSION), null);
});

void test("every discovered page loads its record in the same source", async (t) => {
  mockApi(t, discoverable);
  for (const path of await sitemapPaths())
    assert.equal(((await loadedRecord(path)) as LayoutCollectionItemResult).data.id, PUBLISHED_ID);
  const draftPath = await firstDiscoveredPath(VALID_SESSION);
  assert.equal(draftPath, "/articles/new-slug");
  const loaded = (await loadedRecord(draftPath!, VALID_SESSION)) as LayoutCollectionItemResult;
  assert.equal(loaded.data.id, PUBLISHED_ID);
});

void test("discovered entries name their record", async (t) => {
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
        params: { slug: "new-slug" },
        target: { kind: "collection-item", collectionId: "articles", id: PUBLISHED_ID },
      },
      {
        params: { slug: "draft-only" },
        target: { kind: "collection-item", collectionId: "articles", id: DRAFT_ONLY_ID },
      },
    ],
  });
});

void test("the routes endpoint finds the page of a record, in the editor's source", async (t) => {
  mockApi(t, discoverable);
  const pathOf = async (recordId: string, cookie?: string) => {
    const response = await request(
      `/_camox/routes?layoutId=articles.$slug&recordId=${recordId}`,
      undefined,
      cookie,
    );
    assert.equal(response!.status, 200);
    return ((await response!.json()) as { path: string | null }).path;
  };
  assert.equal(await pathOf(DRAFT_ONLY_ID, VALID_SESSION), "/articles/draft-only");
  assert.equal(await pathOf(PUBLISHED_ID, VALID_SESSION), "/articles/new-slug");
  assert.equal(await pathOf(PUBLISHED_ID), "/articles/old-slug");
  assert.equal(await pathOf(DRAFT_ONLY_ID), null);
});

void test("records sharing a value fail discovery, naming the layout and the records", async (t) => {
  mockApi(t, { draft: records.draft, live: [...records.live, ...records.draft.slice(2)] });
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
  const response = await request("/articles/old-slug", [layout], VALID_SESSION, "text/markdown");
  assert.equal(await response!.text(), "Navbar\n\n# Published title\n\nFooter");
  assert.deepEqual(lookups.markdownRequests, [
    {
      projectSlug: "test",
      collectionId: "articles",
      id: PUBLISHED_ID,
      toMarkdown: ["# {{title}}", "By {{author.name}}", PUBLISHED_ID],
    },
  ]);
  assert.deepEqual(
    lookups.map(({ source, session }) => [source, session]),
    [["live", null]],
  );
});

void test("meta callbacks get the record's fields as plain text", async (t) => {
  mockApi(t, withRenderedRecords);
  const layout = createLayout("articles.$slug")({
    ...layoutOptions,
    kind: "derived",
    ...articles.pages({ by: "slug", param: "slug" }),
    buildMetaTitle: ({ item, projectName }) => `${item.title} | ${projectName}`,
    buildMetaDescription: ({ item }) => `About ${item.slug}`,
  });
  const response = await request("/_camox/data?path=/articles/rich", [layout]);
  const { head } = (await response!.json()) as PageRenderInput & {
    head: { meta?: Array<Record<string, string>> };
  };
  assert.deepEqual(head.meta?.slice(0, 2), [
    { title: "Rich title | Real project" },
    { name: "description", content: "About rich" },
  ]);
});
