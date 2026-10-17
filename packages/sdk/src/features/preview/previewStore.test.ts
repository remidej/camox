import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import type { PreviewMode, Selection } from "./previewStore";

// Test real store transitions without browser-only notifications.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@camox/ui/toaster") {
      return { url: "data:text/javascript,export const toast = () => {}", shortCircuit: true };
    }

    return nextResolve(specifier, context);
  },
});

void test("editing context starts unresolved and clearing cannot invent a page", async () => {
  const { previewStore: store } = await import("./previewStore");
  const initial = store.getInitialSnapshot();
  assert.equal(initial.context.editingContext, null);
  assert.equal("selection" in initial.context, false);
  for (const type of ["clearSelection", "selectParent"] as const) {
    const [next] = store.transition(initial, { type });
    assert.equal(next.context.editingContext, null);
  }
  const [loaded] = store.transition(initial, { type: "activatePage", pageId: "3" });
  assert.deepEqual(loaded.context.editingContext, { kind: "page", pageId: "3", selection: null });
  const [unresolved] = store.transition(loaded, { type: "activatePage", pageId: null });
  assert.equal(unresolved.context.editingContext, null);
});

void test("page activation preserves same-page selection and clears a different page", async () => {
  const { previewStore: store, selectionForPage } = await import("./previewStore");
  const selection: Selection = {
    type: "item-field",
    blockId: "7",
    itemId: "12",
    fieldName: "title",
    fieldType: "String",
  };
  const [selected] = store.transition(store.getInitialSnapshot(), {
    type: "selectTarget",
    kind: "page",
    pageId: "3",
    selection,
  });
  const [samePage] = store.transition(selected, { type: "activatePage", pageId: "3" });
  assert.equal(samePage.context.editingContext, selected.context.editingContext);
  assert.equal(selectionForPage(samePage.context, "3"), selection);
  // Shared layout block IDs must not highlight the same block on another page.
  assert.equal(selectionForPage(samePage.context, "4"), null);
  assert.equal(selectionForPage(samePage.context, null), null);
  const [differentPage] = store.transition(samePage, { type: "activatePage", pageId: "4" });
  assert.deepEqual(differentPage.context.editingContext, {
    kind: "page",
    pageId: "4",
    selection: null,
  });
});

void test("block dialog preserves insertion intent and closing leaves selection unchanged", async () => {
  const { previewStore: store } = await import("./previewStore");
  const [selected] = store.transition(store.getInitialSnapshot(), {
    type: "setFocusedBlock",
    kind: "page",
    pageId: "3",
    blockId: "7",
  });

  for (const afterPosition of [undefined, null, "", "a0"]) {
    const [opened] = store.transition(selected, { type: "openAddBlockDialog", afterPosition });
    assert.deepEqual(opened.context.addBlockDialog, { afterPosition });
    assert.equal(opened.context.editingContext, selected.context.editingContext);
    const [closed] = store.transition(opened, { type: "closeAddBlockDialog" });
    assert.equal(closed.context.addBlockDialog, null);
    assert.equal(closed.context.editingContext, selected.context.editingContext);

    const [samePage] = store.transition(opened, { type: "activatePage", pageId: "3" });
    assert.equal(samePage.context.addBlockDialog, opened.context.addBlockDialog);
    const [otherPage] = store.transition(opened, { type: "activatePage", pageId: "4" });
    assert.equal(otherPage.context.addBlockDialog, null);
    const [layout] = store.transition(opened, { type: "activateLayout", layoutId: "news" });
    assert.equal(layout.context.addBlockDialog, null);
  }
});

void test("target selection changes page and target in one observable transition", async () => {
  const { previewStore: store } = await import("./previewStore");
  store.send({ type: "activatePage", pageId: "3" });
  store.send({ type: "setFocusedBlock", kind: "page", pageId: "3", blockId: "7" });
  const observed: unknown[] = [];
  const subscription = store.subscribe((snapshot) =>
    observed.push(snapshot.context.editingContext),
  );
  const selection: Selection = {
    type: "block-field",
    blockId: "9",
    fieldName: "image",
    fieldType: "Image",
  };
  try {
    store.send({ type: "selectTarget", kind: "page", pageId: "4", selection });
    assert.deepEqual(observed, [{ kind: "page", pageId: "4", selection }]);
    store.send({ type: "activatePage", pageId: "4" });
    assert.deepEqual(store.getSnapshot().context.editingContext, {
      kind: "page",
      pageId: "4",
      selection,
    });
    store.send({ type: "clearSelection" });
    assert.deepEqual(store.getSnapshot().context.editingContext, {
      kind: "page",
      pageId: "4",
      selection: null,
    });
  } finally {
    subscription.unsubscribe();
    store.send({ type: "activatePage", pageId: null });
  }
});

