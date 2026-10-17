import assert from "node:assert/strict";
import { test } from "node:test";

import { queryKeys } from "@camox/api-contract/query-keys";
import { QueryClient } from "@tanstack/react-query";

import { initApiClient } from "./api-client";
import { invalidateCollectionRecordViews } from "./collection-cache";
import { testDraftScope } from "./draft-scope.fixtures";
import { collectionQueries } from "./queries";

/** Live, like the scope the rendered studio views. */
const draftScope = testDraftScope();

void test("record edits invalidate the collection's placements and statuses, not other collections", async () => {
  Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true });
  initApiClient("http://localhost:8788", testDraftScope());
  const client = new QueryClient();
  const placementKeys = [
    queryKeys.blocks.get("1"),
    queryKeys.blocks.get("2"),
    queryKeys.pages.getByPath("/"),
    ["camox", "layouts", "get", "site", "layout"],
    queryKeys.pages.list,
    collectionQueries.records(draftScope, "site", "customers").queryKey,
  ];
  const untouchedKeys = [
    collectionQueries.records(draftScope, "other-site", "customers").queryKey,
    collectionQueries.records(draftScope, "site", "articles").queryKey,
    ["other-app", "blocks", "get", 1],
  ];
  try {
    for (const key of [...placementKeys, ...untouchedKeys]) client.setQueryData(key, {});
    await invalidateCollectionRecordViews(client, "site", "customers");
    for (const key of placementKeys) assert.equal(client.getQueryState(key)?.isInvalidated, true);
    for (const key of untouchedKeys) assert.equal(client.getQueryState(key)?.isInvalidated, false);
  } finally {
    client.clear();
  }
});
