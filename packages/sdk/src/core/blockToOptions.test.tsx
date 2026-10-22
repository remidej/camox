import assert from "node:assert/strict";
import { test } from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { createApp } from "./createApp";
import { createBlock, type Block } from "./createBlock";

// Blocks and repeatable items declare their outputs as `to*` options: `toReact` renders the block
// with `{ content, settings }` as props, and `toMarkdown` reads `({ content, settings })`. The old
// `component` and positional `toMarkdown(content, settings)` keep working.

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
      toMarkdown: (item: any, itemSettings: any) => [
        `- ${item.name}`,
        itemSettings.featured("(featured)"),
      ],
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

void test("a block's and a repeatable item's toMarkdown read { content, settings } like the positional form", async () => {
  const positional = createBlock({
    ...fields,
    component: () => null,
    toMarkdown: (c: any, s: any) => [`# ${c.title}`, s.showCta(c.cta), s.tone("loud", c.title)],
  });
  const destructured = createBlock({
    ...fields,
    content: (field: any) => ({
      ...fields.content(field),
      items: field.repeater({
        content: (item: any) => ({ name: item.string({ default: "Item" }) }),
        settings: (setting: any) => ({ featured: setting.boolean({ default: false }) }),
        minItems: 1,
        maxItems: 3,
        toMarkdown: ({ content, settings }: any) => [
          `- ${content.name}`,
          settings.featured("(featured)"),
        ],
      }),
    }),
    toReact: () => null,
    toMarkdown: ({ content, settings }: any) => [
      `# ${content.title}`,
      settings.showCta(content.cta),
      settings.tone("loud", content.title),
    ],
  });
  const expected = {
    block: [
      "# {{title}}",
      "{{#if settings.showCta}}{{cta}}{{/if}}",
      '{{#if (eq settings.tone "loud")}}{{title}}{{/if}}',
    ],
    item: ["- {{name}}", "{{#if itemSettings.featured}}(featured){{/if}}"],
  };
  assert.deepEqual(await markdownTemplatesOf(positional), expected);
  assert.deepEqual(await markdownTemplatesOf(destructured), expected);
});

void test("a positional toMarkdown still reads fields named content or settings", async () => {
  const block = createBlock({
    id: "quote",
    title: "Quote",
    description: "A quote",
    content: (field: any) => ({
      content: field.string({ default: "Hi" }),
      settings: field.string({ default: "Ho" }),
    }),
    component: () => null,
    toMarkdown: (c: any) => [c.content, `> ${c.settings}`],
  });
  const destructured = createBlock({
    id: "quote",
    title: "Quote",
    description: "A quote",
    content: (field: any) => ({
      content: field.string({ default: "Hi" }),
      settings: field.string({ default: "Ho" }),
    }),
    toReact: () => null,
    toMarkdown: ({ content }: any) => [content.content, `> ${content.settings}`],
  });
  const expected = ["{{content}}", "> {{settings}}"];
  assert.deepEqual((await markdownTemplatesOf(block)).block, expected);
  assert.deepEqual((await markdownTemplatesOf(destructured)).block, expected);
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
  });
  assert.match(render(block, { title: "Hello" }, { tone: "loud" }), /<p>Hello, loud, Start<\/p>/);
});

void test("a block's old component still renders it", () => {
  const block = createBlock({
    ...fields,
    component: ({ content }) => <p>{content.title}</p>,
    toMarkdown: () => [],
  });
  assert.match(render(block, { title: "Hello" }, {}), /<p>Hello<\/p>/);
});
