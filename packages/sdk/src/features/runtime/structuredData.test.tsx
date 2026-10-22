import assert from "node:assert/strict";
import { registerHooks } from "node:module";
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

// Every page's head carries one JSON-LD graph describing the website and the page: the project's
// Organization, its WebSite, and the page's WebPage, linked by `@id`. Developers write no code
// for it: Camox builds it from the project, the layout's title and description, and the page.

Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true, React });

// The image renderer, which the SDK imports through its own package exports, from source.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier !== "camox/_internal/imageResponse") return nextResolve(specifier, context);
    return nextResolve(new URL("../og/imageResponse.ts", import.meta.url).href, context);
  },
});

const PROJECT = { id: 1, name: "Real project", slug: "test", updatedAt: 1 };
const project = PROJECT;
const MEMBER_SESSION = "camox_auth_cookie=valid";
const PRICING = "0199f0a0-0000-7000-8000-000000000001";
const LAUNCH = "0199f0a0-0000-7000-8000-000000000002";
const HELLO = "0199f0a0-0000-7000-8000-0000000000a1";

const FIRST_PUBLISHED = Date.UTC(2026, 0, 2, 9, 30);
const LAST_PUBLISHED = Date.UTC(2026, 5, 7, 16, 45);

type StoredPage = {
  id: string;
  fullPath: string;
  metaTitle: string;
  metaDescription: string;
  firstPublishedAt: number | null;
  publishedAt: number | null;
};

/** Each locale's Live pages. Pricing exists in English and German. */
const LIVE_PAGES: Record<string, StoredPage[]> = {
  en: [
    {
      id: PRICING,
      fullPath: "/pricing",
      metaTitle: "Pricing",
      metaDescription: "What it costs",
      firstPublishedAt: FIRST_PUBLISHED,
      publishedAt: LAST_PUBLISHED,
    },
  ],
  de: [
    {
      id: PRICING,
      fullPath: "/preise",
      metaTitle: "Preise",
      metaDescription: "Was es kostet",
      firstPublishedAt: FIRST_PUBLISHED,
      publishedAt: LAST_PUBLISHED,
    },
  ],
};

/** A page the draft created, which was never published. */
const DRAFT_ONLY_PAGE: StoredPage = {
  id: LAUNCH,
  fullPath: "/launch",
  metaTitle: "Launch",
  metaDescription: "Coming soon",
  firstPublishedAt: null,
  publishedAt: null,
};

