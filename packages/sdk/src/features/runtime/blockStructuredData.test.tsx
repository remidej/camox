import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { LOCALE_HEADER } from "@camox/api-contract/drafts";
import * as React from "react";

import { createApp } from "../../core/createApp";
import { createLayout } from "../../core/createLayout";
import { localesResponse, pageListResponse } from "./api.fixtures";
import { handleCamoxRequest, type RuntimeOptions } from "./runtime";

// Blocks describe the things they show as their own nodes, which the API evaluates from their
// templates. Camox links each node to the page it's on, whether a page or its layout places
// the block, and turns links to the website's pages into absolute URLs. Only the layout says
// what the page itself is.

Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true, React });

// The image renderer, which the SDK imports through its own package exports, from source.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier !== "camox/_internal/imageResponse") return nextResolve(specifier, context);
    return nextResolve(new URL("../og/imageResponse.ts", import.meta.url).href, context);
  },
});

const project = { id: 1, name: "Real project", slug: "test", updatedAt: 1 };

const question = (name: string, text: string) => ({
  "@type": "Question",
  name,
  acceptedAnswer: { "@type": "Answer", text },
});

/** Block ids, by what they hold. */
const BLOCKS = {
  navbar: "0199f0a0-0000-7000-8000-0000000000b0",
  shipping: "0199f0a0-0000-7000-8000-0000000000b1",
  billing: "0199f0a0-0000-7000-8000-0000000000b2",
  lamp: "0199f0a0-0000-7000-8000-0000000000b3",
  footer: "0199f0a0-0000-7000-8000-0000000000b4",
  store: "0199f0a0-0000-7000-8000-0000000000b5",
};

/** Each block's nodes, as the API evaluates them for every page read. */
const STRUCTURED_DATA = {
  [BLOCKS.navbar]: [{ "@type": "VideoObject", name: "Intro", embedUrl: "https://video.test/1" }],
  [BLOCKS.shipping]: [question("How long?", "Two days"), question("Where?", "Anywhere")],
  [BLOCKS.billing]: [question("How much?", "Free")],
  [BLOCKS.lamp]: [
    {
      "@type": "Product",
      name: "Desk lamp",
      url: { "@camox": "pageUrl", path: "/preise", locale: "de" },
      offers: { "@type": "Offer", price: 49, priceCurrency: "EUR" },
      isRelatedTo: { "@type": "Product", url: { "@camox": "pageUrl", path: "/pricing" } },
    },
  ],
  [BLOCKS.footer]: [{ "@type": "Review", author: { "@type": "Person", name: "Bo" } }],
  [BLOCKS.store]: [{ "@type": "Product", name: "Store lamp", offers: { price: 9 } }],
};

const PAGE = {
  id: "0199f0a0-0000-7000-8000-000000000001",
  fullPath: "/help",
  layoutId: "regular",
  metaTitle: "Help",
  metaDescription: "Answers",
  firstPublishedAt: null,
  publishedAt: null,
};

const notFound = () =>
  Response.json(
    { json: { defined: false, code: "NOT_FOUND", status: 404, message: "Not found" } },
    { status: 404 },
  );

/** An API whose Live has a help page in English and German, and the blocks above. */
function mockApi(t: { mock: { method: typeof test.mock.method } }) {
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const procedure = new URL(request.url).pathname.replace(/^\/rpc\//, "");
    const locale = request.headers.get(LOCALE_HEADER) ?? "en";
    if (procedure === "projects/getByUuid") return notFound();
    if (procedure === "locales/list") return localesResponse(["en", "de"]);
    if (procedure === "pages/listBySlug")
      return pageListResponse([{ ...PAGE, nickname: "Help", updatedAt: 1 }], project.name);
    if (procedure === "pages/getByPath") {
      const { json: input } = (await request.json()) as { json: { path: string } };
      if (input.path !== PAGE.fullPath) return notFound();
      return Response.json({
        json: {
          page: {
            ...PAGE,
            pathSegment: "help",
            blockIds: [BLOCKS.shipping, BLOCKS.billing, BLOCKS.lamp],
            locale,
          },
          layout: {
            id: 1,
            layoutId: PAGE.layoutId,
            beforeBlockIds: [BLOCKS.navbar],
            afterBlockIds: [BLOCKS.footer],
          },
          project,
          projectName: project.name,
          blocks: [],
          files: [],
          repeatableItems: [],
          structuredData: STRUCTURED_DATA,
        },
      });
    }
    if (procedure === "layouts/get") {
      return Response.json({
        json: {
          projectName: project.name,
          project,
          layout: {
            id: 2,
            layoutId: "store",
            beforeBlockIds: [BLOCKS.store],
            afterBlockIds: [],
          },
          blocks: [],
          files: [],
          repeatableItems: [],
          structuredData: STRUCTURED_DATA,
        },
      });
    }
    throw new Error(`Unexpected API request ${procedure}`);
  });
}

