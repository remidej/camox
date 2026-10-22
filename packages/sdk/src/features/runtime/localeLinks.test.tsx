import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { DRAFT_HEADER, LOCALE_HEADER } from "@camox/api-contract/drafts";
import * as React from "react";

import { createApp } from "../../core/createApp";
import { createBlock, type Block, type ContentFieldBuilder } from "../../core/createBlock";
import { localesResponse, pageListResponse } from "./api.fixtures";
import { handleCamoxRequest } from "./runtime";

// Localizations keep their original's id (ADR 0015), so a page link names the same page in every
// locale: it leads to the rendered locale's page, or to the default locale's page when the
// rendered locale has none.

// The URL is supplied by Vite in applications.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("virtual:camox-"))
      return {
        url: `data:text/javascript,export default ${JSON.stringify("/studio.css")}`,
        shortCircuit: true,
      };
    return nextResolve(specifier, context);
  },
});

const project = { id: 1, name: "Real project", slug: "test", updatedAt: 1 };
const homeId = "0199f0a0-0000-7000-8000-000000000001";
const pricingId = "0199f0a0-0000-7000-8000-000000000002";
/** A page the German locale left out. */
const teamId = "0199f0a0-0000-7000-8000-000000000003";
const blockId = "0199f0a0-0000-7000-8000-00000000000b";

const DRAFT = "0199f0a0-0000-7000-8000-00000000d1d1";

/**
 * Each locale's pages on Live: German translated the pricing page's path and has no team page.
 * The draft translates the team page into German and removes the pricing page from it.
 */
const PAGES: Record<"live" | "draft", Record<string, { id: string; fullPath: string }[]>> = {
  live: {
    en: [
      { id: homeId, fullPath: "/" },
      { id: pricingId, fullPath: "/pricing" },
      { id: teamId, fullPath: "/team" },
    ],
    de: [
      { id: homeId, fullPath: "/" },
      { id: pricingId, fullPath: "/preise" },
    ],
  },
  draft: {
    en: [
      { id: homeId, fullPath: "/" },
      { id: pricingId, fullPath: "/pricing" },
      { id: teamId, fullPath: "/team" },
    ],
    de: [
      { id: homeId, fullPath: "/" },
      { id: teamId, fullPath: "/das-team" },
    ],
  },
};

const links = createBlock({
  id: "links",
  title: "Links",
  description: "Links to other pages",
  content: (field: ContentFieldBuilder) => ({
    pricing: field.link({ default: { text: "", href: "/", newTab: false } }),
    team: field.link({ default: { text: "", href: "/", newTab: false } }),
    body: field.string({ default: "" }),
  }),
  toReact: () => (
    <nav>
      <links.Link name="pricing">{({ to, children }) => <a href={to}>{children}</a>}</links.Link>
      <links.Link name="team">{({ to, children }) => <a href={to}>{children}</a>}</links.Link>
      <links.Field name="body">{(props) => <p {...props} />}</links.Field>
    </nav>
  ),
  toMarkdown: () => [],
});
const camoxApp = createApp({ blocks: [links as unknown as Block] });

/**
 * An API whose Live has English, the default locale, and German. The valid session is a member's,
 * and a request naming the draft reads it.
 */
function mockApi(t: { mock: { method: typeof test.mock.method } }) {
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const url = new URL(request.url);
    const locale = request.headers.get(LOCALE_HEADER) ?? "en";
    const scope = request.headers.get(DRAFT_HEADER) === DRAFT ? "draft" : "live";
    if (url.pathname.endsWith("/locales/list")) return localesResponse(["en", "de"]);
    if (url.pathname.endsWith("/getByUuid")) return Response.json({ json: project });
    if (url.pathname.endsWith("/listBySlug"))
      return pageListResponse(
        PAGES[scope][locale]!.map((page) => ({ ...page, updatedAt: 1, layoutId: "default" })),
      );
    if (url.pathname.endsWith("/getByPath")) {
      const { json: input } = (await request.json()) as { json: { path: string } };
      const page = PAGES[scope][locale]!.find(({ fullPath }) => fullPath === input.path);
      if (!page)
        return Response.json(
          { json: { defined: false, code: "NOT_FOUND", status: 404, message: "Not found" } },
          { status: 404 },
        );
      return Response.json({
        json: {
          page: { ...page, metaTitle: "Page", layoutId: null, locale, blockIds: [blockId] },
          layout: null,
          project,
          projectName: project.name,
          blocks: [
            {
              id: blockId,
              pageId: page.id,
              type: "links",
              content: {
                pricing: { type: "page", pageId: pricingId, text: "Pricing", newTab: false },
                team: { type: "page", pageId: teamId, text: "Team", newTab: false },
                body: `See [our prices](camox:page:${pricingId}) and [the team](camox:page:${teamId}).`,
              },
              settings: {},
              position: "a0",
            },
          ],
          files: [],
          repeatableItems: [],
        },
      });
    }
    return Response.json({ json: null });
  });
}

/** The page at `path` as the server renders it for a visitor, or for a member with `headers`. */
async function visit(path: string, headers: Record<string, string> = {}) {
  const { renderPageWithApp } = await import("./pageServer");
  const response = await handleCamoxRequest(new Request(`https://site.test${path}`, { headers }), {
    apiUrl: "https://api.test",
    authenticationUrl: "https://auth.test",
    projectUuid: "test",
    getCamoxApp: async () => camoxApp,
    renderPage: (input) => renderPageWithApp({ ...input, camoxApp }),
  });
  assert.equal(response?.status, 200);
  return response!.text();
}

/** The hrefs of the links the block renders, by their text. */
function hrefsIn(html: string) {
  const main = html.match(/<nav>(.*?)<\/nav>/s)![1]!;
  return Object.fromEntries(
    [...main.matchAll(/<a[^>]*href="([^"]*)"[^>]*>(?:<[^>]+>)*([^<]+)/g)].map(([, href, text]) => [
      text,
      href,
    ]),
  );
}

void test("page links on a German page lead to German pages, and to the default locale's page where German has none", async (t) => {
  Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true, React });
  mockApi(t);
  assert.deepEqual(hrefsIn(await visit("/de")), {
    // A link field and a text link to the pricing page.
    Pricing: "/de/preise",
    "our prices": "/de/preise",
    // The team page is missing from German.
    Team: "/team",
    "the team": "/team",
  });
});

void test("page links on a default-locale page lead to default-locale pages", async (t) => {
  Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true, React });
  mockApi(t);
  assert.deepEqual(hrefsIn(await visit("/")), {
    Pricing: "/pricing",
    "our prices": "/pricing",
    Team: "/team",
    "the team": "/team",
  });
});

void test("a member's draft in German links to the draft's German pages, and to the default locale's page where the draft's German has none", async (t) => {
  Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true, React });
  mockApi(t);
  const html = await visit(`/de?camox-draft=${DRAFT}`, { Cookie: "camox_auth_cookie=valid" });
  // A member sees the page in the studio, around the page as visitors see it.
  const data = html.match(
    /<script id="__CAMOX_DATA__" type="application\/json">(.*?)<\/script>/s,
  )![1]!;
  const { previewDocument } = JSON.parse(data) as { previewDocument: string };
  assert.deepEqual(hrefsIn(previewDocument), {
    // The draft removed the pricing page from German.
    Pricing: "/pricing",
    "our prices": "/pricing",
    Team: "/de/das-team",
    "the team": "/de/das-team",
  });
});