void test("derived layout targets use real layout IDs and never alias pages with the same ID", async () => {
  const { previewStore: store, selectionForOwner } = await import("./previewStore");
  const selection: Selection = { type: "block", blockId: "7" };
  let snapshot = store.getInitialSnapshot();
  [snapshot] = store.transition(snapshot, { type: "activateLayout", layoutId: "default" });
  assert.deepEqual(snapshot.context.editingContext, {
    kind: "layout",
    layoutId: "default",
    selection: null,
  });
  [snapshot] = store.transition(snapshot, {
    type: "selectTarget",
    kind: "layout",
    layoutId: "default",
    selection,
  });
  const selected = snapshot.context.editingContext;
  [snapshot] = store.transition(snapshot, { type: "activateLayout", layoutId: "default" });
  assert.equal(snapshot.context.editingContext, selected);
  assert.equal(
    selectionForOwner(snapshot.context, { kind: "layout", layoutId: "default" }),
    selection,
  );
  assert.equal(selectionForOwner(snapshot.context, { kind: "page", pageId: "3" }), null);
  [snapshot] = store.transition(snapshot, { type: "clearSelection" });
  assert.deepEqual(snapshot.context.editingContext, {
    kind: "layout",
    layoutId: "default",
    selection: null,
  });
  [snapshot] = store.transition(snapshot, { type: "activatePage", pageId: "3" });
  assert.deepEqual(snapshot.context.editingContext, { kind: "page", pageId: "3", selection: null });
});

void test("parent navigation, insertion focus and modal state remain independent of the active page", async () => {
  const { previewStore: store } = await import("./previewStore");
  let snapshot = store.getInitialSnapshot();
  [snapshot] = store.transition(snapshot, { type: "openEditPageModal", pageId: "99" });
  [snapshot] = store.transition(snapshot, {
    type: "selectTarget",
    kind: "page",
    pageId: "3",
    selection: {
      type: "item-field",
      blockId: "7",
      itemId: "12",
      fieldName: "title",
      fieldType: "String",
    },
  });
  [snapshot] = store.transition(snapshot, { type: "selectParent" });
  assert.deepEqual(snapshot.context.editingContext, {
    kind: "page",
    pageId: "3",
    selection: { type: "item", blockId: "7", itemId: "12" },
  });
  [snapshot] = store.transition(snapshot, { type: "selectParent" });
  assert.deepEqual(snapshot.context.editingContext, {
    kind: "page",
    pageId: "3",
    selection: { type: "block", blockId: "7" },
  });
  [snapshot] = store.transition(snapshot, { type: "openAddBlockDialog", afterPosition: "a0" });
  [snapshot] = store.transition(snapshot, {
    type: "focusCreatedBlock",
    kind: "page",
    pageId: "4",
    blockId: "9",
  });
  assert.deepEqual(snapshot.context.editingContext, {
    kind: "page",
    pageId: "4",
    selection: { type: "block", blockId: "9" },
  });
  assert.equal(snapshot.context.addBlockDialog, null);
  assert.equal(snapshot.context.editingPageId, "99");
  [snapshot] = store.transition(snapshot, { type: "clearSelection" });
  assert.deepEqual(snapshot.context.editingContext, { kind: "page", pageId: "4", selection: null });
  assert.equal(snapshot.context.editingPageId, "99");
});

