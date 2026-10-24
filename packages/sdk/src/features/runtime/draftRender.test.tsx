import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { DRAFT_HEADER } from "@camox/api-contract/drafts";
import * as React from "react";

import { createApp } from "../../core/createApp";
import { createBlock, type Block, type ContentFieldBuilder } from "../../core/createBlock";
import { localesResponse, pageListResponse } from "./api.fixtures";
import { handleCamoxRequest } from "./runtime";

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

/** An API where the valid session is a member, and a request naming a draft reads the draft. */
function mockApi(t: { mock: { method: typeof test.mock.method } }) {
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const url = new URL(request.url);
    const source = request.headers.get(DRAFT_HEADER) ? "Draft title" : "Live title";
    if (url.pathname.endsWith("/locales/list")) return localesResponse();
    if (url.pathname.endsWith("/getByUuid")) return Response.json({ json: project });
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
}

async function request(path: string, { member = true } = {}) {
  const { renderPageWithApp } = await import("./pageServer");
  return handleCamoxRequest(
    new Request(
      `https://site.test${path}`,
      member ? { headers: { Cookie: "camox_auth_cookie=valid" } } : {},
    ),
    {
      apiUrl: "https://api.test",
      authenticationUrl: "https://auth.test",
      projectUuid: "test",
      getCamoxApp: async () => camoxApp,
      renderPage: (input) => renderPageWithApp({ ...input, camoxApp }),
      // In dev, a page preloads its blocks' modules.
      blockPreloads: { modulePaths: { hero: "/src/blocks/hero.tsx" }, chunks: null },
    },
  );
}

const BLOCK_PRELOAD = '<link rel="modulepreload" href="/src/blocks/hero.tsx">';

void test("a member's document renders no block of the site: a loading screen holds the page's place", async (t) => {
  Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true, React });
  mockApi(t);
  const { loadRuntimeChrome } = await import("./runtimeChromeLoader");
  await loadRuntimeChrome();
  const response = await request("/?camox-draft=d1");
  assert.equal(response!.status, 200);
  const html = await response!.text();
  // The studio chrome is there, so this is the member's document.
  assert.match(html, /Real project/);
  // Only the renderer frame runs the site's code, the draft's own for a draft with code.
  assert.doesNotMatch(html, /<h1|&lt;h1/);
  const data = html.match(
    /<script id="__CAMOX_DATA__" type="application\/json">(.*?)<\/script>/s,
  )![1];
  const { previewDocument } = JSON.parse(data) as { previewDocument: string };
  assert.doesNotMatch(previewDocument, /<h1/);
  assert.match(html, /role="status"[^>]*aria-label="Loading the page"/);
  assert.ok(!html.includes(BLOCK_PRELOAD), "nor does it load the site's blocks");
});

void test("a visitor's page renders its blocks on the server, and preloads them", async (t) => {
  Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true, React });
  mockApi(t);
  const html = await (await request("/", { member: false }))!.text();
  assert.match(html, /<h1><span>Live title<\/span><\/h1>/);
  assert.ok(html.includes(BLOCK_PRELOAD));
});
