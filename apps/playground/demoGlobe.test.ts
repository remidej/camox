import assert from "node:assert/strict";
import { test } from "node:test";

import { seedHeroGlobe } from "./demoGlobe.ts";

interface FakeBlock {
  id: number;
  type: string;
  content: Record<string, unknown>;
}

/** An in-memory home page behind the page and block endpoints the seeder uses. */
function fakeApi(blocks: FakeBlock[]) {
  const logs: string[] = [];
  const context = {
    projectSlug: "camox-playground-01",
    logger: { info: (message: string) => logs.push(message) },
    client: {
      pages: {
        getByPath: async (input: { projectSlug: string; path: string; source: "draft" }) => {
          assert.equal(input.path, "/");
          return { blocks };
        },
      },
      blocks: {
        updateContent: async (input: { id: number; content: unknown }) => {
          const block = blocks.find((candidate) => candidate.id === input.id);
          assert.ok(block, `unknown block ${input.id}`);
          Object.assign(block.content, input.content);
        },
      },
    },
  };
  return { logs, context };
}

void test("an empty hero globe gets a titled artifact source", async () => {
  const blocks = [
    { id: 1, type: "hero", content: { title: "Hi", globe: "" } },
    { id: 2, type: "statistics", content: {} },
  ];
  const { logs, context } = fakeApi(blocks);

  await seedHeroGlobe(context);

  assert.match(blocks[0]!.content.globe as string, /<title>[^<]+<\/title>/);
  assert.equal(blocks[0]!.content.title, "Hi");
  assert.deepEqual(blocks[1]!.content, {});
  assert.match(logs.join("\n"), /globe/);
});

void test("a globe that already has a source is left untouched", async () => {
  const blocks = [{ id: 1, type: "hero", content: { globe: "<title>Mine</title>" } }];
  const { logs, context } = fakeApi(blocks);

  await seedHeroGlobe(context);

  assert.equal(blocks[0]!.content.globe, "<title>Mine</title>");
  assert.deepEqual(logs, []);
});