void test("preview clicks select the containing page, and unresolved or nonediting clicks do nothing", async () => {
  const { previewStore: store } = await import("./previewStore");
  const { selectPreviewTarget } = await import("./previewSelection");
  store.send({ type: "enterEditMode" });
  store.send({ type: "activatePage", pageId: "3" });
  const selection: Selection = {
    type: "block-field",
    blockId: "7",
    fieldName: "title",
    fieldType: "String",
  };
  selectPreviewTarget(selection, { kind: "page", pageId: "4" });
  assert.deepEqual(store.getSnapshot().context.editingContext, {
    kind: "page",
    pageId: "4",
    selection,
  });
  selectPreviewTarget({ type: "block", blockId: "8" }, { kind: "page", pageId: "5" });
  assert.deepEqual(store.getSnapshot().context.editingContext, {
    kind: "page",
    pageId: "5",
    selection: { type: "block", blockId: "8" },
  });
  const selected = store.getSnapshot().context.editingContext;
  selectPreviewTarget(selection, null);
  assert.equal(store.getSnapshot().context.editingContext, selected);
  store.send({ type: "exitEditMode" });
  selectPreviewTarget(selection, { kind: "page", pageId: "6" });
  assert.equal(store.getSnapshot().context.editingContext, selected);
  store.send({ type: "activatePage", pageId: null });
});

void test("preview modes have only valid edit combinations across every transition", async () => {
  const { previewStore, selectIsEditMode } = await import("./previewStore");
  const modes: PreviewMode[] = ["editing-draft", "previewing-draft"];
  const transitions = [
    {
      type: "enterEditMode",
      expected: ["editing-draft", "editing-draft"],
    },
    {
      type: "exitEditMode",
      expected: ["previewing-draft", "previewing-draft"],
    },
  ] as const;

  assert.equal(previewStore.getSnapshot().context.mode, "previewing-draft");

  for (const [index, mode] of modes.entries()) {
    for (const { type, expected } of transitions) {
      previewStore.send({ type: "enterEditMode" });
      if (mode === "previewing-draft") previewStore.send({ type: "exitEditMode" });

      previewStore.send({ type });
      const snapshot = previewStore.getSnapshot();
      assert.equal(snapshot.context.mode, expected[index], `${mode} → ${type}`);
      assert.equal(selectIsEditMode(snapshot), snapshot.context.mode === "editing-draft");
      if (type === "enterEditMode") assert.equal(snapshot.context.isToolbarHidden, false);
    }
  }
});

void test("record field selections are owner-scoped and step up through the record and reference field", async () => {
  const { previewStore: store, selectionForOwner } = await import("./previewStore");
  let snapshot = store.getInitialSnapshot();
  [snapshot] = store.transition(snapshot, {
    type: "selectRecordField",
    kind: "layout",
    layoutId: "news",
    blockId: "7",
    fieldName: "company",
    recordId: "acme",
    recordFieldName: "quote",
    recordFieldType: "String",
  });
  assert.equal(selectionForOwner(snapshot.context, { kind: "page", pageId: "5" }), null);
  assert.deepEqual(selectionForOwner(snapshot.context, { kind: "layout", layoutId: "news" }), {
    type: "record-field",
    blockId: "7",
    fieldName: "company",
    recordId: "acme",
    recordFieldName: "quote",
    recordFieldType: "String",
  });
  const path: Array<Selection | null | undefined> = [];
  for (let step = 0; step < 3; step++) {
    [snapshot] = store.transition(snapshot, { type: "selectParent" });
    path.push(snapshot.context.editingContext?.selection);
  }
  assert.deepEqual(path, [
    { type: "record", blockId: "7", fieldName: "company", recordId: "acme" },
    { type: "block-field", blockId: "7", fieldName: "company", fieldType: "Reference" },
    { type: "block", blockId: "7" },
  ]);
  assert.equal(snapshot.context.editingContext?.kind, "layout");

  [snapshot] = store.transition(snapshot, {
    type: "selectRecord",
    kind: "page",
    pageId: "3",
    blockId: "8",
    fieldName: "company",
    recordId: "globex",
  });
  assert.deepEqual(snapshot.context.editingContext, {
    kind: "page",
    pageId: "3",
    selection: { type: "record", blockId: "8", fieldName: "company", recordId: "globex" },
  });
});

