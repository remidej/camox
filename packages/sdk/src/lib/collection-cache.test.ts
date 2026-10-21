import assert from "node:assert/strict";
import { test } from "node:test";

import { QueryClient } from "@tanstack/react-query";

import { invalidateCollectionRecordViews } from "./collection-cache";
import { testStudioCache } from "./draft-scope.fixtures";
import { type Read, reads } from "./studio-reads";

void test("record edits refresh the collection's placements and lists in every scope, not other collections", async () => {
  const client = new QueryClient();
  const cache = testStudioCache(client);
  const placements: Read<unknown>[] = [
    reads.blockBundle("1"),
    reads.blockBundle("2"),
    reads.pageStructure({ path: "/", projectUuid: "site" }),
    reads.layoutStructure({ projectUuid: "site", layoutId: "layout" }),
    reads.pageList({ projectUuid: "site" }),
    reads.records({ projectUuid: "site", collectionId: "customers" }),
  ];
  const untouched: Read<unknown>[] = [
    reads.records({ projectUuid: "other-site", collectionId: "customers" }),
    reads.records({ projectUuid: "site", collectionId: "articles" }),
  ];
  const scopes = [null, "d1"];
  const invalidated = (read: Read<unknown>, draft: string | null) =>
    client.getQueryState(cache.options(read, { in: draft }).queryKey)?.isInvalidated;
  try {
    for (const read of [...placements, ...untouched])
      for (const draft of scopes) cache.set(read, {}, { in: draft });

    await invalidateCollectionRecordViews(cache as never, "site", "customers");

    for (const read of placements)
      for (const draft of scopes)
        assert.equal(invalidated(read, draft), true, JSON.stringify(read.params));
    for (const read of untouched)
      for (const draft of scopes)
        assert.equal(invalidated(read, draft), false, JSON.stringify(read.params));
  } finally {
    client.clear();
  }
});
