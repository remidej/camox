import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import type { QueryKey } from "@camox/api-contract/query-keys";
import { QueryClient } from "@tanstack/react-query";

import { initApiClient } from "../../lib/api-client";
import type { DraftScope } from "../../lib/draft-scope";
import { testDraftScope, testStudioCache } from "../../lib/draft-scope.fixtures";
import { reads, type StudioCache } from "../../lib/studio-reads";
import { previewStore, selectionForOwner } from "../preview/previewStore";
import { RENDERER_PROTOCOL, SDK_VERSION, type RendererFrameTarget } from "./protocol";
import { fakeRenderer, settle } from "./protocol.fixtures";
import { createRendererHost } from "./rendererHost";
import { connectToStudio } from "./studioConnection";

const page = { kind: "page", pageId: "home" } as const;

Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true });

function setup(
  t: { after: (fn: () => void) => void },
  studio?: { studioCache: StudioCache; draftScope: DraftScope; queryClient: QueryClient },
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

void test("what the renderer's pages tell the editor, the studio shows", async (t) => {
  const notices: unknown[] = [];
  const host = createRendererHost({ notify: (notice) => notices.push(notice) });
  t.after(() => host.close());
  const renderer = fakeRenderer(host.handle);
  await settle();
  renderer.send({ type: "notify", notice: { tone: "success", message: 'Deleted "hero" block' } });
  await settle();
  assert.deepEqual(notices, [{ tone: "success", message: 'Deleted "hero" block' }]);
});

void test("the studio asks the renderer what only the draft's code knows, and hears its answer", async (t) => {
  const host = setup(t);
  // Asked before any renderer connected: the first one to connect is asked.
  const bundle = host.ask({ type: "initialBundle", blockType: "hero" });
  const renderer = fakeRenderer(host.handle);
  await settle();
  const [asked] = renderer.all("ask");
  assert.deepEqual(asked?.question, { type: "initialBundle", blockType: "hero" });
  const initial = { content: { title: "Hello" }, settings: {}, repeatableItems: [] };
  renderer.send({ type: "answer", askId: asked!.askId, value: initial });
  assert.deepEqual(await bundle, initial);

  const missing = host.ask({ type: "initialBundle", blockType: "gone" });
  await settle();
  const failing = renderer.last("ask")!;
  renderer.send({ type: "answer", askId: failing.askId, error: "The block crashed" });
  await assert.rejects(missing, /The block crashed/);
});

void test("a question the last renderer left unanswered is asked of the next one, which alone answers", async (t) => {
  const host = setup(t);
  const first = fakeRenderer(host.handle);
  await settle();
  const title = host.ask({ type: "initialBundle", blockType: "hero" });
  await settle();
  const [lost] = first.all("ask");
  assert.ok(lost);
  // The renderer reloads before answering.
  const second = fakeRenderer(host.handle);
  await settle();
  const [asked] = second.all("ask");
  assert.deepEqual(asked?.question, lost.question);
  first.send({ type: "answer", askId: lost.askId, value: { from: "first" } });
  second.send({ type: "answer", askId: asked!.askId, value: { from: "second" } });
  assert.deepEqual(await title, { from: "second" });
});

void test("the renderer renders each thumbnail shown, even before it connected, until hidden", async (t) => {
  const host = setup(t);
  const slot = {} as HTMLElement;
  host.showThumbnail("hero-thumbnail", slot, "hero");
  const renderer = fakeRenderer(host.handle);
  await settle();
  assert.deepEqual(renderer.all("thumbnail"), [
    { type: "thumbnail", thumbnailId: "hero-thumbnail", slot, blockType: "hero" },
  ]);
  host.hideThumbnail("hero-thumbnail");
  await settle();
  assert.deepEqual(renderer.last("thumbnailEnd"), {
    type: "thumbnailEnd",
    thumbnailId: "hero-thumbnail",
  });
  const reconnected = fakeRenderer(host.handle);
  await settle();
  assert.deepEqual(reconnected.all("thumbnail"), [], "a hidden thumbnail isn't shown again");
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

void test("a renderer of another SDK version hears only the studio's version, and the studio says it's updating", async (t) => {
  const host = setup(t);
  host.show("preview", {} as HTMLElement, target);
  assert.equal(host.status(), "connecting");
  const renderer = fakeRenderer(host.handle, { sdkVersion: `${SDK_VERSION}-other` });
  await settle();
  previewStore.send({ type: "showCanvas" });
  await settle();
  assert.deepEqual(renderer.received, [
    { type: "welcome", protocol: RENDERER_PROTOCOL, sdkVersion: SDK_VERSION },
  ]);
  assert.equal(host.status(), "updating");

  const matching = fakeRenderer(host.handle);
  await settle();
  assert.equal(host.status(), "connected");
  assert.equal(matching.last("frame")?.frameId, "preview");
});

/** The API the studio writes through, answering `answer` and recording each request it gets. */
function fakeApi(
  t: TestContext,
  draftScope: DraftScope,
  answer: (procedure: string) => Response = () => Response.json({ json: null }),
) {
  initApiClient("http://localhost:8788", draftScope);
  const requests: { procedure: string; headers: Headers; input: unknown }[] = [];
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const procedure = new URL(request.url).pathname.replace("/rpc/", "");
    requests.push({ procedure, headers: request.headers, input: (await request.json()).json });
    return answer(procedure);
  });
  return requests;
}

void test("an edit made in the renderer is written once, by the studio, which says it landed", async (t) => {
  const studio = studioState("spring");
  const requests = fakeApi(t, studio.draftScope);
  const host = setup(t, studio);
  const renderer = fakeRenderer(host.handle);
  await settle();
  renderer.send({
    type: "edit",
    editId: 1,
    edit: { type: "blockContent", blockId: "hero", content: { title: "Hello" } },
  });
  renderer.send({
    type: "edit",
    editId: 2,
    edit: { type: "itemContent", itemId: "q1", content: { answer: "Yes" } },
  });
  // A block whose definition the draft's code removed is deleted from its placeholder.
  renderer.send({ type: "edit", editId: 3, edit: { type: "deleteBlock", blockId: "old" } });
  await settle();
  assert.deepEqual(
    requests.map(({ procedure, headers, input }) => [procedure, headers.get(DRAFT_HEADER), input]),
    [
      ["blocks/updateContent", "spring", { id: "hero", content: { title: "Hello" } }],
      ["repeatableItems/updateContent", "spring", { id: "q1", content: { answer: "Yes" } }],
      ["blocks/delete", "spring", { id: "old" }],
    ],
  );
  assert.deepEqual(renderer.all("edited"), [
    { type: "edited", editId: 1 },
    { type: "edited", editId: 2 },
    { type: "edited", editId: 3 },
  ]);
});

void test("an edit made in the renderer while viewing Live starts a draft, which the renderer enters", async (t) => {
  const studio = studioState(null);
  const requests = fakeApi(t, studio.draftScope);
  const host = setup(t, studio);
  const renderer = fakeRenderer(host.handle);
  await settle();
  renderer.send({
    type: "edit",
    editId: 1,
    edit: { type: "blockContent", blockId: "hero", content: { title: "Hello" } },
  });
  await settle();
  const [write] = requests;
  assert.equal(write?.headers.get(DRAFT_CREATE_HEADER), "1");
  const started = write?.headers.get(DRAFT_HEADER);
  assert.ok(started);
  assert.equal(studio.draftScope.current(), started);
  assert.deepEqual(renderer.all("draftStarted"), [{ type: "draftStarted", draftId: started }]);
  assert.deepEqual(renderer.all("edited"), [{ type: "edited", editId: 1 }]);
});

void test("an edit the API refuses is answered with why", async (t) => {
  const studio = studioState("spring");
  fakeApi(t, studio.draftScope, () =>
    Response.json(
      { json: { defined: false, code: "FORBIDDEN", status: 403, message: "Not a member" } },
      { status: 403 },
    ),
  );
  const host = setup(t, studio);
  const renderer = fakeRenderer(host.handle);
  await settle();
  renderer.send({
    type: "edit",
    editId: 4,
    edit: { type: "itemContent", itemId: "q1", content: { answer: "Yes" } },
  });
  await settle();
  assert.deepEqual(renderer.all("edited"), [{ type: "edited", editId: 4, error: "Not a member" }]);
});

void test("a record field edited in the renderer is saved to the shared record, which the renderer then holds", async (t) => {
  const studio = studioState("spring");
  const saved = { id: "ada", content: { name: "Ada L.", role: "Engineer" } };
  const requests = fakeApi(t, studio.draftScope, (procedure) =>
    Response.json({ json: procedure === "collectionDefinitions/editRecord" ? saved : null }),
  );
  const host = setup(t, studio);
  const renderer = fakeRenderer(host.handle);
  await settle();
  const record = {
    id: "ada",
    collectionId: "people",
    title: "Ada",
    description: null,
    content: { name: "Ada", role: "Engineer" },
  };
  renderer.send({
    type: "edit",
    editId: 1,
    edit: { type: "recordField", projectUuid: "site", record, field: "name", value: "Ada L." },
  });
  await settle();
  assert.deepEqual(
    requests
      .filter(({ procedure }) => procedure === "collectionDefinitions/editRecord")
      .map(({ input }) => input),
    [{ id: "ada", collectionId: "people", content: saved.content, projectUuid: "site" }],
  );
  const recordKey = studio.studioCache.options(
    reads.record({ projectUuid: "site", collectionId: "people", id: "ada" }),
  ).queryKey;
  const recordWrite = renderer
    .all("write")
    .find(({ queryKey }) => JSON.stringify(queryKey) === JSON.stringify(recordKey));
  assert.deepEqual(recordWrite?.value, saved);
  assert.deepEqual(renderer.all("edited"), [{ type: "edited", editId: 1 }]);
});
