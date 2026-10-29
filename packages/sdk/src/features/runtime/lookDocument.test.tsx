import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { DRAFT_HEADER, LOOK_TOKEN_HEADER } from "@camox/api-contract/drafts";
import { Window } from "happy-dom";
import * as React from "react";

import { createApp } from "../../core/createApp";
import { createBlock, type Block, type ContentFieldBuilder } from "../../core/createBlock";
import { localesResponse, pageListResponse } from "./api.fixtures";
import { handleCamoxRequest } from "./runtime";

// The lightweight document the agent's `look` tool captures (ADR 0032): a page of a draft, read
// with the look token its cookie carries, as a visitor would see it, without the studio.

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

const DRAFT = "0199f0a0-0000-7000-8000-0000000000d1";
const TOKEN = "look-token-for-d1";
const project = { id: 1, name: "Real project", slug: "test", updatedAt: 1 };
const pageId = "0199f0a0-0000-7000-8000-000000000001";
const blockId = "0199f0a0-0000-7000-8000-000000000002";

const hero = createBlock({
  id: "hero",
  title: "Hero",
  description: "A title",
  content: (field: ContentFieldBuilder) => ({ title: field.string({ default: "" }) }),
  toReact: () => <hero.Field name="title">{(props) => <h1 {...props} />}</hero.Field>,
  toMarkdown: ({ content }: { content: { title: string } }) => [content.title],
  toTitle: () => "Hero",
});
const camoxApp = createApp({ blocks: [hero as unknown as Block] });

/**
 * An API where only the look token `TOKEN` reads the draft `DRAFT`, as the API checks it: a
 * request naming a draft without it is refused. Returns the requests it got.
 */
function mockApi(t: { mock: { method: typeof test.mock.method } }) {
  const received: Request[] = [];
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    received.push(request);
    const url = new URL(request.url);
    const draft = request.headers.get(DRAFT_HEADER);
    if (draft && (draft !== DRAFT || request.headers.get(LOOK_TOKEN_HEADER) !== TOKEN))
      return Response.json(
        { json: { defined: true, code: "UNAUTHORIZED", status: 401, message: "Unauthorized" } },
        { status: 401 },
      );
    const source = draft ? "Draft title" : "Live title";
    if (url.pathname.endsWith("/locales/list")) return localesResponse();
    if (url.pathname.endsWith("/listBySlug"))
      return pageListResponse([
        { id: pageId, fullPath: "/", pathSegment: "", updatedAt: 1, layoutId: null },
      ]);
    if (url.pathname.endsWith("/getByPath"))
      return Response.json({
        json: {
          page: {
            id: pageId,
            fullPath: "/",
            pathSegment: "",
            metaTitle: source,
            layoutId: null,
            blockIds: [blockId],
          },
          layout: null,
          project,
          projectName: project.name,
          blocks: [
            {
              id: blockId,
              pageId,
              type: "hero",
              content: { title: source },
              settings: {},
              position: "a0",
            },
          ],
          files: [],
          repeatableItems: [],
        },
      });
    return Response.json({ json: null });
  });
  return received;
}

async function look({ token = TOKEN as string | null, draft = DRAFT } = {}) {
  Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true, React });
  const { renderPageWithApp } = await import("./pageServer");
  const response = await handleCamoxRequest(
    new Request(`https://site.test/_camox/look?camox-draft=${draft}&path=/`, {
      headers: token ? { Cookie: `other=1; camox_look=${token}` } : {},
    }),
    {
      apiUrl: "https://api.test",
      authenticationUrl: "https://auth.test",
      projectUuid: "test",
      getCamoxApp: async () => camoxApp,
      renderPage: (input) => renderPageWithApp({ ...input, camoxApp }),
      stylesheetUrl: "/site.css",
      studioStylesheetUrl: "/studio.css",
      blockPreloads: { modulePaths: { hero: "/src/blocks/hero.tsx" }, chunks: null },
    },
  );
  assert.ok(response);
  return { response, html: await response.text() };
}

void test("renders a page of the draft with the draft's content, as a visitor sees it", async (t) => {
  mockApi(t);
  const { response, html } = await look();
  assert.equal(response.status, 200);
  assert.match(html, /<h1><span>Draft title<\/span><\/h1>/);
  // The site's own stylesheet, and the blocks the page's client hydrates.
  assert.match(html, /<link rel="stylesheet" href="\/site.css">/);
  assert.ok(html.includes('<link rel="modulepreload" href="/src/blocks/hero.tsx">'));
  assert.match(response.headers.get("Cache-Control") ?? "", /no-store/);
});

void test("reads the draft's content with the look token", async (t) => {
  const received = mockApi(t);
  await look();
  const reads = received.filter((request) => request.headers.get(DRAFT_HEADER));
  assert.ok(reads.length > 0);
  for (const request of received) assert.equal(request.headers.get(LOOK_TOKEN_HEADER), TOKEN);
});

void test("has no studio markup or stylesheet", async (t) => {
  mockApi(t);
  const { html } = await look();
  assert.ok(!html.includes("/studio.css"));
  // The studio's theme script and stylesheet are marked `data-camox-studio`.
  assert.doesNotMatch(html, /data-camox-studio|Loading Studio/);
});

void test("shows no draft content without a look token, or with one the API refuses", async (t) => {
  mockApi(t);
  for (const token of [null, "expired-or-for-another-draft"]) {
    const { response, html } = await look({ token });
    assert.equal(response.status, 404);
    assert.doesNotMatch(html, /Draft title|Live title/);
  }
});

void test("shows no draft content for a draft its token isn't for", async (t) => {
  mockApi(t);
  const { response, html } = await look({ draft: "0199f0a0-0000-7000-8000-0000000000d2" });
  assert.equal(response.status, 404);
  assert.doesNotMatch(html, /Draft title|Live title/);
});

void test("hydrates, then marks itself ready once the page has loaded", async (t) => {
  mockApi(t);
  const { html } = await look();
  const window = new Window({
    url: `https://site.test/_camox/look?camox-draft=${DRAFT}&path=/`,
    settings: { enableJavaScriptEvaluation: true },
  });
  Object.assign(globalThis, {
    window,
    document: window.document,
    location: window.location,
    localStorage: window.localStorage,
    HTMLElement: window.HTMLElement,
    HTMLIFrameElement: window.HTMLIFrameElement,
    Element: window.Element,
    Node: window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  // React reports hydration mismatches as errors.
  const errors: unknown[] = [];
  t.mock.method(console, "error", (...args: unknown[]) => errors.push(args));
  Object.assign(globalThis, { reportError: (error: unknown) => errors.push(error) });
  try {
    window.document.write(html.replace(/<script type="module"[^>]*><\/script>/g, ""));
    await window.happyDOM.waitUntilComplete();
    const ready = () => window.document.documentElement.hasAttribute("data-camox-ready");
    assert.equal(ready(), false, "not before the page's client hydrated it");

    const { hydratePageWithApp } = await import("./pageClient");
    await React.act(async () => {
      await hydratePageWithApp(camoxApp);
    });
    await window.happyDOM.waitUntilComplete();
    assert.deepEqual(errors, []);
    assert.equal(ready(), true);
  } finally {
    await window.happyDOM.close();
  }
});
