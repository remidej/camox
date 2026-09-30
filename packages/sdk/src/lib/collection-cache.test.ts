import assert from "node:assert/strict";
import { test } from "node:test";

import { queryKeys } from "@camox/api-contract/query-keys";
import { QueryClient } from "@tanstack/react-query";

import { initApiClient } from "./api-client";
import { invalidateCollectionRecordViews } from "./collection-cache";
import { collectionQueries } from "./queries";

void test("source edits invalidate draft placements and statuses without invalidating live content", async () => {
  Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true });
  initApiClient("http://localhost:8788", "development");
  const client = new QueryClient();
  const draftKeys = [
    queryKeys.blocks.get(1, "draft"),
    queryKeys.blocks.get(2, "draft"),
    queryKeys.pages.getByPath("/", "draft"),
    ["camox", "layouts", "get", "site", "layout", "draft"],
    queryKeys.pages.list,
    collectionQueries.records("site", "customers").queryKey,
  ];
  const untouchedKeys = [
    queryKeys.blocks.get(1, "live"),
    queryKeys.pages.getByPath("/", "live"),
    ["camox", "layouts", "get", "site", "layout", "live"],
    collectionQueries.records("other-site", "customers").queryKey,
    collectionQueries.records("site", "articles").queryKey,
    ["other-app", "blocks", "get", 1, "draft"],
  ];
  try {
    for (const key of [...draftKeys, ...untouchedKeys]) client.setQueryData(key, {});
    await invalidateCollectionRecordViews(client, "site", "customers");
    for (const key of draftKeys) assert.equal(client.getQueryState(key)?.isInvalidated, true);
    for (const key of untouchedKeys) assert.equal(client.getQueryState(key)?.isInvalidated, false);
  } finally {
    client.clear();
  }
});
