import assert from "node:assert/strict";
import { test } from "node:test";

import { QueryClient, dehydrate } from "@tanstack/react-query";

import { testStudioCache } from "../../lib/draft-scope.fixtures";
import { reads } from "../../lib/studio-reads";
import { getPageBlockTypes } from "./pageBlockTypes";

/** The render input of a page whose blocks have these types, read in full on the server. */
function seededState(types: string[]) {
  const queryClient = new QueryClient();
  testStudioCache(queryClient).land(reads.pageStructure({ path: "/", projectSlug: "site" }), {
    page: { id: "page-1" },
    blocks: types.map((type, id) => ({ id: `block-${id}`, type, content: {}, settings: {} })),
    files: [],
    repeatableItems: [],
  } as never);
  return dehydrate(queryClient);
}

void test("names each block type a page's seeded blocks use, once", () => {
  assert.deepEqual(getPageBlockTypes(seededState(["hero", "faq", "hero"])).sort(), ["faq", "hero"]);
});

void test("a render input without block queries uses no blocks", () => {
  assert.deepEqual(getPageBlockTypes(seededState([])), []);
  assert.deepEqual(getPageBlockTypes(undefined), []);
});