void test("records placed by an item step up through the item's reference field and the item", async () => {
  const { previewStore: store, selectionItemId } = await import("./previewStore");
  let snapshot = store.getInitialSnapshot();
  [snapshot] = store.transition(snapshot, {
    type: "selectRecordField",
    kind: "page",
    pageId: "3",
    blockId: "7",
    itemId: "12",
    fieldName: "sponsor",
    recordId: "acme",
    recordFieldName: "quote",
    recordFieldType: "String",
  });
  assert.equal(selectionItemId(snapshot.context.editingContext!.selection), "12");
  const path: Array<Selection | null | undefined> = [];
  for (let step = 0; step < 4; step++) {
    [snapshot] = store.transition(snapshot, { type: "selectParent" });
    path.push(snapshot.context.editingContext?.selection);
  }
  assert.deepEqual(path, [
    { type: "record", blockId: "7", itemId: "12", fieldName: "sponsor", recordId: "acme" },
    {
      type: "item-field",
      blockId: "7",
      itemId: "12",
      fieldName: "sponsor",
      fieldType: "Reference",
    },
    { type: "item", blockId: "7", itemId: "12" },
    { type: "block", blockId: "7" },
  ]);
});

void test("records linked by a placed record step up through that record's reference field", async () => {
  const { previewStore: store } = await import("./previewStore");
  let snapshot = store.getInitialSnapshot();
  [snapshot] = store.transition(snapshot, {
    type: "selectRecordField",
    kind: "page",
    pageId: "3",
    blockId: "7",
    fieldName: "article",
    recordId: "launch",
    nested: { fieldName: "author", recordId: "jane" },
    recordFieldName: "name",
    recordFieldType: "String",
  });
  const path: Array<Selection | null | undefined> = [];
  for (let step = 0; step < 4; step++) {
    [snapshot] = store.transition(snapshot, { type: "selectParent" });
    path.push(snapshot.context.editingContext?.selection);
  }
  const article = { blockId: "7", fieldName: "article", recordId: "launch" };
  assert.deepEqual(path, [
    { type: "record", ...article, nested: { fieldName: "author", recordId: "jane" } },
    { type: "record-field", ...article, recordFieldName: "author", recordFieldType: "Reference" },
    { type: "record", ...article },
    { type: "block-field", blockId: "7", fieldName: "article", fieldType: "Reference" },
  ]);
});

void test("a layout-owned record placement is its own selection target and the root of its path", async () => {
  const { previewStore: store, samePlacement } = await import("./previewStore");
  let snapshot = store.getInitialSnapshot();
  [snapshot] = store.transition(snapshot, {
    type: "selectRecordField",
    kind: "layout",
    layoutId: "news",
    recordId: "launch",
    recordFieldName: "title",
    recordFieldType: "String",
  });
  assert.deepEqual(snapshot.context.editingContext, {
    kind: "layout",
    layoutId: "news",
    selection: {
      type: "record-field",
      layoutId: "news",
      recordId: "launch",
      recordFieldName: "title",
      recordFieldType: "String",
    },
  });
  const path: Array<Selection | null | undefined> = [];
  for (let step = 0; step < 2; step++) {
    [snapshot] = store.transition(snapshot, { type: "selectParent" });
    path.push(snapshot.context.editingContext?.selection);
  }
  assert.deepEqual(path, [
    { type: "record", layoutId: "news", recordId: "launch" },
    { type: "record", layoutId: "news", recordId: "launch" },
  ]);

  const layoutOwned = { layoutId: "news", recordId: "launch" };
  assert.equal(samePlacement(layoutOwned, { layoutId: "news", recordId: "launch" }), true);
  assert.equal(samePlacement(layoutOwned, { layoutId: "events", recordId: "launch" }), false);
  // A layout block placing the same record on the same page is another placement.
  assert.equal(
    samePlacement(layoutOwned, { blockId: "5", fieldName: "article", recordId: "launch" }),
    false,
  );
});

void test("a record linked by a layout-owned placement steps up to the page record's reference field", async () => {
  const { previewStore: store } = await import("./previewStore");
  let snapshot = store.getInitialSnapshot();
  [snapshot] = store.transition(snapshot, {
    type: "selectRecord",
    kind: "layout",
    layoutId: "news",
    recordId: "launch",
    nested: { fieldName: "author", recordId: "jane" },
  });
  const path: Array<Selection | null | undefined> = [];
  for (let step = 0; step < 2; step++) {
    [snapshot] = store.transition(snapshot, { type: "selectParent" });
    path.push(snapshot.context.editingContext?.selection);
  }
  assert.deepEqual(path, [
    {
      type: "record-field",
      layoutId: "news",
      recordId: "launch",
      recordFieldName: "author",
      recordFieldType: "Reference",
    },
    { type: "record", layoutId: "news", recordId: "launch" },
  ]);
});
