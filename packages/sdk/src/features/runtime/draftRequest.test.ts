import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEVELOPMENT_DRAFT,
  DRAFT_ENDED_ERROR_CODE,
  DRAFT_HEADER,
  NO_DEVELOPMENT_DRAFT_ERROR,
  type EndedDraft,
} from "@camox/api-contract/drafts";

import { getRecordLookup, type LayoutRequestContext } from "../../core/requestContext";
import {
  localesResponse,
  markdownBody,
  pageListResponse,
  pageMarkdownResponse,
} from "./api.fixtures";
import { handleCamoxRequest, type PageRenderInput, type RuntimeOptions } from "./runtime";

const MEMBER_SESSION = "camox_auth_cookie=valid";
const project = { id: 1, name: "Real project", slug: "test", updatedAt: 1 };

const notFound = () =>
  Response.json(
    { json: { defined: false, code: "NOT_FOUND", status: 404, message: "Not found" } },
    { status: 404 },
  );
/** The draft the API refuses as missing, and the one it reports as ended. */
const MISSING_DRAFT = "missing";
const ENDED_DRAFT = "ended";
const ended: EndedDraft = {
  draftId: ENDED_DRAFT,
  outcome: "published",
  endedBy: { id: "user-2", name: "Ada" },
  endedAt: 1_700_000_000_000,
};
const refused = (status: number, code: string, data: unknown) =>
  Response.json({ json: { defined: false, code, status, message: "Refused", data } }, { status });
/** Whether the member's development draft exists: the dev server's first sync creates it. */
let developmentDraftExists = true;
const unauthorized = () =>
  Response.json(
    { json: { defined: false, code: "UNAUTHORIZED", status: 401, message: "Sign in" } },
    { status: 401 },
  );

/**
 * An API where only the valid session is a member, and where a request naming a draft reads
 * that draft's content. Like the real API, naming a draft without a session is refused.
 */
function mockApi(t: { mock: { method: typeof test.mock.method } }) {
  const draftHeaders: Array<{ path: string; draft: string | null }> = [];
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const url = new URL(request.url);
    const session = request.headers.get("Better-Auth-Cookie");
    const draft = request.headers.get(DRAFT_HEADER);
    draftHeaders.push({ path: url.pathname, draft });
    if (session && session !== "valid") return unauthorized();
    if (draft && !session) return unauthorized();
    if (draft === MISSING_DRAFT) return refused(404, "NOT_FOUND", { draftId: draft });
    if (draft === ENDED_DRAFT) return refused(410, DRAFT_ENDED_ERROR_CODE, ended);
    if (draft === DEVELOPMENT_DRAFT && !developmentDraftExists)
      return refused(404, NO_DEVELOPMENT_DRAFT_ERROR, undefined);
    if (url.pathname.endsWith("/locales/list")) return localesResponse();
    const source = draft ? `draft ${draft}` : "Live";
    if (url.pathname.endsWith("/getByUuid")) {
      if (!session) return unauthorized();
      return Response.json({ json: project });
    }
    if (url.pathname.endsWith("/listBySlug"))
      return pageListResponse([
        { id: 1, fullPath: "/about", pathSegment: "about", updatedAt: 1, layoutId: null },
      ]);
    if (url.pathname.endsWith("/getByPath")) {
      const { json: input } = (await request.json()) as { json: { path: string } };
      if (input.path !== "/about") return notFound();
      return Response.json({
        json: {
          page: { id: 1, fullPath: "/about", pathSegment: "about", metaTitle: source },
          layout: null,
          project,
          projectName: project.name,
          blocks: [],
          files: [],
          repeatableItems: [],
        },
      });
    }
    if (url.pathname.endsWith("/pages/getMarkdown"))
      return pageMarkdownResponse(request, {
        pageAt: ({ path }) =>
          path === "/about"
            ? { page: { id: 1, fullPath: "/about", metaTitle: source }, markdown: `# ${source}` }
            : null,
      });
    if (url.pathname.endsWith("/findRecordsByField")) return Response.json({ json: [] });
    if (url.pathname.endsWith("/getLayoutMarkdown"))
      return Response.json({ json: { before: "", after: "" } });
    if (url.pathname.endsWith("/layouts/get"))
      return Response.json({
        json: {
          projectName: project.name,
          project,
          layout: {
            id: 2,
            layoutId: "pokedex",
            beforeBlockIds: [],
            afterBlockIds: [],
            updatedAt: 1,
          },
          blocks: [{ id: "hero", content: { title: source } }],
          files: [],
          repeatableItems: [],
        },
      });
    throw new Error(`Unexpected request: ${url}`);
  });
  return draftHeaders;
}

