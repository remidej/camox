import assert from "node:assert/strict";
import { test } from "node:test";

import { DRAFT_HEADER, LOCALE_HEADER } from "@camox/api-contract/drafts";
import { QueryClient } from "@tanstack/react-query";
import { Window } from "happy-dom";
import * as React from "react";

import { createApp } from "../../core/createApp";
import { createCollection } from "../../core/createCollection";
import { createLayout } from "../../core/createLayout";
import { StudioScopeProvider } from "../../lib/draft-scope.fixtures";
import { useNavigate } from "../navigation/navigation";
import { localesResponse, pageListResponse } from "./api.fixtures";
import { PageNavigationProvider } from "./pageNavigation";
import { handleCamoxRequest, type PageRenderInput, type RuntimeOptions } from "./runtime";

// Every page's head tells search engines and link previews which URL is the page's own, what kind
// of thing it is, which website it belongs to, and which locales it exists in.

const project = { id: 1, name: "Real project", slug: "test", updatedAt: 1 };
const MEMBER_SESSION = "camox_auth_cookie=valid";
const PRICING = "0199f0a0-0000-7000-8000-000000000001";
const ABOUT = "0199f0a0-0000-7000-8000-000000000002";

/** Each locale's curated pages. Pricing exists in English and German, About in English only. */
const PAGES: Record<string, Array<{ id: string; fullPath: string }>> = {
  en: [
    { id: PRICING, fullPath: "/pricing" },
    { id: ABOUT, fullPath: "/about" },
  ],
  "de-CH": [{ id: PRICING, fullPath: "/preise" }],
};

const HELLO = "0199f0a0-0000-7000-8000-0000000000a1";

/** Each locale's article records, with localized slugs. */
const ARTICLES: Record<string, Array<{ id: string; content: { title: string; slug: string } }>> = {
  en: [{ id: HELLO, content: { title: "Hello", slug: "hello" } }],
  "de-CH": [{ id: HELLO, content: { title: "Hallo", slug: "hallo" } }],
};

const notFound = () =>
  Response.json(
    { json: { defined: false, code: "NOT_FOUND", status: 404, message: "Not found" } },
    { status: 404 },
  );
const unauthorized = () =>
  Response.json(
    { json: { defined: false, code: "UNAUTHORIZED", status: 401, message: "Sign in" } },
    { status: 401 },
  );

/**
 * An API whose Live has English, the default locale, and Swiss German. Only the valid session is a
 * member, who can read drafts.
 */
function mockApi(t: { mock: { method: typeof test.mock.method } }, locales = ["en", "de-CH"]) {
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const procedure = new URL(request.url).pathname.replace(/^\/rpc\//, "");
    const locale = request.headers.get(LOCALE_HEADER) ?? "en";
    const session = request.headers.get("Better-Auth-Cookie");
    if (session && session !== "valid") return unauthorized();
    if (request.headers.get(DRAFT_HEADER) && !session) return unauthorized();
    if (procedure === "projects/getByUuid")
      return session ? Response.json({ json: project }) : notFound();
    if (procedure === "locales/list") return localesResponse(locales);
    if (procedure === "pages/listBySlug")
      return pageListResponse(
        (PAGES[locale] ?? []).map((page) => ({
          ...page,
          nickname: page.fullPath,
          layoutId: "regular",
          metaTitle: null,
          metaDescription: null,
          updatedAt: 1,
        })),
        project.name,
      );
    if (procedure === "pages/getByPath") {
      const { json: input } = (await request.json()) as { json: { path: string } };
      const page = PAGES[locale]?.find(({ fullPath }) => fullPath === input.path);
      if (!page) return notFound();
      return Response.json({
        json: {
          page: { ...page, pathSegment: page.fullPath.slice(1), metaTitle: page.fullPath, locale },
          layout: null,
          project,
          projectName: project.name,
          blocks: [],
          files: [],
          repeatableItems: [],
        },
      });
    }
    if (procedure === "layouts/get")
      return Response.json({
        json: {
          projectName: project.name,
          project,
          layout: null,
          blocks: [],
          files: [],
          repeatableItems: [],
        },
      });
    if (procedure === "collectionDefinitions/findRecordsByField") {
      const { json: input } = (await request.json()) as { json: { value: string } };
      return Response.json({
        json: (ARTICLES[locale] ?? []).filter(({ content }) => content.slug === input.value),
      });
    }
    if (procedure === "collectionDefinitions/listRecordPageValues")
      return Response.json({
        json: (ARTICLES[locale] ?? []).map(({ id, content }) => ({
          id,
          value: content.slug,
          label: content.title,
        })),
      });
    throw new Error(`Unexpected API request ${procedure}`);
  });
}

const articles = createCollection({
  id: "articles",
  title: "Articles",
  description: "",
  content: (field) => ({ title: field.string(), slug: field.string() }),
  label: "title",
});

const layoutOptions = {
  description: "",
  blocks: { before: [], after: [] },
  component: () => <main />,
  buildMetaTitle: ({ pageMetaTitle }: { pageMetaTitle: string }) => pageMetaTitle,
};

