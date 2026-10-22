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
    component: () => null,
    toMarkdown: (content: { title: string }) => [content.title],
  }) as unknown as Block;
}

const layoutOptions = {
  title: "Layout",
  description: "A layout",
  component: ({ children }: { children: unknown }) => children as never,
  buildMetaTitle: ({ pageMetaTitle }: { pageMetaTitle: string }) => pageMetaTitle,
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
    component: () => null,
    buildMetaTitle: ({ pageMetaTitle }: { pageMetaTitle: string }) => pageMetaTitle,
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

void test("without a curated layout, the Definition Set declares no homepage", async () => {
  const app = createApp({ blocks: [], layouts: [singleton()] });

  assert.equal((await app.getDefinitionSet()).homepage, null);
});
