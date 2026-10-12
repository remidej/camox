import assert from "node:assert/strict";
import { test } from "node:test";

import { createApp } from "../../core/createApp";
import { createCollection } from "../../core/createCollection";
import { createLayout, type LayoutCollectionItemResult } from "../../core/createLayout";
import { handleCamoxRequest, type PageRenderInput, type RuntimeOptions } from "./runtime";

const VALID_SESSION = "camox_auth_cookie=valid";

const articles = createCollection({
  id: "articles",
  title: "Articles",
  description: "",
  content: (field) => ({ title: field.string(), slug: field.string() }),
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
const TWIN_IDS = ["00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000004"];

/** Records by source, as the API's field lookup returns them for `slug`. */
const records = {
  draft: [
    { id: PUBLISHED_ID, content: { title: "Draft title", slug: "new-slug" } },
    { id: DRAFT_ONLY_ID, content: { title: "Draft only", slug: "draft-only" } },
    ...TWIN_IDS.map((id) => ({ id, content: { title: "Twin", slug: "twin" } })),
  ],
  live: [{ id: PUBLISHED_ID, content: { title: "Published title", slug: "old-slug" } }],
};

/** An API where only the valid session can read drafts, and only of this project. */
function mockApi(t: { mock: { method: typeof test.mock.method } }) {
  const lookups: Array<{ source: string; session: string | null }> = [];
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
        json: records[input.source].filter((record) => record.content[input.field] === input.value),
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  return lookups;
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
) {
  const options: RuntimeOptions = {
    apiUrl: "https://api.test",
    authenticationUrl: "https://auth.test",
    projectSlug: "test",
    getCamoxApp: async () => createApp({ blocks: [], layouts: layout, collections: [articles] }),
    renderPage: async (input) => `<main>${JSON.stringify(input.derived?.result)}</main>`,
  };
  const headers: Record<string, string> = cookie ? { Cookie: cookie } : {};
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
