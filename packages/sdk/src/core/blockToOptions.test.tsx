import assert from "node:assert/strict";
import { test } from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { createApp } from "./createApp";
import { createBlock, type Block } from "./createBlock";

// Blocks and repeatable items declare their outputs as `to*` options: `toReact` renders the block
// with `{ content, settings }` as props, and `toMarkdown` and `toTitle` read
// `({ content, settings })`.

Object.assign(globalThis, { React });

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

function render(block: any, content: Record<string, unknown>, settings: Record<string, unknown>) {
  return renderToStaticMarkup(
    <block._internal.Component
      mode="site"
      blockData={{ _id: "1", type: "hero", position: "a0", content, settings }}
    />,
  );
}

void test("a block renders through toReact, with its content and settings as props", () => {
  const block = createBlock({
    ...fields,
    toReact: ({ content, settings }) => (
      <p>{`${content.title}, ${settings.tone}, ${settings.showCta ? content.cta : "no cta"}`}</p>
    ),
    toMarkdown: () => [],
    toTitle: () => "Block",
  });
  assert.match(render(block, { title: "Hello" }, { tone: "loud" }), /<p>Hello, loud, Start<\/p>/);
});
