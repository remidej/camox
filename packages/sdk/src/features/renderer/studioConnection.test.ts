import assert from "node:assert/strict";
import { test } from "node:test";

import type { QueryKey } from "@camox/api-contract/query-keys";
import { QueryClient } from "@tanstack/react-query";

import { testDraftScope, testStudioCache } from "../../lib/draft-scope.fixtures";
import { reads } from "../../lib/studio-reads";
import { canvasStore } from "../canvas/canvasStore";
import { previewStore, selectionForOwner } from "../preview/previewStore";
import { referencePickerFocus } from "../preview/referencePickerFocus";
import { RENDERER_PROTOCOL } from "./protocol";
import { fakeStudio, settle } from "./protocol.fixtures";
import { connectToStudio } from "./studioConnection";

const page = { kind: "page", pageId: "home" } as const;

/** The renderer document's state: its own cache, viewing `draft` or Live. */
function rendererState(draft: string | null = null) {
  const queryClient = new QueryClient();
  const draftScope = testDraftScope(queryClient);
  if (draft) draftScope.adopt({ draftId: draft });
  return { queryClient, draftScope, studioCache: testStudioCache(queryClient, { draftScope }) };
}

async function connect(t: { after: (fn: () => void) => void }, draft: string | null = null) {
  const studio = fakeStudio();
  const state = rendererState(draft);
  const connection = connectToStudio(studio.handle, state);
  t.after(() => {
    connection.close();
    previewStore.send({ type: "reset" });
    canvasStore.send({ type: "reset" });
  });
  await settle();
  return { studio, connection, ...state };
}

void test("the renderer says hello in its protocol", async (t) => {
  const { studio, connection } = await connect(t);
  assert.deepEqual(studio.all("hello"), [{ type: "hello", protocol: RENDERER_PROTOCOL }]);
  assert.equal(connection.connected(), true);
});

void test("the renderer shows the studio's selection, and sends its own to the studio", async (t) => {
  const { studio } = await connect(t);
  const studioPreview = structuredClone(previewStore.getSnapshot().context);
  studio.send({
    type: "store",
    store: "preview",
    context: {
      ...studioPreview,
      view: "canvas",
      editingContext: { ...page, selection: { type: "block", blockId: "hero" } },
    },
  });
  await settle();
  assert.equal(previewStore.getSnapshot().context.view, "canvas");
  assert.deepEqual(selectionForOwner(previewStore.getSnapshot().context, page), {
    type: "block",
    blockId: "hero",
  });
  assert.deepEqual(studio.all("storeEvent"), [], "what the studio said isn't sent back");

  previewStore.send({ type: "selectItem", ...page, blockId: "faq", itemId: "q1" });
  referencePickerFocus.send({ type: "request", fieldId: "faq__author" });
  await settle();
  assert.deepEqual(
    studio.all("storeEvent").map(({ store, event }) => [store, event]),
    [
      ["preview", { type: "selectItem", ...page, blockId: "faq", itemId: "q1" }],
      ["referencePickerFocus", { type: "request", fieldId: "faq__author" }],
    ],
  );
});

void test("the renderer follows the studio's Canvas cameras", async (t) => {
  const { studio } = await connect(t);
  const views = { main: { camera: { x: 4, y: 2, scale: 0.5 }, fitted: false } };
  studio.send({
    type: "store",
    store: "canvas",
    context: { views, moving: {}, overviewRequests: 0 },
  });
  await settle();
  assert.deepEqual(canvasStore.getSnapshot().context.views, views);
});

void test("the studio's invalidations for the renderer's draft refetch the renderer's reads", async (t) => {
  const { studio, queryClient, studioCache } = await connect(t, "spring");
  const pages = reads.pageList({ projectUuid: "p" });
  studioCache.set(pages, []);
  studio.send({
    type: "invalidate",
    message: { type: "invalidate", draftId: "spring", targets: [["camox", "pages"] as QueryKey] },
    projectId: 7,
  });
  await settle();
  const query = queryClient.getQueryCache().find({ queryKey: studioCache.options(pages).queryKey });
  assert.equal(query?.state.isInvalidated, true);
});

void test("the studio's writes reach the reads the renderer holds, and only those", async (t) => {
  const { studio, queryClient, studioCache } = await connect(t, "spring");
  const held = reads.blockBundle("hero");
  const other = reads.blockBundle("footer");
  studioCache.set(held, { block: { id: "hero", content: { title: "Before" } } });
  const heldKey = studioCache.options(held).queryKey;
  const otherKey = studioCache.options(other).queryKey;
  const after = { block: { id: "hero", content: { title: "After" } } };
  studio.send({ type: "write", queryKey: heldKey, value: after });
  studio.send({ type: "write", queryKey: otherKey, value: after });
  await settle();
  assert.deepEqual(studioCache.get(held), after);
  assert.equal(queryClient.getQueryCache().find({ queryKey: otherKey, exact: true }), undefined);

  studio.send({ type: "outdated", queryKeys: [heldKey] });
  await settle();
  assert.equal(
    queryClient.getQueryCache().find({ queryKey: heldKey, exact: true })?.state.isInvalidated,
    true,
  );
  studio.send({ type: "write", queryKey: heldKey });
  await settle();
  assert.equal(studioCache.get(held), undefined, "a write without a value forgets the read");
});

void test("the renderer enters the draft the studio's first write started", async (t) => {
  const { studio, draftScope } = await connect(t);
  studio.send({ type: "draftStarted", draftId: "fresh" });
  await settle();
  assert.equal(draftScope.current(), "fresh");
});

void test("the renderer keeps the frames the studio gives it, until they end", async (t) => {
  const { studio, connection } = await connect(t);
  const slot = {} as HTMLElement;
  const target = {
    pathname: "/",
    href: "http://localhost/",
    owner: page,
    locale: null,
    editable: true,
    artifactsRun: true,
    artifactStudio: null,
    resting: false,
    canvas: null,
  };
  studio.send({ type: "frame", frameId: "preview", slot, target });
  studio.send({ type: "frame", frameId: "card", slot, target });
  studio.send({ type: "frameEnd", frameId: "card" });
  await settle();
  assert.deepEqual(connection.frames(), [{ frameId: "preview", slot, target }]);
});

void test("the renderer's edits go to the studio, and each settles as the studio answers it", async (t) => {
  const { studio, connection } = await connect(t);
  const title = { type: "blockContent", blockId: "hero", content: { title: "Hello" } } as const;
  const answer = { type: "itemContent", itemId: "q1", content: { answer: "Yes" } } as const;
  const outcomes: unknown[] = [];
  void connection.edit(title).then(
    () => outcomes.push("title saved"),
    (error: Error) => outcomes.push({ title: error.message }),
  );
  void connection.edit(answer).then(
    () => outcomes.push("answer saved"),
    (error: Error) => outcomes.push({ answer: error.message }),
  );
  await settle();
  const sent = studio.all("edit");
  assert.deepEqual(
    sent.map(({ edit }) => edit),
    [title, answer],
  );
  assert.deepEqual(outcomes, [], "nothing settles before the studio answers");
  studio.send({ type: "edited", editId: sent[1]!.editId, error: "Not a member" });
  studio.send({ type: "edited", editId: sent[0]!.editId });
  // An answer to no edit of this renderer's changes nothing.
  studio.send({ type: "edited", editId: -1 });
  await settle();
  assert.deepEqual(outcomes, [{ answer: "Not a member" }, "title saved"]);
});
