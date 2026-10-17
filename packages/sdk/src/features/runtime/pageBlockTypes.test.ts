import assert from "node:assert/strict";
import { test } from "node:test";

import { queryKeys } from "@camox/api-contract/query-keys";
import { QueryClient, dehydrate } from "@tanstack/react-query";

import { seedBlockCaches } from "../../lib/normalized-data";
import { getPageBlockTypes } from "./pageBlockTypes";

function seededState(types: string[]) {
  const queryClient = new QueryClient();
  seedBlockCaches(
    queryClient,
    {
      blocks: types.map((type, id) => ({ id, type, content: {}, settings: {}, position: "a" })),
      files: [],
      repeatableItems: [],
    } as unknown as Parameters<typeof seedBlockCaches>[1],
    null,
  );
  queryClient.setQueryData(queryKeys.pages.getByPath("/"), { page: { id: 1 } });
  return dehydrate(queryClient);
}

void test("names each block type a page's seeded blocks use, once", () => {
  assert.deepEqual(getPageBlockTypes(seededState(["hero", "faq", "hero"])).sort(), ["faq", "hero"]);
});

void test("a render input without block queries uses no blocks", () => {
  assert.deepEqual(getPageBlockTypes(seededState([])), []);
  assert.deepEqual(getPageBlockTypes(undefined), []);
});
