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

async function request(path: string) {
  const { renderPageWithApp } = await import("./pageServer");
  return handleCamoxRequest(
    new Request(`https://site.test${path}`, { headers: { Cookie: "camox_auth_cookie=valid" } }),
    {
      apiUrl: "https://api.test",
      authenticationUrl: "https://auth.test",
      projectUuid: "test",
      getCamoxApp: async () => camoxApp,
      renderPage: (input) => renderPageWithApp({ ...input, camoxApp }),
    },
  );
}

void test("a member's page in a draft renders the draft's content on the server", async (t) => {
  Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true, React });
  mockApi(t);
  const draft = await request("/?camox-draft=d1");
  assert.equal(draft!.status, 200);
  // A member sees the page in the studio, around the page as visitors see it.
  const data = (await draft!.text()).match(
    /<script id="__CAMOX_DATA__" type="application\/json">(.*?)<\/script>/s,
  )![1];
  const { previewDocument } = JSON.parse(data) as { previewDocument: string };
  assert.match(previewDocument, /<h1><span>Draft title<\/span><\/h1>/);
});