const app = createApp({
  blocks: [],
  collections: [articles],
  layouts: [
    createLayout("pokedex")({ ...layoutOptions, title: "Pokédex", kind: "singleton" }),
    createLayout("pokemon.$name")({
      ...layoutOptions,
      title: "Pokémon",
      kind: "derived",
      loader: async ({ params }) => ({ kind: "data", data: { name: params.name } }),
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

/** The tags of a head's markup, one tag each, by the attributes that identify them. */
function tagsIn(head: string) {
  const all = (pattern: RegExp) =>
    [...head.matchAll(pattern)].map((match) => match[1]!.replaceAll("&amp;", "&"));
  const meta = (property: string) =>
    all(new RegExp(`<meta [^>]*(?:property|name)="${property}" content="([^"]*)"`, "g"));
  return {
    canonical: all(/<link [^>]*rel="canonical" href="([^"]*)"/g),
    url: meta("og:url"),
    type: meta("og:type"),
    siteName: meta("og:site_name"),
    locale: meta("og:locale"),
    localeAlternates: meta("og:locale:alternate"),
    card: meta("twitter:card"),
  };
}

/** The canonical, Open Graph and Twitter tags of a document's head. */
async function headTagsOf(response: Response | null) {
  assert.equal(response?.status, 200);
  const html = await response!.text();
  return tagsIn(html.slice(0, html.indexOf("</head>")));
}

void test("every kind of page states its canonical URL, Open Graph basics and Twitter card", async (t) => {
  mockApi(t);
  const pages = {
    curated: "/pricing",
    singleton: "/pokedex",
    derived: "/pokemon/pikachu",
    record: "/articles/hello",
  };
  for (const [kind, path] of Object.entries(pages)) {
    const url = `https://site.test${path}`;
    assert.deepEqual(
      await headTagsOf(await visit(path)),
      {
        canonical: [url],
        url: [url],
        type: ["website"],
        siteName: [project.name],
        locale: ["en"],
        localeAlternates: ["de_CH"],
        card: ["summary_large_image"],
      },
      kind,
    );
  }
});

void test("a German page's canonical URL is its URL under the German prefix", async (t) => {
  mockApi(t);
  for (const path of ["/de-ch/preise", "/de-ch/pokedex", "/de-ch/articles/hallo"]) {
    const tags = await headTagsOf(await visit(path));
    assert.deepEqual(tags.canonical, [`https://site.test${path}`], path);
    assert.deepEqual(tags.url, tags.canonical, path);
    assert.deepEqual(tags.locale, ["de_CH"], path);
    assert.deepEqual(tags.localeAlternates, ["en"], path);
  }
});

void test("a member viewing a draft sees the page's canonical URL, without the draft", async (t) => {
  mockApi(t);
  for (const path of ["/de-ch/preise", "/pokedex", "/articles/hello"]) {
    const response = await visit(`${path}?camox-draft=d1&utm_source=newsletter`, {
      cookie: MEMBER_SESSION,
    });
    const tags = await headTagsOf(response);
    assert.deepEqual(tags.canonical, [`https://site.test${path}`], path);
    assert.deepEqual(tags.url, tags.canonical, path);
  }
});

void test("a page lists only the other locales it exists in as alternate locales", async (t) => {
  mockApi(t);
  const about = await headTagsOf(await visit("/about"));
  assert.deepEqual(about.locale, ["en"]);
  assert.deepEqual(about.localeAlternates, []);
});

void test("navigating client-side to another page replaces its head tags", async (t) => {
  mockApi(t);
  const api = globalThis.fetch;
  // The website answers navigation's page data, and the API the rest.
  t.mock.method(globalThis, "fetch", async (request: URL | RequestInfo) => {
    const url = request instanceof Request ? request.url : String(request);
    return new URL(url).origin === "https://site.test"
      ? (await visit(new URL(url).pathname + new URL(url).search))!
      : api(request as Request);
  });
  const response = await visit("/about");
  assert.equal(response?.status, 200);
  const html = await response!.text();
  const initial = JSON.parse(
    html.match(/<script id="__CAMOX_DATA__" type="application\/json">([\s\S]*?)<\/script>/)![1]!,
  ) as PageRenderInput;

  const window = new Window({ url: "https://site.test/about" });
  Object.assign(globalThis, {
    React,
    window,
    document: window.document,
    location: window.location,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  t.mock.method(window, "scrollTo", () => {});
  // The browser shows the head the server rendered.
  document.head.innerHTML = html.slice(html.indexOf("<head>") + 6, html.indexOf("</head>"));
  document.body.innerHTML = '<div id="root"></div>';
  const queryClient = new QueryClient();
  let navigate!: ReturnType<typeof useNavigate>;
  function Page() {
    navigate = useNavigate();
    return <main />;
  }
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  t.after(async () => {
    await React.act(async () => root.unmount());
    queryClient.clear();
    await window.happyDOM.close();
  });
  await React.act(async () => {
    root.render(
      <StudioScopeProvider client={queryClient}>
        <PageNavigationProvider camoxApp={app} initialInput={initial} queryClient={queryClient}>
          {() => <Page />}
        </PageNavigationProvider>
      </StudioScopeProvider>,
    );
  });
  assert.deepEqual(tagsIn(document.head.innerHTML).canonical, ["https://site.test/about"]);

  await React.act(async () => {
    await navigate({ to: "/de-ch/preise" });
  });
  const url = "https://site.test/de-ch/preise";
  assert.deepEqual(tagsIn(document.head.innerHTML), {
    canonical: [url],
    url: [url],
    type: ["website"],
    siteName: [project.name],
    locale: ["de_CH"],
    localeAlternates: ["en"],
    card: ["summary_large_image"],
  });
});

void test("a project with one locale lists no alternate locales", async (t) => {
  mockApi(t, ["en"]);
  for (const path of ["/pricing", "/pokedex", "/articles/hello"]) {
    const tags = await headTagsOf(await visit(path));
    assert.deepEqual(tags.locale, ["en"], path);
    assert.deepEqual(tags.localeAlternates, [], path);
  }
});
