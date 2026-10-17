import assert from "node:assert/strict";
import { test } from "node:test";

import { DRAFT_CREATE_HEADER, DRAFT_HEADER, DRAFT_SEARCH_PARAM } from "@camox/api-contract/drafts";
import { QueryClient } from "@tanstack/react-query";
import { Window } from "happy-dom";

const window = new Window({ url: "http://localhost:3000/about" });
Object.assign(globalThis, {
  window,
  localStorage: window.localStorage,
  __CAMOX_TELEMETRY_DISABLED__: true,
});
const { initApiClient } = await import("./api-client");
const { createDraftScope } = await import("./draft-scope");
const {
  blockQueries,
  collectionQueries,
  fileQueries,
  layoutQueries,
  pageMutations,
  pageQueries,
  projectMutations,
} = await import("./queries");

/** Opens the studio at `url`, viewing the draft it names. */
function openStudio(url: string) {
  window.history.replaceState(null, "", url);
  const draftScope = createDraftScope({
    queryClient: new QueryClient(),
    browser: window as never,
    developmentMode: false,
  });
  draftScope.adopt({
    draftId: new URL(window.location.href).searchParams.get("camox-draft") ?? undefined,
  });
  initApiClient("http://api.test", draftScope);
  return draftScope;
}

/** Every query the studio reads content with, as built while the studio is at `url`. */
function keysAt(url: string) {
  const draftScope = openStudio(url);
  return [
    blockQueries.get(draftScope, "block-1").queryKey,
    blockQueries.getUsageCounts(draftScope, 1).queryKey,
    pageQueries.getByPath(draftScope, "/about", "site").queryKey,
    pageQueries.list(draftScope, 1).queryKey,
    fileQueries.get(draftScope, "file-1").queryKey,
    layoutQueries.list(draftScope, 1).queryKey,
    collectionQueries.records(draftScope, "site", "posts").queryKey,
    collectionQueries.record(draftScope, "site", "posts", "record-1").queryKey,
  ];
}

void test("query keys end in the draft the studio reads, or live", () => {
  for (const key of keysAt("/about?camox-draft=d1")) assert.equal(key.at(-1), "d1", String(key));
  for (const key of keysAt("/about")) assert.equal(key.at(-1), "live", String(key));
});

void test("changing a page's custom OG image on Live starts a draft, and the studio enters it", async (t) => {
  openStudio("/about");
  const sent: { method: string; draft: string | null; create: string | null }[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    sent.push({
      method: init.method ?? "GET",
      draft: headers.get(DRAFT_HEADER),
      create: headers.get(DRAFT_CREATE_HEADER),
    });
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });

  const file = new File(["bytes"], "og.png", { type: "image/png" });
  await pageMutations.uploadCustomOgImage().mutationFn({ pageId: "page-1", file });
  await pageMutations.deleteCustomOgImage().mutationFn({ pageId: "page-1" });

  const [upload, removal] = sent;
  assert.equal(upload?.create, "1");
  assert.ok(upload.draft);
  assert.equal(new URL(window.location.href).searchParams.get(DRAFT_SEARCH_PARAM), upload.draft);
  assert.deepEqual(removal, { method: "DELETE", draft: upload.draft, create: null });
});

void test("changing the favicon in a draft updates the whole site, so it starts no draft", async (t) => {
  openStudio("/about?camox-draft=d1");
  const sent: { method: string; draft: string | null; create: string | null }[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    sent.push({
      method: init.method ?? "GET",
      draft: headers.get(DRAFT_HEADER),
      create: headers.get(DRAFT_CREATE_HEADER),
    });
    return new Response('{"updatedAt":1}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const file = new File(["bytes"], "favicon.png", { type: "image/png" });
  await projectMutations.uploadFavicon().mutationFn({ projectId: 1, file });
  await projectMutations.deleteFavicon().mutationFn({ projectId: 1 });

  assert.deepEqual(sent, [
    { method: "POST", draft: null, create: null },
    { method: "DELETE", draft: null, create: null },
  ]);
});