/** The title of the page the render saw, or the hero block of a code-owned page. */
function renderedSource(input: PageRenderInput) {
  if (input.derived) {
    const state = input.dehydratedState as {
      queries: Array<{ state: { data: { block?: { content: { title: string } } } } }>;
    };
    return state.queries.find((query) => query.state.data.block)!.state.data.block!.content.title;
  }
  return (input.loaderData as { page: { page: { metaTitle: string } } }).page.page.metaTitle;
}

const pokedex = {
  _internal: {
    id: "pokedex",
    kind: "singleton",
    title: "Pokédex",
    toTitle: ({ page }: { page: { title: string } }) => page.title,
    toDescription: ({ page }: { page: { description?: string } }) => page.description,
    toStructuredData: () => undefined,
    // Looks up a record, as a record page's loader does.
    loader: async ({ context }: { context: LayoutRequestContext }) => {
      await getRecordLookup(context).findByField({
        collectionId: "pokemon",
        field: "slug",
        value: "pikachu",
      });
      return { kind: "data", data: {} };
    },
    toMarkdown: () => ["Pokédex"],
  },
};

const runtimeOptions: RuntimeOptions = {
  apiUrl: "https://api.test",
  authenticationUrl: "https://auth.test",
  projectUuid: "test",
  getCamoxApp: async () =>
    ({
      getLayouts: () => [pokedex],
      getLayoutById: () => null,
      getCollectionById: () => undefined,
    }) as never,
  renderPage: async (input) => {
    lastRender = input;
    return `<main>${renderedSource(input)}</main>`;
  },
};
/** What the last render received, which the browser hydrates from. */
let lastRender: PageRenderInput | undefined;

function request(
  path: string,
  init: { cookie?: string; accept?: string; developmentDraft?: boolean } = {},
) {
  const headers: Record<string, string> = {};
  if (init.cookie) headers.Cookie = init.cookie;
  if (init.accept) headers.Accept = init.accept;
  return handleCamoxRequest(new Request(`https://site.test${path}`, { headers }), {
    ...runtimeOptions,
    developmentDraft: init.developmentDraft,
  });
}

async function renderedHtml(response: Response | null) {
  return (await response!.text()).match(/<main>([^<]*)<\/main>/)![1];
}

void test("a member visiting a page with the draft param gets the draft on the first render", async (t) => {
  mockApi(t);
  for (const path of ["/about", "/pokedex"]) {
    const draft = await request(`${path}?camox-draft=d1`, { cookie: MEMBER_SESSION });
    assert.equal(await renderedHtml(draft), "draft d1", path);
    const live = await request(path, { cookie: MEMBER_SESSION });
    assert.equal(await renderedHtml(live), "Live", path);
  }
});

void test("a record page in a draft looks up the draft's records, and Live's when the draft is refused", async (t) => {
  const requests = mockApi(t);
  const recordLookups = () =>
    requests
      .splice(0)
      .filter((entry) => entry.path.endsWith("/findRecordsByField"))
      .map((entry) => entry.draft);

  await request("/pokedex?camox-draft=d1", { cookie: MEMBER_SESSION });
  assert.deepEqual(recordLookups(), ["d1"]);
  await request(`/pokedex?camox-draft=${MISSING_DRAFT}`, { cookie: MEMBER_SESSION });
  assert.deepEqual(recordLookups(), [null]);
  await request("/pokedex", { cookie: MEMBER_SESSION });
  assert.deepEqual(recordLookups(), [null]);
});

void test("a visitor without a session naming a draft gets Live, and never names the draft", async (t) => {
  const requests = mockApi(t);
  for (const path of ["/about", "/pokedex"]) {
    const response = await request(`${path}?camox-draft=d1`);
    assert.equal(await renderedHtml(response), "Live", path);
  }
  assert.deepEqual(
    requests.filter((entry) => entry.draft),
    [],
  );
});

void test("Markdown and the sitemap read Live, even for a member naming a draft", async (t) => {
  const requests = mockApi(t);
  const markdown = await request("/about?camox-draft=d1", {
    cookie: MEMBER_SESSION,
    accept: "text/markdown",
  });
  assert.equal(markdownBody(await markdown!.text()), "# Live");
  await request("/pokedex?camox-draft=d1", { cookie: MEMBER_SESSION, accept: "text/markdown" });
  await request("/sitemap.xml?camox-draft=d1", { cookie: MEMBER_SESSION });
  assert.ok(requests.length > 0);
  assert.deepEqual(
    requests.filter((entry) => entry.draft),
    [],
  );
});

/** What a page renders for a request, and the input the browser hydrates from. */
async function render(path: string, cookie?: string, developmentDraft?: boolean) {
  lastRender = undefined;
  const response = await request(path, { cookie, developmentDraft });
  const input = path.startsWith("/_camox/data")
    ? ((await response!.json()) as PageRenderInput)
    : lastRender!;
  return { source: renderedSource(input), input };
}

