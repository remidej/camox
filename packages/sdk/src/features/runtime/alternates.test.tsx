import assert from "node:assert/strict";
import { test } from "node:test";

import { LOCALE_HEADER } from "@camox/api-contract/drafts";
import * as React from "react";

import { createApp } from "../../core/createApp";
import { createCollection } from "../../core/createCollection";
import { createLayout } from "../../core/createLayout";
import { useAlternates, useLocale, useLocalizedHref } from "../navigation/navigation";
import { localesResponse, pageListResponse } from "./api.fixtures";
import { renderPageWithApp } from "./pageServer";
import { handleCamoxRequest, type RuntimeOptions } from "./runtime";

// Search engines learn which pages are versions of each other: every page lists the locales it
// exists in with `hreflang`, plus `x-default` for the default locale's page, and the sitemap lists
// every localization with the same alternates. Layouts build a locale switcher from the same
// alternates, and links that stay in the current locale.

const project = { id: 1, name: "Real project", slug: "test", updatedAt: 1 };
const PRICING = "0199f0a0-0000-7000-8000-000000000001";
const ABOUT = "0199f0a0-0000-7000-8000-000000000002";
const IMPRESSUM = "0199f0a0-0000-7000-8000-000000000003";

/**
 * Each locale's curated pages. Pricing exists in English and German, About was removed from
 * German, and the Impressum exists in German only.
 */
const PAGES: Record<string, Array<{ id: string; fullPath: string }>> = {
  en: [
    { id: PRICING, fullPath: "/pricing" },
    { id: ABOUT, fullPath: "/about" },
  ],
  de: [
    { id: PRICING, fullPath: "/preise" },
    { id: IMPRESSUM, fullPath: "/impressum" },
  ],
};

const HELLO = "0199f0a0-0000-7000-8000-0000000000a1";
const ENGLISH_ONLY = "0199f0a0-0000-7000-8000-0000000000a2";

/**
 * Each locale's article records. Their slugs are localized, and the English-only article was
 * removed from German.
 */
const ARTICLES: Record<string, Array<{ id: string; content: { title: string; slug: string } }>> = {
  en: [
    { id: HELLO, content: { title: "Hello", slug: "hello" } },
    { id: ENGLISH_ONLY, content: { title: "English only", slug: "english-only" } },
  ],
  de: [{ id: HELLO, content: { title: "Hallo", slug: "hallo" } }],
};

const notFound = () =>
  Response.json(
    { json: { defined: false, code: "NOT_FOUND", status: 404, message: "Not found" } },
    { status: 404 },
  );

