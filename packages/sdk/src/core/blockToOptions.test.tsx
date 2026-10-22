import assert from "node:assert/strict";
import { test } from "node:test";

import * as React from "react";

import { localesResponse, pageListResponse } from "../features/runtime/api.fixtures";
import { renderPageWithApp } from "../features/runtime/pageServer";
import { handleCamoxRequest } from "../features/runtime/runtime";
import { createApp } from "./createApp";
import { createBlock, type Block } from "./createBlock";

// Blocks and repeatable items declare their outputs as `to*` options: `toReact` renders the block
// with `{ content, settings }` as props, and `toMarkdown` and `toTitle` read
// `({ content, settings })`.

Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true, React });

const fields = {
  id: "hero",
  title: "Hero",
  description: "The page's opening",
  content: (field: any) => ({
    title: field.string({ default: "Welcome" }),
    cta: field.string({ default: "Start" }),
    items: field.repeater({
      content: (item: any) => ({ name: item.string({ default: "Item" }) }),
      settings: (setting: any) => ({ featured: setting.boolean({ default: false }) }),
      minItems: 1,
      maxItems: 3,
      toMarkdown: ({ content, settings }: any) => [
        `- ${content.name}`,
        settings.featured("(featured)"),
      ],
      toTitle: () => "Item",
    }),
  }),
  settings: (setting: any) => ({
    showCta: setting.boolean({ default: true }),
    tone: setting.enum({ default: "calm", options: { calm: "Calm", loud: "Loud" } }),
  }),
};

/** The Markdown templates the Definition Set syncs for a block and its repeater. */
async function markdownTemplatesOf(block: unknown) {
  const set = await createApp({ blocks: [block as Block] }).getDefinitionSet();
  const schema = set.blocks[0]!.contentSchema as {
    toMarkdown: string[];
    properties: { items?: { toMarkdown: string[] } };
  };
  return { block: schema.toMarkdown, item: schema.properties.items?.toMarkdown };
}

void test("a block's and a repeatable item's toMarkdown read { content, settings }", async () => {
  const block = createBlock({
    ...fields,
    toReact: () => null,
    toMarkdown: ({ content, settings }: any) => [
      `# ${content.title}`,
      settings.showCta(content.cta),
      settings.tone("loud", content.title),
    ],
    toTitle: () => "Block",
  });
  assert.deepEqual(await markdownTemplatesOf(block), {
    block: [
      "# {{title}}",
      "{{#if settings.showCta}}{{cta}}{{/if}}",
      '{{#if (eq settings.tone "loud")}}{{title}}{{/if}}',
    ],
    item: ["- {{name}}", "{{#if itemSettings.featured}}(featured){{/if}}"],
  });
});

void test("toMarkdown reads fields named content or settings through content", async () => {
  const block = createBlock({
    id: "quote",
    title: "Quote",
    description: "A quote",
    content: (field: any) => ({
      content: field.string({ default: "Hi" }),
      settings: field.string({ default: "Ho" }),
    }),
    toReact: () => null,
    toMarkdown: ({ content }: any) => [content.content, `> ${content.settings}`],
    toTitle: () => "Quote",
  });
  assert.deepEqual((await markdownTemplatesOf(block)).block, ["{{content}}", "> {{settings}}"]);
});

void test("a block's and a repeatable item's toTitle sync as one-line templates", async () => {
  const block = createBlock({
    ...fields,
    content: (field: any) => ({
      ...fields.content(field),
      items: field.repeater({
        content: (item: any) => ({ name: item.string({ default: "Item" }) }),
        minItems: 1,
        maxItems: 3,
        toTitle: ({ content }: any) => content.name,
        toMarkdown: ({ content }: any) => [content.name],
      }),
    }),
    toReact: () => null,
    toTitle: ({ content }: any) => `${content.title}: ${content.cta}`,
    toMarkdown: () => [],
  });
  const set = await createApp({ blocks: [block as unknown as Block] }).getDefinitionSet();
  const schema = set.blocks[0]!.contentSchema as unknown as {
    toTitle: string;
    properties: { items: { toTitle: string } };
  };
  assert.equal(schema.toTitle, "{{title}}: {{cta}}");
  assert.equal(schema.properties.items.toTitle, "{{name}}");
});