const ARTICLES: Record<string, { title: string; slug: string }> = {
  en: { title: "Hello", slug: "hello" },
  de: { title: "Hallo", slug: "hallo" },
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
 * An API whose Live has English, the default locale, and German. Only the valid session is a
 * member, whose draft adds a launch page.
 */
function mockApi(
  t: { mock: { method: typeof test.mock.method } },
  {
    livePages = LIVE_PAGES,
    socialProfiles,
  }: { livePages?: Record<string, StoredPage[]>; socialProfiles?: string[] } = {},
) {
  // Social profiles are a Project Setting: Live and every draft read the same ones.
  const project = { ...PROJECT, ...(socialProfiles && { socialProfiles }) };
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const procedure = new URL(request.url).pathname.replace(/^\/rpc\//, "");
    const locale = request.headers.get(LOCALE_HEADER) ?? "en";
    const session = request.headers.get("Better-Auth-Cookie");
    const draft = request.headers.get(DRAFT_HEADER);
    if (session && session !== "valid") return unauthorized();
    if (draft && !session) return unauthorized();
    const pages = [
      ...(livePages[locale] ?? []),
      ...(draft && locale === "en" ? [DRAFT_ONLY_PAGE] : []),
    ];
    if (procedure === "projects/getByUuid")
      return session ? Response.json({ json: project }) : notFound();
    if (procedure === "projects/getSummary") return Response.json({ json: project });
    if (procedure === "locales/list") return localesResponse(["en", "de"]);
    if (procedure === "pages/listBySlug")
      return pageListResponse(
        pages.map((page) => ({
          ...page,
          nickname: page.fullPath,
          layoutId: "regular",
          updatedAt: 1,
        })),
        project.name,
      );
    if (procedure === "pages/getByPath") {
      const { json: input } = (await request.json()) as { json: { path: string } };
      const page = pages.find(({ fullPath }) => fullPath === input.path);
      if (!page) return notFound();
      return Response.json({
        json: {
          page: { ...page, pathSegment: page.fullPath.slice(1), blockIds: [], locale },
          layout: { id: 1, layoutId: "regular", beforeBlockIds: [], afterBlockIds: [] },
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
      const article = ARTICLES[locale];
      return Response.json({
        json:
          article?.slug === input.value
            ? [{ id: HELLO, title: article.title, description: null, content: article }]
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
  content: (field) => ({ title: field.string(), slug: field.string() }),
  toTitle: ({ content }) => content.title,
  toDescription: () => undefined,
});

const layoutOptions = {
  description: "",
  blocks: { before: [], after: [] },
  toReact: () => <main />,
  toTitle: ({ page, project }: { page: { title: string }; project: { name: string } }) =>
    `${page.title} | ${project.name}`,
};

const app = createApp({
  blocks: [],
  collections: [articles],
  layouts: [
    createLayout("regular")({
      ...layoutOptions,
      title: "Regular",
      kind: "curated",
      toDescription: ({ page }) => page.description,
    }),
    createLayout("pokedex")({
      ...layoutOptions,
      title: "Pokédex",
      kind: "singleton",
      toDescription: () => "Every Pokémon",
    }),
    createLayout("pokemon.$name")({
      ...layoutOptions,
      title: "Pokémon",
      kind: "derived",
      loader: async ({ params }) => ({ kind: "data", data: { name: params.name } }),
      toDescription: ({ params }) => `All about ${params.name}`,
    }),
    createLayout("articles.$slug")({
      ...layoutOptions,
      title: "Article",
      kind: "derived",
      ...articles.pages({ by: "slug", param: "slug" }),
      toDescription: ({ content }) => `An article: ${content.title}`,
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

type Node = Record<string, unknown> & { "@id"?: string; "@type"?: string | string[] };

/** A document head's JSON-LD scripts, its title and its description. */
function readHead(head: string) {
  const scripts = [
    ...head.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g),
  ].map((match) => match[1]!);
  const decode = (text: string) =>
    text.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'");
  return {
    scripts,
    title: decode(head.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? ""),
    description: decode(head.match(/<meta [^>]*name="description" content="([^"]*)"/)?.[1] ?? ""),
    ogImage: decode(head.match(/<meta [^>]*property="og:image" content="([^"]*)"/)?.[1] ?? ""),
  };
}

/** The graph a page's head carries, by node type, with the head it came with. */
async function graphOf(response: Response | null) {
  assert.equal(response?.status, 200);
  const html = await response!.text();
  const head = readHead(html.slice(0, html.indexOf("</head>")));
  assert.equal(head.scripts.length, 1, "one JSON-LD script");
  const graph = JSON.parse(head.scripts[0]!) as { "@context": string; "@graph": Node[] };
  const ofType = (type: string) => {
    const nodes = graph["@graph"].filter((node) => [node["@type"]].flat().includes(type));
    assert.equal(nodes.length, 1, `one ${type} node`);
    return nodes[0]!;
  };
  return {
    head,
    context: graph["@context"],
    organization: ofType("Organization"),
    website: ofType("WebSite"),
    webpage: ofType("WebPage"),
    byId: (id: unknown) =>
      graph["@graph"].find((node) => node["@id"] === (id as { "@id": string })["@id"]),
  };
}

void test("every kind of page carries one graph of its Organization, WebSite and WebPage, linked by @id", async (t) => {
  mockApi(t);
  for (const path of ["/pricing", "/pokedex", "/pokemon/pikachu", "/articles/hello"]) {
    const { context, organization, website, webpage, byId } = await graphOf(await visit(path));
    assert.equal(context, "https://schema.org", path);
    assert.equal(organization.name, project.name, path);
    assert.equal(organization.url, "https://site.test/", path);
    assert.equal(website.name, project.name, path);
    assert.equal(website.url, "https://site.test/", path);
    assert.equal(byId(website.publisher), organization, path);
    assert.equal(byId(webpage.isPartOf), website, path);
    assert.equal(webpage.url, `https://site.test${path}`, path);
    assert.equal(webpage.inLanguage, "en", path);
    assert.equal(website.inLanguage, "en", path);
  }
});

void test("the site's nodes keep their @ids from page to page", async (t) => {
  mockApi(t);
  const pricing = await graphOf(await visit("/pricing"));
  const pokedex = await graphOf(await visit("/pokedex"));
  assert.ok(pricing.organization["@id"]);
  assert.ok(pricing.website["@id"]);
  assert.equal(pokedex.organization["@id"], pricing.organization["@id"]);
  assert.equal(pokedex.website["@id"], pricing.website["@id"]);
  assert.notEqual(pokedex.webpage["@id"], pricing.webpage["@id"]);
});

void test("the WebPage is named and described as the head is, and shows the page image", async (t) => {
  mockApi(t);
  const expected = {
    "/pricing": ["Pricing | Real project", "What it costs"],
    "/pokedex": ["Pokédex | Real project", "Every Pokémon"],
    "/pokemon/pikachu": ["Pokémon | Real project", "All about pikachu"],
    "/articles/hello": ["Hello | Real project", "An article: Hello"],
  };
  for (const [path, [title, description]] of Object.entries(expected)) {
    const { head, webpage, byId } = await graphOf(await visit(path));
    assert.equal(head.title, title, path);
    assert.equal(head.description, description, path);
    assert.equal(webpage.name, head.title, path);
    assert.equal(webpage.description, head.description, path);
    const image = (byId(webpage.primaryImageOfPage) ?? webpage.primaryImageOfPage) as Node;
    assert.ok(head.ogImage, path);
    assert.equal(image.url, head.ogImage, path);
  }
});

/** The width and height a PNG's header states. */
function pngSize(bytes: Uint8Array) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  assert.deepEqual([...bytes.subarray(0, 8)], signature, "a PNG");
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

void test("the Organization's logo is the favicon as a PNG at least 112px wide, even when the favicon is an SVG", async (t) => {
  mockApi(t);
  const api = globalThis.fetch;
  // The project's favicon is an SVG.
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    if (new URL(request.url).pathname.startsWith("/favicons/"))
      return new Response(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="red"/></svg>',
        { headers: { "Content-Type": "image/svg+xml" } },
      );
    return api(request);
  });
  const { organization, byId } = await graphOf(await visit("/pricing"));
  const logo = (byId(organization.logo) ?? organization.logo) as Node;
  const logoUrl = new URL(logo.url as string);
  assert.equal(logoUrl.origin, "https://site.test");

  const response = await visit(logoUrl.pathname + logoUrl.search);
  assert.equal(response?.status, 200);
  assert.equal(response!.headers.get("Content-Type"), "image/png");
  const size = pngSize(new Uint8Array(await response!.arrayBuffer()));
  assert.ok(size.width >= 112, `${size.width}px wide`);
  assert.equal(logo.width, size.width);
  assert.equal(logo.height, size.height);
});

/** Answers favicon requests with an SVG, keeping the API mock for the rest. Records which ones. */
function mockFavicons(t: { mock: { method: typeof test.mock.method } }) {
  const api = globalThis.fetch;
  const requested: string[] = [];
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith("/favicons/")) return api(request);
    requested.push(pathname);
    return new Response(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="red"/></svg>',
      { headers: { "Content-Type": "image/svg+xml" } },
    );
  });
  return requested;
}

/**
 * The project as the logo route reads it, at a version of its own: a runtime renders each
 * version's logo once, so each test reads a version no other test rendered.
 */
function mockProjectVersion(t: { mock: { method: typeof test.mock.method } }, updatedAt: number) {
  const api = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    if (new URL(request.url).pathname === "/rpc/projects/getSummary")
      return Response.json({ json: { ...project, updatedAt } });
    return api(request);
  });
}

void test("the logo route serves the website's own project's logo, whatever project the URL names", async (t) => {
  mockApi(t);
  mockProjectVersion(t, 41);
  const requested = mockFavicons(t);
  const response = await visit("/_camox/logo.png?project=2&v=41");
  assert.equal(response?.status, 200);
  assert.equal(response!.headers.get("Content-Type"), "image/png");
  assert.deepEqual(requested, [`/favicons/${project.id}`]);
});

void test("the logo is rendered once per version of the project, whatever version the URL names", async (t) => {
  mockApi(t);
  mockProjectVersion(t, 42);
  const requested = mockFavicons(t);
  for (const v of ["42", "43", "nonsense", ""]) {
    const response = await visit(`/_camox/logo.png?v=${v}`);
    assert.equal(response?.status, 200, v);
  }
  assert.equal(requested.length, 1);
  // Once the project changes, its new favicon is rendered.
  mockProjectVersion(t, 43);
  assert.equal((await visit("/_camox/logo.png?v=43"))?.status, 200);
  assert.equal(requested.length, 2);
});

void test("a page on Live states when it was first and last published", async (t) => {
  mockApi(t);
  const { webpage } = await graphOf(await visit("/pricing"));
  assert.equal(webpage.datePublished, "2026-01-02T09:30:00.000Z");
  assert.equal(webpage.dateModified, "2026-06-07T16:45:00.000Z");
});

void test("a page that only exists in a draft states no publish times, and its graph comes from the draft", async (t) => {
  mockApi(t);
  const { head, webpage } = await graphOf(
    await visit("/launch?camox-draft=d1", { cookie: MEMBER_SESSION }),
  );
  assert.equal(webpage.name, "Launch | Real project");
  assert.equal(webpage.description, "Coming soon");
  assert.equal(webpage.name, head.title);
  assert.equal(webpage.url, "https://site.test/launch");
  assert.equal("datePublished" in webpage, false);
  assert.equal("dateModified" in webpage, false);
});

void test("a German page's graph uses its German content, URLs and language", async (t) => {
  mockApi(t);
  for (const [path, name] of [
    ["/de/preise", "Preise | Real project"],
    ["/de/pokedex", "Pokédex | Real project"],
    ["/de/articles/hallo", "Hallo | Real project"],
  ] as const) {
    const { webpage, website, head } = await graphOf(await visit(path));
    assert.equal(webpage.name, name, path);
    assert.equal(webpage.name, head.title, path);
    assert.equal(webpage.url, `https://site.test${path}`, path);
    assert.equal(webpage.inLanguage, "de", path);
    assert.equal(website.inLanguage, "de", path);
  }
});

void test("content containing </script> can't close the graph's script", async (t) => {
  const hostile = "</script><script>alert(1)</script>";
  mockApi(t, {
    livePages: {
      en: [{ ...LIVE_PAGES.en![0]!, metaTitle: hostile, metaDescription: `<b>${hostile}</b>` }],
    },
  });
  // A script ends at the first `</script>` in it, so the graph only parses whole if none is in it.
  const { webpage } = await graphOf(await visit("/pricing"));
  assert.equal(webpage.name, `${hostile} | Real project`);
  assert.equal(webpage.description, `<b>${hostile}</b>`);
});

void test("navigating client-side swaps the graph rather than adding a second one", async (t) => {
  mockApi(t);
  const api = globalThis.fetch;
  // The website answers navigation's page data, and the API the rest.
  t.mock.method(globalThis, "fetch", async (request: URL | RequestInfo) => {
    const url = new URL(request instanceof Request ? request.url : String(request));
    return url.origin === "https://site.test"
      ? (await visit(url.pathname + url.search))!
      : api(request as Request);
  });
  const html = await (await visit("/pricing"))!.text();
  const initial = JSON.parse(
    html.match(/<script id="__CAMOX_DATA__" type="application\/json">([\s\S]*?)<\/script>/)![1]!,
  ) as PageRenderInput;

  const window = new Window({ url: "https://site.test/pricing" });
  Object.assign(globalThis, {
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
  /** The name of the WebPage in each graph the document's head holds. */
  const pageNodeNames = () =>
    [...document.head.querySelectorAll('script[type="application/ld+json"]')].map(
      (script) =>
        (JSON.parse(script.textContent ?? "") as { "@graph": Node[] })["@graph"].find(
          (node) => node["@type"] === "WebPage",
        )?.name,
    );
  assert.deepEqual(pageNodeNames(), ["Pricing | Real project"]);

  for (const [path, name] of [
    ["/de/preise", "Preise | Real project"],
    ["/pokedex", "Pokédex | Real project"],
  ] as const) {
    await React.act(async () => {
      await navigate({ to: path });
    });
    assert.deepEqual(pageNodeNames(), [name], path);
  }
});

void test("the Organization lists the project's social profiles as sameAs, in their order, on Live and in drafts", async (t) => {
  const profiles = [
    "https://x.com/acme",
    "https://github.com/acme",
    "https://www.linkedin.com/company/acme",
  ];
  mockApi(t, { socialProfiles: profiles });
  const pages = [
    ["/pricing"],
    ["/pokedex"],
    ["/pokemon/pikachu"],
    ["/articles/hello"],
    ["/de/preise"],
    ["/launch?camox-draft=d1", { cookie: MEMBER_SESSION }],
  ] as const;
  for (const [path, init] of pages) {
    const { organization } = await graphOf(await visit(path, init));
    assert.deepEqual(organization.sameAs, profiles, path);
  }
});

void test("a project without social profiles has an Organization without sameAs", async (t) => {
  for (const socialProfiles of [undefined, []]) {
    mockApi(t, { socialProfiles });
    const { organization } = await graphOf(await visit("/pricing"));
    assert.equal("sameAs" in organization, false, JSON.stringify(socialProfiles));
    t.mock.restoreAll();
  }
});
