import assert from "node:assert/strict";
import { test } from "node:test";

import { LOCALE_HEADER } from "@camox/api-contract/drafts";

import { createApp } from "../../core/createApp";
import { createLayout } from "../../core/createLayout";
import { localesResponse, pageListResponse } from "./api.fixtures";
import { handleCamoxRequest, type RuntimeOptions } from "./runtime";

// A page request waits on the API for each read it can't start yet: the time to its first byte
// is the sum of those waits. A read starts as soon as what it needs is known, and a locale's
// pages are read once, whatever reads them.

const project = { id: 1, name: "Real project", slug: "test", updatedAt: 1 };
const PRICING = "0199f0a0-0000-7000-8000-000000000001";

/** The pricing page in each of Live's locales: English, the default locale, French and Spanish. */
const PRICING_PATHS: Record<string, string> = { en: "/pricing", fr: "/prix", es: "/precios" };
const TAGS = ["en", "fr", "es"];

/** How long the API takes to answer each read, in milliseconds: a page's read is the slowest. */
const LATENCY: Record<string, number> = { "pages/getByPath": 40 };
const DEFAULT_LATENCY = 10;

/** One read of the API: its procedure and locale, and the reads still unanswered as it started. */
type ApiRead = { read: string; startedDuring: string[] };

const notFound = () =>
  Response.json(
    { json: { defined: false, code: "NOT_FOUND", status: 404, message: "Not found" } },
    { status: 404 },
  );

/** An API that answers each read after its latency, recording the reads in flight. */
function mockApi(t: { mock: { method: typeof test.mock.method } }) {
  const reads: ApiRead[] = [];
  const pending = new Set<string>();
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const procedure = new URL(request.url).pathname.replace(/^\/rpc\//, "");
    const locale = request.headers.get(LOCALE_HEADER) ?? "en";
    const read = procedure === "locales/list" ? procedure : `${procedure} ${locale}`;
    reads.push({ read, startedDuring: [...pending] });
    pending.add(read);
    await new Promise((resolve) => setTimeout(resolve, LATENCY[procedure] ?? DEFAULT_LATENCY));
    pending.delete(read);
    if (procedure === "projects/getByUuid") return notFound();
    if (procedure === "locales/list") return localesResponse(TAGS);
    if (procedure === "pages/listBySlug")
      return pageListResponse([
        { id: PRICING, nickname: "Pricing", fullPath: PRICING_PATHS[locale], layoutId: "regular" },
      ]);
    if (procedure === "pages/getByPath") {
      const { json: input } = (await request.json()) as { json: { path: string } };
      if (input.path !== PRICING_PATHS[locale]) return notFound();
      return Response.json({
        json: {
          page: { id: PRICING, fullPath: input.path, pathSegment: input.path.slice(1), locale },
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
    throw new Error(`Unexpected API request ${procedure}`);
  });
  return reads;
}

const options: RuntimeOptions = {
  apiUrl: "https://api.test",
  authenticationUrl: "https://auth.test",
  projectUuid: "test",
  getCamoxApp: async () =>
    createApp({
      blocks: [],
      layouts: [
        createLayout("pokedex")({
          title: "Pokédex",
          description: "",
          kind: "singleton",
          blocks: { before: [], after: [] },
          toReact: () => null,
          toTitle: () => "Pokédex",
          toDescription: () => undefined,
        }),
      ],
    }),
  renderPage: async () => "<main></main>",
};

/** Requests a page as a visitor does, checking it lists the page in every locale. */
async function visit(path: string) {
  const response = await handleCamoxRequest(new Request(`https://site.test${path}`), options);
  assert.equal(response?.status, 200);
  const html = await response!.text();
  for (const href of ["/pricing", "/fr/prix", "/es/precios"]) {
    assert.ok(html.includes(`href="https://site.test${href}"`), `${path} lists ${href}`);
  }
}

/** The reads a read started during. */
const startedDuring = (reads: readonly ApiRead[], read: string) =>
  reads.find((candidate) => candidate.read === read)?.startedDuring ?? [];

/** Whether two reads were in flight together. */
const together = (reads: readonly ApiRead[], a: string, b: string) =>
  startedDuring(reads, a).includes(b) || startedDuring(reads, b).includes(a);

void test("a page in the default locale is read alongside the locales, and the other locales' pages alongside it", async (t) => {
  const reads = mockApi(t);
  await visit("/pricing");
  // A default-locale page is at its own path: its read doesn't wait for the locales.
  assert.ok(together(reads, "pages/getByPath en", "locales/list"));
  // Once the locales are known, the other locales' pages are read while the page still is.
  assert.ok(together(reads, "pages/listBySlug fr", "pages/getByPath en"));
  assert.ok(together(reads, "pages/listBySlug es", "pages/getByPath en"));
  // Each locale's pages are read once: the head reuses those the page's read loaded.
  assert.deepEqual(reads.map(({ read }) => read).sort(), [
    "locales/list",
    "pages/getByPath en",
    "pages/listBySlug en",
    "pages/listBySlug es",
    "pages/listBySlug fr",
  ]);
});

void test("a page under a locale's prefix is read once the locales name its locale, with every locale's pages alongside", async (t) => {
  const reads = mockApi(t);
  await visit("/fr/prix");
  assert.ok(!together(reads, "pages/getByPath fr", "locales/list"));
  for (const tag of TAGS) {
    assert.ok(together(reads, `pages/listBySlug ${tag}`, "pages/getByPath fr"), tag);
  }
  assert.deepEqual(reads.map(({ read }) => read).sort(), [
    "locales/list",
    "pages/getByPath fr",
    "pages/listBySlug en",
    "pages/listBySlug es",
    "pages/listBySlug fr",
  ]);
});

void test("a singleton's page reads no curated page", async (t) => {
  const reads = mockApi(t);
  const response = await handleCamoxRequest(new Request("https://site.test/pokedex"), options);
  assert.equal(response?.status, 200);
  assert.ok(!reads.some(({ read }) => read.startsWith("pages/getByPath")));
});
