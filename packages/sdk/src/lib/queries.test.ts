import assert from "node:assert/strict";
import { test } from "node:test";

import { QueryClient } from "@tanstack/react-query";
import { Window } from "happy-dom";

const window = new Window({ url: "http://localhost:3000/about" });
Object.assign(globalThis, {
  window,
  localStorage: window.localStorage,
  __CAMOX_TELEMETRY_DISABLED__: true,
});
const { initApiClient } = await import("./api-client");
const { seedStartedDraft } = await import("./studio-draft");
const { blockQueries, collectionQueries, commentQueries, fileQueries, layoutQueries, pageQueries } =
  await import("./queries");

/** Every query the studio reads content with, as built while the studio is at `url`. */
function keysAt(url: string) {
  window.history.replaceState(null, "", url);
  initApiClient("http://api.test", "production");
  return [
    blockQueries.get("block-1").queryKey,
    blockQueries.getUsageCounts(1).queryKey,
    pageQueries.getByPath("/about", "site").queryKey,
    pageQueries.list(1).queryKey,
    fileQueries.get("file-1").queryKey,
    layoutQueries.list(1).queryKey,
    commentQueries.list("page-1").queryKey,
    collectionQueries.records("site", "posts").queryKey,
    collectionQueries.record("site", "posts", "record-1").queryKey,
  ];
}

void test("query keys end in the draft the studio reads, or live", () => {
  for (const key of keysAt("/about?camox-draft=d1")) assert.equal(key.at(-1), "d1", String(key));
  for (const key of keysAt("/about")) assert.equal(key.at(-1), "live", String(key));
});

void test("a draft started by the first edit starts from what Live showed", () => {
  const client = new QueryClient();
  const [block] = keysAt("/about");
  client.setQueryData(block!, { title: "Edited on Live" });
  client.setQueryData([...block!.slice(0, -1), "other-draft"], { title: "Other draft" });

  seedStartedDraft(client, "d1");

  const [blockInDraft] = keysAt("/about?camox-draft=d1");
  assert.deepEqual(client.getQueryData(blockInDraft!), { title: "Edited on Live" });
  client.clear();
});

void test("collection keys no longer name the environment", () => {
  for (const key of keysAt("/about")) assert.ok(!key.includes("production"), String(key));
});
