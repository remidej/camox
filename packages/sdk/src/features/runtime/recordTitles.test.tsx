import assert from "node:assert/strict";
import { test } from "node:test";

import * as React from "react";

import { createApp } from "../../core/createApp";
import { createCollection } from "../../core/createCollection";
import { createLayout } from "../../core/createLayout";
import { localesResponse, pageListResponse } from "./api.fixtures";
import { renderPageWithApp } from "./pageServer";
import { handleCamoxRequest, type RuntimeOptions } from "./runtime";

// A collection's `toTitle` and `toDescription` name its records: the API evaluates them, and
// record pages, `llms.txt` and the head read the title and description it returns.

Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true, React });

const ADA = "0199f0a0-0000-7000-8000-0000000000a1";
const GRACE = "0199f0a0-0000-7000-8000-0000000000a2";
const project = { id: 1, name: "Pioneers", slug: "test", updatedAt: 1 };

const people = createCollection({
  id: "people",
  title: "People",
  description: "",
  content: (field) => ({
    firstName: field.string(),
    lastName: field.string(),
    role: field.string(),
    slug: field.string(),
  }),
  toTitle: ({ content }) => `${content.firstName} ${content.lastName}`,
  toDescription: ({ content }) => content.role,
});

/** Each record as the API returns it, with the title and description it evaluated. */
const RECORDS = [
  {
    id: ADA,
    title: "Ada Lovelace",
    description: "Mathematician",
    content: { firstName: "Ada", lastName: "Lovelace", role: "Mathematician", slug: "ada" },
  },
  {
    id: GRACE,
    title: "Grace Hopper",
    description: null,
    content: { firstName: "Grace", lastName: "Hopper", role: "", slug: "grace" },
  },
];

function mockApi(t: { mock: { method: typeof test.mock.method } }) {
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const procedure = new URL(request.url).pathname.replace(/^\/rpc\//, "");
    if (procedure === "projects/getByUuid" || procedure === "pages/getByPath")
      return Response.json(
        { json: { defined: false, code: "NOT_FOUND", status: 404, message: "Not found" } },
        { status: 404 },
      );
    if (procedure === "layouts/get")
      return Response.json({
        json: {
          projectName: project.name,
          project,
          layout: { id: 1, layoutId: "people.$slug", beforeBlockIds: [], afterBlockIds: [] },
          blocks: [],
          files: [],
          repeatableItems: [],
        },
      });
    if (procedure === "locales/list") return localesResponse();
    if (procedure === "pages/listBySlug") return pageListResponse([], project.name);
    if (procedure === "collectionDefinitions/findRecordsByField") {
      const { json: input } = (await request.json()) as { json: { value: string } };
      return Response.json({
        json: RECORDS.filter((record) => record.content.slug === input.value).map((record) => ({
          ...record,
          references: {},
        })),
      });
    }
    throw new Error(`Unexpected API request ${procedure}`);
  });
}

const personLayout = createLayout("people.$slug")({
  title: "Person",
  description: "",
  kind: "derived",
  blocks: { before: [], after: [] },
  ...people.pages({ by: "slug", param: "slug" }),
  toReact: () => null,
  toTitle: ({ page, project }) => `${page.title} | ${project.name}`,
  toDescription: ({ page }) => page.description ?? "No description",
  toMarkdown: () => ["Person"],
});

function visit(path: string) {
  const app = createApp({ blocks: [], collections: [people], layouts: [personLayout] });
  const options: RuntimeOptions = {
    apiUrl: "https://api.test",
    authenticationUrl: "https://auth.test",
    projectUuid: "test",
    getCamoxApp: async () => app,
    renderPage: (input) => renderPageWithApp({ ...input, camoxApp: app }),
  };
  return handleCamoxRequest(new Request(`https://site.test${path}`), options);
}

async function headOf(response: Response | null) {
  assert.equal(response?.status, 200);
  const html = await response!.text();
  const head = html.slice(0, html.indexOf("</head>"));
  return {
    title: head.match(/<title>([^<]*)<\/title>/)?.[1],
    description: head.match(/<meta name="description" content="([^"]*)"/)?.[1],
  };
}

void test("a record without a description leaves its page's description absent", async (t) => {
  mockApi(t);
  assert.deepEqual(await headOf(await visit("/people/grace")), {
    title: "Grace Hopper | Pioneers",
    description: "No description",
  });
});
