import assert from "node:assert/strict";
import { test } from "node:test";

import { createApp } from "./createApp";
import { createBlock, type Block, type ContentFieldBuilder } from "./createBlock";
import { createCollection } from "./createCollection";
import { createLayout } from "./createLayout";

function block(id: string, layoutOnly = false): Block {
  return createBlock({
    id,
    title: `${id} title`,
    description: `${id} description`,
    layoutOnly,
    content: (field: ContentFieldBuilder) => ({ title: field.string({ default: `${id} text` }) }),
    toReact: () => null,
    toMarkdown: ({ content }: { content: { title: string } }) => [content.title],
    toTitle: () => "Block",
  }) as unknown as Block;
}

const layoutOptions = {
  title: "Layout",
  description: "A layout",
  toReact: ({ children }: { children: unknown }) => children as never,
  toTitle: ({ page }: { page: { title: string } }) => page.title,
  toDescription: ({ page }: { page: { description: string | undefined } }) => page.description,
};

function curated(
  id: string,
  blocks: { before?: Block[]; initial?: (() => Promise<{ block: Block }>)[] } = {},
) {
  return createLayout({
    ...layoutOptions,
    id,
    blocks: { before: (blocks.before ?? []) as never, after: [], initial: blocks.initial as never },
  });
}

function singleton() {
  return createLayout("pokedex")({
    title: "Pokédex",
    description: "A code-owned page",
    kind: "singleton",
    blocks: { before: [], after: [] },
    toReact: () => null,
    toTitle: ({ page }: { page: { title: string } }) => page.title,
    toDescription: ({ page }) => page.description,
  });
}

const blockIds = (set: Awaited<ReturnType<ReturnType<typeof createApp>["getDefinitionSet"]>>) =>
  set.blocks.map((definition) => definition.blockId).sort();

void test("the Definition Set includes lazy blocks without loading them first", async () => {
  const app = createApp({
    blocks: [block("hero")],
    lazyBlocks: { faq: async () => block("faq") },
  });

  const set = await app.getDefinitionSet();

  assert.deepEqual(blockIds(set), ["faq", "hero"]);
  const faq = set.blocks.find((definition) => definition.blockId === "faq")!;
  assert.equal(faq.title, "faq title");
  assert.equal(faq.description, "faq description");
  assert.deepEqual(faq.defaultContent, { title: "faq text" });
  assert.equal(faq.contentSchema.properties.title.default, "faq text");
});

void test("a layout-only block is in the Definition Set only when a layout declares it", async () => {
  const navbar = block("navbar", true);
  const footer = block("footer", true);
  const app = createApp({
    blocks: [block("hero"), navbar, footer],
    layouts: [curated("default", { before: [navbar] })],
  });

  const set = await app.getDefinitionSet();

  assert.deepEqual(blockIds(set), ["hero", "navbar"]);
  assert.equal(set.blocks.find((definition) => definition.blockId === "navbar")!.layoutOnly, true);
  assert.equal(
    set.blocks.find((definition) => definition.blockId === "hero")!.layoutOnly,
    undefined,
  );
});

void test("layouts carry their declared blocks and collections their schemas", async () => {
  const navbar = block("navbar", true);
  const articles = createCollection({
    id: "articles",
    title: "Articles",
    description: "Editorial",
    content: (field) => ({ title: field.string({ minLength: 1 }) }),
    toTitle: ({ content }) => content.title,
    toDescription: () => undefined,
  });
  const app = createApp({
    blocks: [navbar],
    layouts: [curated("default", { before: [navbar] })],
    collections: [articles],
  });

  const set = await app.getDefinitionSet();

  assert.deepEqual(
    set.layouts.map(({ layoutId, kind, blocks }) => ({
      layoutId,
      kind,
      blocks: blocks.map(({ type, slot, content }) => ({ type, slot, content })),
    })),
    [
      {
        layoutId: "default",
        kind: "curated",
        blocks: [{ type: "navbar", slot: "before", content: { title: "navbar text" } }],
      },
    ],
  );
  assert.deepEqual(
    set.collections.map(({ collectionId, toTitle, toDescription }) => ({
      collectionId,
      toTitle,
      toDescription,
    })),
    [{ collectionId: "articles", toTitle: "{{title}}", toDescription: null }],
  );
  assert.deepEqual(set.collections[0].contentSchema.required, ["title"]);
});

void test("the homepage is declared by the layout with initial blocks", async () => {
  const app = createApp({
    blocks: [],
    layouts: [
      curated("plain"),
      curated("landing", { initial: [async () => ({ block: block("hero") })] }),
    ],
  });

  const { homepage } = await app.getDefinitionSet();

  assert.equal(homepage?.layoutId, "landing");
  assert.equal(homepage?.hasInitialBlocks, true);
  assert.deepEqual(
    homepage?.blocks.map(({ type, content }) => ({ type, content })),
    [{ type: "hero", content: { title: "hero text" } }],
  );
});

void test("without initial blocks, the homepage is empty on the first curated layout", async () => {
  const app = createApp({
    blocks: [],
    layouts: [singleton(), curated("first"), curated("second")],
  });

  const { homepage } = await app.getDefinitionSet();

  assert.deepEqual(homepage, { layoutId: "first", blocks: [], hasInitialBlocks: false });
});

void test("block and item Structured Data sync what settings show as conditions the API evaluates", async () => {
  const promo = createBlock({
    id: "promo",
    title: "Promo",
    description: "A product",
    content: (field: ContentFieldBuilder) => ({
      name: field.string({ default: "Laptop" }),
      items: field.repeater({
        content: (item) => ({ question: item.string({ default: "Why?" }) }),
        settings: (setting) => ({ answered: setting.boolean({ default: true }) }),
        minItems: 1,
        maxItems: 3,
        toMarkdown: () => [],
        toTitle: () => "Item",
        toStructuredData: ({ content, settings }) => ({
          "@type": "Question",
          name: content.question,
          acceptedAnswer: settings.answered({ "@type": "Answer", text: "Yes" }),
        }),
      }),
    }),
    settings: (setting) => ({
      featured: setting.boolean({ default: false }),
      tone: setting.enum({ default: "quiet", options: { quiet: "Quiet", loud: "Loud" } }),
    }),
    toReact: () => null,
    toMarkdown: () => [],
    toTitle: () => "Promo",
    toStructuredData: ({ content, settings }) => [
      {
        "@type": "Product",
        name: content.name,
        description: settings.tone("loud", content.name),
        offers: { "@type": "Offer", price: 49, priceCurrency: "EUR" },
      },
      settings.featured(content.items),
    ],
  }) as unknown as Block;

  const set = await createApp({ blocks: [promo] }).getDefinitionSet();

  const schema = set.blocks[0]!.contentSchema as Record<string, any>;
  assert.deepEqual(schema.toStructuredData, [
    {
      "@type": "Product",
      name: "{{name}}",
      description: { "@camox": "if", setting: "settings.tone", equals: "loud", show: "{{name}}" },
      offers: { "@type": "Offer", price: 49, priceCurrency: "EUR" },
    },
    { "@camox": "if", setting: "settings.featured", show: "{{items}}" },
  ]);
  assert.deepEqual(schema.properties.items.toStructuredData.acceptedAnswer, {
    "@camox": "if",
    setting: "itemSettings.answered",
    show: { "@type": "Answer", text: "Yes" },
  });
});

void test("without a curated layout, the Definition Set declares no homepage", async () => {
  const app = createApp({ blocks: [], layouts: [singleton()] });

  assert.equal((await app.getDefinitionSet()).homepage, null);
});