void test("a block's and a repeatable item's toStructuredData sync as JSON templates", async () => {
  const block = createBlock({
    ...fields,
    content: (field: any) => ({
      ...fields.content(field),
      items: field.repeater({
        content: (item: any) => ({ name: item.string({ default: "Item" }) }),
        minItems: 1,
        maxItems: 3,
        toTitle: ({ content }: any) => content.name,
        toMarkdown: ({ content }: any) => [content.name],
        toStructuredData: ({ content }: any) => ({
          "@type": "Question",
          name: content.name,
          acceptedAnswer: { "@type": "Answer", text: `${content.name}!` },
        }),
      }),
    }),
    toReact: () => null,
    toTitle: () => "Block",
    toMarkdown: () => [],
    toStructuredData: ({ content }: any) => [
      { "@type": "Product", name: content.title, offers: { price: 9, priceCurrency: "EUR" } },
      content.items,
    ],
  });
  const set = await createApp({ blocks: [block as unknown as Block] }).getDefinitionSet();
  const schema = set.blocks[0]!.contentSchema as unknown as {
    toStructuredData: unknown;
    properties: { items: { toStructuredData: unknown } };
  };
  assert.deepEqual(schema.toStructuredData, [
    { "@type": "Product", name: "{{title}}", offers: { price: 9, priceCurrency: "EUR" } },
    "{{items}}",
  ]);
  assert.deepEqual(schema.properties.items.toStructuredData, {
    "@type": "Question",
    name: "{{name}}",
    acceptedAnswer: { "@type": "Answer", text: "{{name}}!" },
  });
});

const PAGE_ID = "0199f0a0-0000-7000-8000-000000000001";

/** A visitor's request for the home page, which holds one hero block with the given values. */
async function renderHome(
  t: { mock: { method: typeof test.mock.method } },
  block: unknown,
  values: { content: Record<string, unknown>; settings: Record<string, unknown> },
) {
  const project = { id: 1, name: "Real project", slug: "test", updatedAt: 1 };
  const page = { id: PAGE_ID, fullPath: "/", pathSegment: "", nickname: "Home", layoutId: null };
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const procedure = new URL(request.url).pathname.replace(/^\/rpc\//, "");
    if (procedure === "locales/list") return localesResponse();
    if (procedure === "pages/listBySlug") return pageListResponse([{ ...page, updatedAt: 1 }]);
    if (procedure === "pages/getByPath")
      return Response.json({
        json: {
          page: { ...page, metaTitle: "Home", blockIds: ["b1"] },
          layout: null,
          project,
          projectName: project.name,
          blocks: [{ id: "b1", pageId: PAGE_ID, type: "hero", position: "a0", ...values }],
          files: [],
          repeatableItems: [],
        },
      });
    return Response.json(
      { json: { defined: false, code: "NOT_FOUND", status: 404, message: "Not found" } },
      { status: 404 },
    );
  });
  const camoxApp = createApp({ blocks: [block as Block] });
  const response = await handleCamoxRequest(new Request("https://site.test/"), {
    apiUrl: "https://api.test",
    authenticationUrl: "https://auth.test",
    projectUuid: "test",
    getCamoxApp: async () => camoxApp,
    renderPage: (input) => renderPageWithApp({ ...input, camoxApp }),
  });
  assert.equal(response?.status, 200);
  return response!.text();
}

void test("a block renders through toReact, with its content and settings as props", async (t) => {
  const block = createBlock({
    ...fields,
    toReact: ({ content, settings }) => (
      <p>{`${content.title}, ${settings.tone}, ${settings.showCta ? content.cta : "no cta"}`}</p>
    ),
    toMarkdown: () => [],
    toTitle: () => "Block",
  });
  const html = await renderHome(t, block, {
    content: { title: "Hello" },
    settings: { tone: "loud" },
  });
  assert.match(html, /<p>Hello, loud, Start<\/p>/);
});