const app = createApp({
  blocks: [],
  layouts: [
    createLayout("regular")({
      title: "Regular",
      description: "",
      kind: "curated",
      blocks: { before: [], after: [] },
      toReact: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
      toTitle: ({ page }) => page.title,
      toDescription: ({ page }) => page.description,
    }),
    createLayout("store")({
      title: "Store",
      description: "",
      kind: "singleton",
      blocks: { before: [], after: [] },
      toReact: () => <main />,
      toTitle: () => "Store",
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
  const [website] = ofType("WebSite");
  const [page] = graph.filter(
    (node) => (node.isPartOf as { "@id"?: string })?.["@id"] === website?.["@id"],
  );
  return { graph, ofType, page: page! };
}

void test("a page has one Question node per FAQ item, each part of the page, which stays a WebPage", async (t) => {
  mockApi(t);
  const { ofType, page } = await graphOf("/help");

  const questions = ofType("Question");
  assert.deepEqual(
    questions.map((node) => node.name),
    ["How long?", "Where?", "How much?"],
  );
  for (const node of questions) {
    assert.deepEqual(node.isPartOf, { "@id": page["@id"] });
    assert.equal("subjectOf" in node, false);
  }
  assert.deepEqual(questions[0]!.acceptedAnswer, { "@type": "Answer", text: "Two days" });
  assert.deepEqual([page["@type"]].flat(), ["WebPage"]);
});

void test("every placement's nodes stand on their own, layout slots included", async (t) => {
  mockApi(t);
  const { graph, ofType } = await graphOf("/help");

  const ids = graph.map((node) => node["@id"]);
  assert.equal(new Set(ids).size, ids.length, "every node has its own @id");
  for (const id of ids) assert.match(String(id), /^https:\/\/site\.test\//);
  // The layout's blocks, before and after the page's.
  assert.equal(ofType("VideoObject").length, 1);
  assert.equal(ofType("Review").length, 1);
  // Blocks' nodes follow the placements' order.
  const order = graph
    .filter((node) =>
      ["VideoObject", "Question", "Product", "Review"].includes(String(node["@type"])),
    )
    .map((node) => node["@type"]);
  assert.deepEqual(order, ["VideoObject", "Question", "Question", "Question", "Product", "Review"]);
});

void test("creative works are part of the page, other things are its subject", async (t) => {
  mockApi(t);
  const { ofType, page } = await graphOf("/help");

  const [review] = ofType("Review");
  assert.deepEqual(review!.isPartOf, { "@id": page["@id"] });
  const [product] = ofType("Product");
  assert.deepEqual(product!.subjectOf, { "@id": page["@id"] });
  assert.equal("isPartOf" in product!, false);
});

void test("links to the website's pages become absolute URLs in their locale", async (t) => {
  mockApi(t);
  const { ofType } = await graphOf("/help");

  const [product] = ofType("Product");
  assert.equal(product!.url, "https://site.test/de/preise");
  assert.deepEqual(product!.isRelatedTo, { "@type": "Product", url: "https://site.test/pricing" });
});

void test("a singleton page's layout blocks emit their nodes too", async (t) => {
  mockApi(t);
  const { ofType, page } = await graphOf("/store");

  const [product] = ofType("Product");
  assert.equal(product!.name, "Store lamp");
  assert.deepEqual(product!.subjectOf, { "@id": page["@id"] });
});
