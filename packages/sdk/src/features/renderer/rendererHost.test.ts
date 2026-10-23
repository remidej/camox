import assert from "node:assert/strict";
import { test } from "node:test";

import type { QueryKey } from "@camox/api-contract/query-keys";
import { QueryClient } from "@tanstack/react-query";

import type { DraftScope } from "../../lib/draft-scope";
import { testDraftScope, testStudioCache } from "../../lib/draft-scope.fixtures";
import { reads, type StudioCache } from "../../lib/studio-reads";
import { previewStore, selectionForOwner } from "../preview/previewStore";
import { RENDERER_PROTOCOL, type RendererFrameTarget } from "./protocol";
import { fakeRenderer, settle } from "./protocol.fixtures";
import { createRendererHost } from "./rendererHost";
import { connectToStudio } from "./studioConnection";

const page = { kind: "page", pageId: "home" } as const;

function setup(
  t: { after: (fn: () => void) => void },
  studio?: { studioCache: StudioCache; draftScope: DraftScope },
) {
  const host = createRendererHost(studio);
  t.after(() => {
    host.close();
    previewStore.send({ type: "reset" });
  });
  return host;
}

void test("a block the renderer selects is the studio's selection", async (t) => {
  const host = setup(t);
  const renderer = fakeRenderer(host.handle);
  await settle();
  renderer.send({
    type: "storeEvent",
    store: "preview",
    event: { type: "setFocusedBlock", ...page, blockId: "hero" },
  });
  await settle();
  assert.deepEqual(selectionForOwner(previewStore.getSnapshot().context, page), {
    type: "block",
    blockId: "hero",
  });
});

void test("the renderer mirrors the studio's selection as it changes", async (t) => {
  const host = setup(t);
  const renderer = fakeRenderer(host.handle);
  await settle();
  assert.equal(renderer.received[0]?.type, "welcome");
  previewStore.send({ type: "selectItem", ...page, blockId: "faq", itemId: "q1" });
  await settle();
  const mirrored = renderer.last("store");
  assert.equal(mirrored?.store, "preview");
  assert.deepEqual(
    selectionForOwner(mirrored.context as Parameters<typeof selectionForOwner>[0], page),
    { type: "item", blockId: "faq", itemId: "q1" },
  );
});

const target = {
  pathname: "/about",
  href: "http://localhost/about",
  owner: page,
  locale: null,
  editable: true,
  artifactsRun: true,
  artifactStudio: null,
  resting: false,
  canvas: null,
} satisfies RendererFrameTarget;

void test("the renderer gets every frame shown, even before it connected, until hidden", async (t) => {
  const host = setup(t);
  const slot = {} as HTMLElement;
  host.show("preview", slot, target);
  const renderer = fakeRenderer(host.handle);
  await settle();
  assert.deepEqual(
    renderer.all("frame").map(({ frameId, slot, target }) => ({ frameId, slot, target })),
    [{ frameId: "preview", slot, target }],
  );
  host.show("preview", slot, { ...target, editable: false });
  await settle();
  assert.equal(renderer.last("frame")?.target.editable, false);
  host.hide("preview");
  await settle();
  assert.deepEqual(renderer.last("frameEnd"), { type: "frameEnd", frameId: "preview" });
  const reconnected = fakeRenderer(host.handle);
  await settle();
  assert.deepEqual(reconnected.all("frame"), [], "a hidden frame isn't shown again");
});

void test("what the renderer says about a frame reaches the one who showed it", async (t) => {
  const host = setup(t);
  const heard: unknown[] = [];
  const element = {} as Element;
  host.show("card", {} as HTMLElement, target, {
    rendered: () => heard.push("rendered"),
    failed: (message) => heard.push({ failed: message }),
    navigate: (to) => heard.push({ navigate: to }),
    reveal: (element, immediate) => heard.push({ reveal: element, immediate }),
  });
  const renderer = fakeRenderer(host.handle);
  await settle();
  renderer.send({ type: "rendered", frameId: "card" });
  renderer.send({ type: "error", frameId: "card", message: "Boom" });
  renderer.send({ type: "navigate", frameId: "card", to: "/pricing" });
  renderer.send({ type: "reveal", frameId: "card", element, immediate: true });
  renderer.send({ type: "rendered", frameId: "another" });
  await settle();
  assert.deepEqual(heard, [
    "rendered",
    { failed: "Boom" },
    { navigate: "/pricing" },
    { reveal: element, immediate: true },
  ]);
});