/** An API whose Live has English, the default locale, and German. */
function mockApi(t: { mock: { method: typeof test.mock.method } }) {
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const procedure = new URL(request.url).pathname.replace(/^\/rpc\//, "");
    const locale = request.headers.get(LOCALE_HEADER) ?? "en";
    if (procedure === "projects/getBySlug") return notFound();
    if (procedure === "locales/list") return localesResponse(["en", "de"]);
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

/** A layout's locale switcher, and a link that stays in the locale. */
function LocaleSwitcher() {
  const locale = useLocale();
  const alternates = useAlternates();
  const localized = useLocalizedHref();
  return (
    <nav data-locale={locale}>
      {alternates.map((alternate) => (
        <a key={alternate.locale} hrefLang={alternate.locale} href={alternate.href}>
          {alternate.label}
        </a>
      ))}
      <a rel="index" href={localized("/articles")}>
        Articles
      </a>
    </nav>
  );
}

const layoutOptions = {
  description: "",
  blocks: { before: [], after: [] },
  component: LocaleSwitcher,
  buildMetaTitle: ({ pageMetaTitle }: { pageMetaTitle: string }) => pageMetaTitle,
};

const app = createApp({
  blocks: [],
  collections: [articles],
  layouts: [
    createLayout("pokedex")({ ...layoutOptions, title: "Pokédex", kind: "singleton" }),
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
  projectSlug: "test",
  getCamoxApp: async () => app,
  renderPage: async () => "<main></main>",
};

const visit = (path: string, overrides: Partial<RuntimeOptions> = {}) =>
  handleCamoxRequest(new Request(`https://site.test${path}`), { ...options, ...overrides });

/** The `hreflang` alternates a document's head lists, as `hreflang → href`. */
async function hreflangsOf(response: Response | null): Promise<Record<string, string>> {
  assert.equal(response?.status, 200);
  const html = await response!.clone().text();
  const head = html.slice(0, html.indexOf("</head>"));
  const links: Record<string, string> = {};
  for (const [tag] of head.matchAll(/<link [^>]*hreflang=[^>]*>/g)) {
    const hreflang = tag.match(/hreflang="([^"]*)"/)![1]!;
    assert.ok(!(hreflang in links), `${hreflang} is listed once`);
    links[hreflang] = tag.match(/href="([^"]*)"/)![1]!;
  }
  return links;
}

void test("a page in English and German lists both with hreflang, plus x-default for English", async (t) => {
  mockApi(t);
  const expected = {
    en: "https://site.test/pricing",
    de: "https://site.test/de/preise",
    "x-default": "https://site.test/pricing",
  };
  assert.deepEqual(await hreflangsOf(await visit("/pricing")), expected);
  assert.deepEqual(await hreflangsOf(await visit("/de/preise")), expected);
});

void test("a page removed from German lists English only", async (t) => {
  mockApi(t);
  assert.deepEqual(await hreflangsOf(await visit("/about")), {
    en: "https://site.test/about",
    "x-default": "https://site.test/about",
  });
});

void test("a page only German has lists German without x-default", async (t) => {
  mockApi(t);
  assert.deepEqual(await hreflangsOf(await visit("/de/impressum")), {
    de: "https://site.test/de/impressum",
  });
});

void test("a record page lists the record's page in every locale it exists in", async (t) => {
  mockApi(t);
  const expected = {
    en: "https://site.test/articles/hello",
    de: "https://site.test/de/articles/hallo",
    "x-default": "https://site.test/articles/hello",
  };
  assert.deepEqual(await hreflangsOf(await visit("/de/articles/hallo")), expected);
  assert.deepEqual(await hreflangsOf(await visit("/articles/english-only")), {
    en: "https://site.test/articles/english-only",
    "x-default": "https://site.test/articles/english-only",
  });
});

void test("a singleton exists in every locale, at its route under each prefix", async (t) => {
  mockApi(t);
  assert.deepEqual(await hreflangsOf(await visit("/de/pokedex")), {
    en: "https://site.test/pokedex",
    de: "https://site.test/de/pokedex",
    "x-default": "https://site.test/pokedex",
  });
});

/** A sitemap's URLs, each with its `xhtml:link` alternates as `hreflang → href`. */
async function sitemapOf(response: Response | null) {
  assert.equal(response?.status, 200);
  const xml = await response!.text();
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(([, entry]) => {
    const alternates: Record<string, string> = {};
    for (const [, hreflang, href] of entry!.matchAll(
      /<xhtml:link rel="alternate" hreflang="([^"]*)" href="([^"]*)"\/>/g,
    ))
      alternates[hreflang!] = href!;
    return { loc: entry!.match(/<loc>(.*)<\/loc>/)![1]!, alternates };
  });
}

void test("the sitemap lists each localization once, with its alternates, leaving out removed ones", async (t) => {
  mockApi(t);
  const pricing = {
    en: "https://site.test/pricing",
    de: "https://site.test/de/preise",
    "x-default": "https://site.test/pricing",
  };
  const pokedex = {
    en: "https://site.test/pokedex",
    de: "https://site.test/de/pokedex",
    "x-default": "https://site.test/pokedex",
  };
  const hello = {
    en: "https://site.test/articles/hello",
    de: "https://site.test/de/articles/hallo",
    "x-default": "https://site.test/articles/hello",
  };
  const about = { en: "https://site.test/about", "x-default": "https://site.test/about" };
  const englishOnly = {
    en: "https://site.test/articles/english-only",
    "x-default": "https://site.test/articles/english-only",
  };
  const entries = await sitemapOf(await visit("/sitemap.xml"));
  assert.deepEqual(
    entries.sort((a, b) => a.loc.localeCompare(b.loc)),
    [
      { loc: "https://site.test/about", alternates: about },
      { loc: "https://site.test/articles/english-only", alternates: englishOnly },
      { loc: "https://site.test/articles/hello", alternates: hello },
      { loc: "https://site.test/de/articles/hallo", alternates: hello },
      {
        loc: "https://site.test/de/impressum",
        alternates: { de: "https://site.test/de/impressum" },
      },
      { loc: "https://site.test/de/pokedex", alternates: pokedex },
      { loc: "https://site.test/de/preise", alternates: pricing },
      { loc: "https://site.test/pokedex", alternates: pokedex },
      { loc: "https://site.test/pricing", alternates: pricing },
    ],
  );
});

Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true, React });

/** Renders pages with the page app, as a website's server does. */
const withPageApp: Partial<RuntimeOptions> = {
  renderPage: (input) => renderPageWithApp({ ...input, camoxApp: app }),
};

/** What a page's locale switcher shows: its locale, its alternates and its localized link. */
async function switcherOf(response: Response | null) {
  assert.equal(response?.status, 200);
  const html = await response!.text();
  const nav = html.match(/<nav data-locale="([^"]*)">([\s\S]*?)<\/nav>/);
  assert.ok(nav, "the layout renders its switcher");
  return {
    locale: nav[1],
    alternates: [...nav[2]!.matchAll(/<a hrefLang="([^"]*)" href="([^"]*)">([^<]*)<\/a>/g)].map(
      ([, locale, href, label]) => ({ locale, href, label }),
    ),
    link: nav[2]!.match(/<a rel="index" href="([^"]*)"/)?.[1],
  };
}

void test("the alternates hook lists the locales the page exists in, labelled in their own language", async (t) => {
  mockApi(t);
  const german = await switcherOf(await visit("/de/articles/hallo", withPageApp));
  assert.equal(german.locale, "de");
  assert.deepEqual(german.alternates, [
    { locale: "en", href: "/articles/hello", label: "English" },
    { locale: "de", href: "/de/articles/hallo", label: "Deutsch" },
  ]);
  const englishOnly = await switcherOf(await visit("/articles/english-only", withPageApp));
  assert.equal(englishOnly.locale, "en");
  assert.deepEqual(englishOnly.alternates, [
    { locale: "en", href: "/articles/english-only", label: "English" },
  ]);
});

void test("the link helper keeps root-relative paths in the page's locale", async (t) => {
  mockApi(t);
  assert.equal((await switcherOf(await visit("/de/pokedex", withPageApp))).link, "/de/articles");
  assert.equal((await switcherOf(await visit("/pokedex", withPageApp))).link, "/articles");
});

void test("a project with one locale lists no hreflang", async (t) => {
  mockApi(t);
  const api = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (request: Request) =>
    new URL(request.url).pathname.endsWith("/locales/list")
      ? localesResponse(["en"])
      : api(request),
  );
  assert.deepEqual(await hreflangsOf(await visit("/pricing")), {});
});
