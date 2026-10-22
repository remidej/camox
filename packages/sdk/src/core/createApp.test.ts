import assert from "node:assert/strict";
import { test } from "node:test";

import { createApp } from "./createApp";
import { createBlock, type Block, type ContentFieldBuilder } from "./createBlock";

function block(id: string): Block {
  const definition = createBlock({
    id,
    title: id,
    description: id,
    content: (field: ContentFieldBuilder) => ({ title: field.string({ default: id }) }),
    toReact: () => null,
    toMarkdown: ({ content }: { content: { title: string } }) => [content.title],
    toTitle: () => "Block",
  });
  return definition as unknown as Block;
}

function lazy(blocks: Block[]) {
  const loads: string[] = [];
  const loaders = Object.fromEntries(
    blocks.map((b) => [
      b._internal.id,
      async () => {
        loads.push(b._internal.id);
        return b;
      },
    ]),
  );
  return { loads, loaders };
}

void test("a lazy block is unknown until loaded, then found by id", async () => {
  const hero = block("hero");
  const { loaders } = lazy([hero]);
  const app = createApp({ blocks: [], lazyBlocks: loaders });

  assert.equal(app.getBlockById("hero"), undefined);
  assert.equal(await app.loadBlock("hero"), hero);
  assert.equal(app.getBlockById("hero"), hero);
});

void test("loading a page's blocks loads only those, once", async () => {
  const { loads, loaders } = lazy([block("hero"), block("faq"), block("footer")]);
  const app = createApp({ blocks: [], lazyBlocks: loaders });

  await Promise.all([app.loadBlocks(["hero", "faq"]), app.loadBlocks(["hero"])]);

  assert.deepEqual(loads.sort(), ["faq", "hero"]);
  assert.deepEqual(
    app
      .getBlocks()
      .map((b) => b._internal.id)
      .sort(),
    ["faq", "hero"],
  );
});

void test("loading all blocks makes every definition available", async () => {
  const { loaders } = lazy([block("hero"), block("faq")]);
  const app = createApp({ blocks: [block("navbar")], lazyBlocks: loaders });

  await app.loadAllBlocks();

  assert.deepEqual(
    app
      .getBlocks()
      .map((b) => b._internal.id)
      .sort(),
    ["faq", "hero", "navbar"],
  );
});

void test("a block whose id differs from its file name is found by loading every block", async () => {
  const hero = block("homepage-hero");
  const app = createApp({ blocks: [], lazyBlocks: { hero: async () => hero } });

  assert.equal(await app.loadBlock("homepage-hero"), hero);
});

void test("an unknown block id resolves to undefined", async () => {
  const { loaders } = lazy([block("hero")]);
  const app = createApp({ blocks: [], lazyBlocks: loaders });

  assert.equal(await app.loadBlock("missing"), undefined);
});

void test("eager blocks are available without loading", async () => {
  const hero = block("hero");
  const app = createApp({ blocks: [hero] });

  assert.equal(app.getBlockById("hero"), hero);
  assert.equal(await app.loadBlock("hero"), hero);
});

void test("a block that failed to load is retried", async () => {
  const hero = block("hero");
  let attempts = 0;
  const app = createApp({
    blocks: [],
    lazyBlocks: {
      hero: async () => {
        attempts++;
        if (attempts === 1) throw new Error("network");
        return hero;
      },
    },
  });

  await assert.rejects(app.loadBlock("hero"));
  assert.equal(await app.loadBlock("hero"), hero);
});

void test("loading the same block twice returns the same promise", () => {
  const { loaders } = lazy([block("hero")]);
  const app = createApp({ blocks: [], lazyBlocks: loaders });

  assert.equal(app.loadBlock("hero"), app.loadBlock("hero"));
});

void test("only an app with blocks left to load can load more", async () => {
  assert.equal(createApp({ blocks: [block("hero")] }).canLoadMoreBlocks(), false);

  const { loaders } = lazy([block("hero"), block("faq")]);
  const app = createApp({ blocks: [], lazyBlocks: loaders });
  await app.loadBlock("hero");
  assert.equal(app.canLoadMoreBlocks(), true);
  await app.loadAllBlocks();
  assert.equal(app.canLoadMoreBlocks(), false);
});

void test("a block file without a block export loads nothing", async () => {
  const hero = block("hero");
  const app = createApp({
    blocks: [],
    lazyBlocks: { helpers: async () => undefined, hero: async () => hero },
  });

  await app.loadAllBlocks();
  assert.deepEqual(app.getBlocks(), [hero]);
});