/** The studio's cache and the draft it views, `draft` or Live. */
function studioState(draft: string | null) {
  const queryClient = new QueryClient();
  const draftScope = testDraftScope(queryClient);
  if (draft) draftScope.adopt({ draftId: draft });
  return { queryClient, draftScope, studioCache: testStudioCache(queryClient, { draftScope }) };
}

const invalidation = (draftId: string | null) => ({
  type: "invalidate" as const,
  draftId,
  targets: [["camox", "pages"]] as QueryKey[],
});

void test("the renderer hears the project room's invalidations for its draft and Live's", async (t) => {
  const studio = studioState("spring");
  const host = setup(t, studio);
  const renderer = fakeRenderer(host.handle);
  await settle();
  for (const draftId of ["spring", null, "autumn"])
    await studio.studioCache.receive(invalidation(draftId), 7);
  await settle();
  assert.deepEqual(
    renderer.all("invalidate").map(({ message, projectId }) => [message.draftId, projectId]),
    [
      ["spring", 7],
      [null, 7],
    ],
  );
});

void test("the studio's optimistic writes in the renderer's draft, and their answer, reach the renderer", async (t) => {
  const studio = studioState("spring");
  const host = setup(t, studio);
  const renderer = fakeRenderer(host.handle);
  await settle();
  const block = reads.blockBundle("hero");
  const queryKey = studio.studioCache.options(block).queryKey;
  const before = { block: { id: "hero", content: { title: "Before" } } };
  const after = { block: { id: "hero", content: { title: "After" } } };
  studio.studioCache.set(block, before);
  const edit = studio.studioCache.edit();
  edit.set(block, after as never);
  edit.rollback();
  edit.settle();
  // Writes in another draft never reach the renderer.
  studio.studioCache.set(block, after, { in: "autumn" });
  await studio.studioCache.invalidate(block, { in: "autumn" });
  await settle();
  assert.deepEqual(
    renderer.all("write").map(({ queryKey, value }) => ({ queryKey, value })),
    [
      { queryKey, value: before },
      { queryKey, value: after },
      { queryKey, value: before },
    ],
  );
  assert.deepEqual(
    renderer.all("outdated").map(({ queryKeys }) => queryKeys),
    [[queryKey]],
  );
});

void test("the renderer enters the draft a first write starts, without loading again", async (t) => {
  const studio = studioState(null);
  const host = setup(t, studio);
  const renderer = fakeRenderer(host.handle);
  await settle();
  studio.draftScope.enterStarted("fresh");
  await settle();
  assert.deepEqual(renderer.all("draftStarted"), [{ type: "draftStarted", draftId: "fresh" }]);
});

void test("a change made elsewhere, and the studio's own edits, reach the real renderer's cache", async (t) => {
  const studio = studioState("spring");
  const host = setup(t, studio);
  // The renderer document: its own cache, of the same draft.
  const renderer = studioState("spring");
  const connection = connectToStudio(host.handle, renderer);
  t.after(() => connection.close());
  const pages = reads.pageList({ projectUuid: "p" });
  const block = reads.blockBundle("hero");
  renderer.studioCache.set(pages, []);
  renderer.studioCache.set(block, { block: { id: "hero", content: { title: "Before" } } });
  await settle();

  // Another member changed a page: the room tells the studio.
  await studio.studioCache.receive(invalidation("spring"), 7);
  // The member edits the hero from a sidebar.
  const edited = { block: { id: "hero", content: { title: "After" } } };
  studio.studioCache.edit().set(block, edited as never);
  await settle();

  const pagesQuery = renderer.queryClient
    .getQueryCache()
    .find({ queryKey: renderer.studioCache.options(pages).queryKey, exact: true });
  assert.equal(pagesQuery?.state.isInvalidated, true);
  assert.deepEqual(renderer.studioCache.get(block), edited);
});

void test("a renderer of another protocol is told nothing", async (t) => {
  const host = setup(t);
  host.show("preview", {} as HTMLElement, target);
  const renderer = fakeRenderer(host.handle, { protocol: RENDERER_PROTOCOL + 1 });
  await settle();
  previewStore.send({ type: "showCanvas" });
  await settle();
  assert.deepEqual(renderer.received, []);
});
