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
const { pageMutations, projectMutations } = await import("./queries");

/** Opens the studio at `url`, viewing the draft it names. */
function openStudio(url: string) {
  window.history.replaceState(null, "", url);
  const draftScope = createDraftScope({
    queryClient: new QueryClient(),
    browser: window as never,
  });
  draftScope.adopt({
    draftId: new URL(window.location.href).searchParams.get("camox-draft") ?? undefined,
  });
  initApiClient("http://api.test", draftScope);
  return draftScope;
}

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
