import assert from "node:assert/strict";
import { test } from "node:test";

import { createApp } from "./createApp";
import { createBlock, type ContentFieldBuilder } from "./createBlock";
import { createLayout } from "./createLayout";

function block(id: string, layoutOnly = false) {
  return createBlock({
    id,
    title: id,
    description: id,
    layoutOnly,
    content: (field: ContentFieldBuilder) => ({ title: field.string({ default: `${id} title` }) }),
    component: () => null,
    toMarkdown: (content: { title: string }) => [content.title],
  });
}

function curatedLayout(initial: (() => Promise<{ block: ReturnType<typeof block> }>)[]) {
  return createLayout({
    id: "default",
    title: "Default",
    description: "Default",
    blocks: { before: [], after: [], initial: initial as never },
    component: ({ children }) => children,
    buildMetaTitle: ({ pageMetaTitle }) => pageMetaTitle,
  });
}

void test("initial blocks load only when the initial page is seeded, in order", async () => {
  const imported: string[] = [];
  const load = (id: string) => async () => {
    imported.push(id);
    return { block: block(id) };
  };
  const app = createApp({ blocks: [], layouts: [curatedLayout([load("hero"), load("faq")])] });

  assert.deepEqual(imported, []);
  const initialPage = await app.getInitialPageBundles();

  assert.equal(initialPage?.layoutId, "default");
  assert.equal(initialPage?.hasInitialBlocks, true);
  assert.deepEqual(
    initialPage?.blocks.map(({ type, content }) => ({ type, content })),
    [
      { type: "hero", content: { title: "hero title" } },
      { type: "faq", content: { title: "faq title" } },
    ],
  );
});

void test("a layout-only initial block is rejected when the initial page is seeded", async () => {
  const app = createApp({
    blocks: [],
    layouts: [curatedLayout([async () => ({ block: block("navbar", true) })])],
  });

  await assert.rejects(app.getInitialPageBundles(), /must NOT be `layoutOnly: true`.*"navbar"/);
});

void test("only one layout may define initial blocks", () => {
  const second = createLayout({
    id: "second",
    title: "Second",
    description: "Second",
    blocks: { before: [], after: [], initial: [] },
    component: ({ children }) => children,
    buildMetaTitle: ({ pageMetaTitle }) => pageMetaTitle,
  });

  assert.throws(
    () => createApp({ blocks: [], layouts: [curatedLayout([]), second] }),
    /Only one layout can define blocks.initial/,
  );
});