const PATHS = ["/about", "/pokedex", "/_camox/data?path=/about", "/_camox/data?path=/pokedex"];
const withDraft = (path: string, draft: string) =>
  `${path}${path.includes("?") ? "&" : "?"}camox-draft=${draft}`;

void test("a page says which draft it read", async (t) => {
  mockApi(t);
  for (const path of PATHS) {
    const draft = await render(withDraft(path, "d1"), MEMBER_SESSION);
    assert.equal(draft.input.draftId, "d1", path);
    assert.equal(draft.input.refusedDraft, undefined, path);
    const live = await render(path, MEMBER_SESSION);
    assert.equal(live.input.draftId ?? null, null, path);
  }
});

void test("a visitor opening a URL with a draft param sees Live, without the param and with no notice", async (t) => {
  mockApi(t);
  for (const path of PATHS) {
    const { source, input } = await render(withDraft(path, "d1"));
    assert.equal(source, "Live", path);
    assert.equal(input.draftId ?? null, null, path);
    assert.deepEqual(input.refusedDraft, { notice: null }, path);
    assert.equal(new URL(input.href).searchParams.has("camox-draft"), false, path);
  }
});

void test("a member opening a draft that doesn't exist gets Live in the same response, and a notice", async (t) => {
  mockApi(t);
  for (const path of PATHS) {
    const { source, input } = await render(withDraft(path, MISSING_DRAFT), MEMBER_SESSION);
    assert.equal(source, "Live", path);
    assert.equal(input.draftId ?? null, null, path);
    assert.deepEqual(input.refusedDraft, { notice: { reason: "missing" } }, path);
    assert.equal(new URL(input.href).searchParams.has("camox-draft"), false, path);
  }
});

void test("a member opening an ended draft gets Live, and a notice saying how and by whom it ended", async (t) => {
  mockApi(t);
  for (const path of PATHS) {
    const { source, input } = await render(withDraft(path, ENDED_DRAFT), MEMBER_SESSION);
    assert.equal(source, "Live", path);
    assert.deepEqual(input.refusedDraft, { notice: { reason: "ended", ...ended } }, path);
  }
});

void test("a page rendered from a draft is never publicly cacheable", async (t) => {
  mockApi(t);
  for (const path of [
    "/about",
    "/pokedex",
    "/_camox/data?path=/about",
    "/_camox/data?path=/pokedex",
  ]) {
    for (const cookie of [MEMBER_SESSION, undefined]) {
      const separator = path.includes("?") ? "&" : "?";
      const response = await request(`${path}${separator}camox-draft=d1`, { cookie });
      assert.equal(
        response!.headers.get("Cache-Control"),
        "private, no-store",
        `${path} ${cookie}`,
      );
    }
  }
});

void test("a visitor's Live page and its navigation data may be shared, a member's never", async (t) => {
  mockApi(t);
  for (const path of PATHS) {
    const visitor = await request(path, {});
    assert.equal(visitor!.status, 200, path);
    assert.doesNotMatch(visitor!.headers.get("Cache-Control") ?? "", /private|no-store/, path);
    const member = await request(path, { cookie: MEMBER_SESSION });
    assert.equal(member!.headers.get("Cache-Control"), "private, no-store", path);
  }
});

void test("in dev mode, a member reads their development draft whatever draft the URL names", async (t) => {
  const requests = mockApi(t);
  for (const path of PATHS) {
    for (const url of [path, withDraft(path, "d1")]) {
      const { source, input } = await render(url, MEMBER_SESSION, true);
      assert.equal(source, `draft ${DEVELOPMENT_DRAFT}`, url);
      assert.equal(input.draftId, DEVELOPMENT_DRAFT, url);
      assert.equal(input.refusedDraft, undefined, url);
    }
  }
  const named = new Set(requests.map((entry) => entry.draft).filter((draft) => draft !== null));
  assert.deepEqual([...named], [DEVELOPMENT_DRAFT]);
});

void test("in dev mode, a visitor without a session sees Live and never names the development draft", async (t) => {
  const requests = mockApi(t);
  for (const path of PATHS) {
    const { source, input } = await render(path, undefined, true);
    assert.equal(source, "Live", path);
    assert.deepEqual(input.refusedDraft, { notice: null }, path);
  }
  assert.deepEqual(
    requests.filter((entry) => entry.draft),
    [],
  );
});

void test("in dev mode before the first sync, a member sees Live and is told their development draft doesn't exist yet", async (t) => {
  mockApi(t);
  developmentDraftExists = false;
  t.after(() => {
    developmentDraftExists = true;
  });
  for (const path of PATHS) {
    const { source, input } = await render(path, MEMBER_SESSION, true);
    assert.equal(source, "Live", path);
    assert.deepEqual(input.refusedDraft, { notice: { reason: "noDevelopmentDraft" } }, path);
  }
});
