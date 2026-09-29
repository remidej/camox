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
  const [loaded] = store.transition(initial, { type: "activatePage", pageId: 3 });
  assert.deepEqual(loaded.context.editingContext, { kind: "page", pageId: 3, selection: null });
  const [unresolved] = store.transition(loaded, { type: "activatePage", pageId: null });
  assert.equal(unresolved.context.editingContext, null);
});

void test("page activation preserves same-page selection and clears a different page", async () => {
  const { previewStore: store, selectionForPage } = await import("./previewStore");
  const selection: Selection = {
    type: "item-field",
    blockId: 7,
    itemId: 12,
    fieldName: "title",
    fieldType: "String",
  };
  const [selected] = store.transition(store.getInitialSnapshot(), {
    type: "selectTarget",
    kind: "page",
    pageId: 3,
    selection,
  });
  const [samePage] = store.transition(selected, { type: "activatePage", pageId: 3 });
  assert.equal(samePage.context.editingContext, selected.context.editingContext);
  assert.equal(selectionForPage(samePage.context, 3), selection);
  // Shared layout block IDs must not highlight the same block on another page.
  assert.equal(selectionForPage(samePage.context, 4), null);
  assert.equal(selectionForPage(samePage.context, null), null);
  const [differentPage] = store.transition(samePage, { type: "activatePage", pageId: 4 });
  assert.deepEqual(differentPage.context.editingContext, {
    kind: "page",
    pageId: 4,
    selection: null,
  });
});

void test("block dialog preserves insertion intent and closing leaves selection unchanged", async () => {
  const { previewStore: store } = await import("./previewStore");
  const [selected] = store.transition(store.getInitialSnapshot(), {
    type: "setFocusedBlock",
    kind: "page",
    pageId: 3,
    blockId: 7,
  });

  for (const afterPosition of [undefined, null, "", "a0"]) {
    const [opened] = store.transition(selected, { type: "openAddBlockDialog", afterPosition });
    assert.deepEqual(opened.context.addBlockDialog, { afterPosition });
    assert.equal(opened.context.editingContext, selected.context.editingContext);
    const [closed] = store.transition(opened, { type: "closeAddBlockDialog" });
    assert.equal(closed.context.addBlockDialog, null);
    assert.equal(closed.context.editingContext, selected.context.editingContext);

    const [samePage] = store.transition(opened, { type: "activatePage", pageId: 3 });
    assert.equal(samePage.context.addBlockDialog, opened.context.addBlockDialog);
    const [otherPage] = store.transition(opened, { type: "activatePage", pageId: 4 });
    assert.equal(otherPage.context.addBlockDialog, null);
    const [layout] = store.transition(opened, { type: "activateLayout", layoutId: 5 });
    assert.equal(layout.context.addBlockDialog, null);
  }
});

void test("target selection changes page and target in one observable transition", async () => {
  const { previewStore: store } = await import("./previewStore");
  store.send({ type: "activatePage", pageId: 3 });
  store.send({ type: "setFocusedBlock", kind: "page", pageId: 3, blockId: 7 });
  const observed: unknown[] = [];
  const subscription = store.subscribe((snapshot) =>
    observed.push(snapshot.context.editingContext),
  );
  const selection: Selection = {
    type: "block-field",
    blockId: 9,
    fieldName: "image",
    fieldType: "Image",
  };
  try {
    store.send({ type: "selectTarget", kind: "page", pageId: 4, selection });
    assert.deepEqual(observed, [{ kind: "page", pageId: 4, selection }]);
    store.send({ type: "activatePage", pageId: 4 });
    assert.deepEqual(store.getSnapshot().context.editingContext, {
      kind: "page",
      pageId: 4,
      selection,
    });
    store.send({ type: "clearSelection" });
    assert.deepEqual(store.getSnapshot().context.editingContext, {
      kind: "page",
      pageId: 4,
      selection: null,
    });
  } finally {
    subscription.unsubscribe();
    store.send({ type: "activatePage", pageId: null });
  }
});

void test("derived layout targets use real layout IDs and never alias pages with the same ID", async () => {
  const { previewStore: store, selectionForOwner } = await import("./previewStore");
  const selection: Selection = { type: "block", blockId: 7 };
  let snapshot = store.getInitialSnapshot();
  [snapshot] = store.transition(snapshot, { type: "activateLayout", layoutId: 3 });
  assert.deepEqual(snapshot.context.editingContext, {
    kind: "layout",
    layoutId: 3,
    selection: null,
  });
  [snapshot] = store.transition(snapshot, {
    type: "selectTarget",
    kind: "layout",
    layoutId: 3,
    selection,
  });
  const selected = snapshot.context.editingContext;
  [snapshot] = store.transition(snapshot, { type: "activateLayout", layoutId: 3 });
  assert.equal(snapshot.context.editingContext, selected);
  assert.equal(selectionForOwner(snapshot.context, { kind: "layout", layoutId: 3 }), selection);
  assert.equal(selectionForOwner(snapshot.context, { kind: "page", pageId: 3 }), null);
  [snapshot] = store.transition(snapshot, { type: "clearSelection" });
  assert.deepEqual(snapshot.context.editingContext, {
    kind: "layout",
    layoutId: 3,
    selection: null,
  });
  [snapshot] = store.transition(snapshot, { type: "activatePage", pageId: 3 });
  assert.deepEqual(snapshot.context.editingContext, { kind: "page", pageId: 3, selection: null });
});

void test("parent navigation, insertion focus and modal state remain independent of the active page", async () => {
  const { previewStore: store } = await import("./previewStore");
  let snapshot = store.getInitialSnapshot();
  [snapshot] = store.transition(snapshot, { type: "openEditPageModal", pageId: 99 });
  [snapshot] = store.transition(snapshot, {
    type: "selectTarget",
    kind: "page",
    pageId: 3,
    selection: {
      type: "item-field",
      blockId: 7,
      itemId: 12,
      fieldName: "title",
      fieldType: "String",
    },
  });
  [snapshot] = store.transition(snapshot, { type: "selectParent" });
  assert.deepEqual(snapshot.context.editingContext, {
    kind: "page",
    pageId: 3,
    selection: { type: "item", blockId: 7, itemId: 12 },
  });
  [snapshot] = store.transition(snapshot, { type: "selectParent" });
  assert.deepEqual(snapshot.context.editingContext, {
    kind: "page",
    pageId: 3,
    selection: { type: "block", blockId: 7 },
  });
  [snapshot] = store.transition(snapshot, { type: "openAddBlockDialog", afterPosition: "a0" });
  [snapshot] = store.transition(snapshot, {
    type: "focusCreatedBlock",
    kind: "page",
    pageId: 4,
    blockId: 9,
  });
  assert.deepEqual(snapshot.context.editingContext, {
    kind: "page",
    pageId: 4,
    selection: { type: "block", blockId: 9 },
  });
  assert.equal(snapshot.context.addBlockDialog, null);
  assert.equal(snapshot.context.editingPageId, 99);
  [snapshot] = store.transition(snapshot, { type: "clearSelection" });
  assert.deepEqual(snapshot.context.editingContext, { kind: "page", pageId: 4, selection: null });
  assert.equal(snapshot.context.editingPageId, 99);
});

void test("preview clicks select the containing page, and unresolved or nonediting clicks do nothing", async () => {
  const { previewStore: store } = await import("./previewStore");
  const { selectPreviewTarget } = await import("./previewSelection");
  store.send({ type: "enterEditMode" });
  store.send({ type: "activatePage", pageId: 3 });
  const selection: Selection = {
    type: "block-field",
    blockId: 7,
    fieldName: "title",
    fieldType: "String",
  };
  selectPreviewTarget(selection, { kind: "page", pageId: 4 });
  assert.deepEqual(store.getSnapshot().context.editingContext, {
    kind: "page",
    pageId: 4,
    selection,
  });
  selectPreviewTarget({ type: "block", blockId: 8 }, { kind: "page", pageId: 5 });
  assert.deepEqual(store.getSnapshot().context.editingContext, {
    kind: "page",
    pageId: 5,
    selection: { type: "block", blockId: 8 },
  });
  const selected = store.getSnapshot().context.editingContext;
  selectPreviewTarget(selection, null);
  assert.equal(store.getSnapshot().context.editingContext, selected);
  store.send({ type: "exitEditMode" });
  selectPreviewTarget(selection, { kind: "page", pageId: 6 });
  assert.equal(store.getSnapshot().context.editingContext, selected);
  store.send({ type: "activatePage", pageId: null });
});

void test("comment mode is available with experimental features unset or disabled", async () => {
  const flags = globalThis as typeof globalThis & {
    __CAMOX_ENABLE_EXPERIMENTAL_FEATURES__?: boolean;
  };
  const previousFlag = flags.__CAMOX_ENABLE_EXPERIMENTAL_FEATURES__;
  const { previewStore } = await import("./previewStore");
  try {
    for (const flag of [undefined, false]) {
      if (flag === undefined) delete flags.__CAMOX_ENABLE_EXPERIMENTAL_FEATURES__;
      else flags.__CAMOX_ENABLE_EXPERIMENTAL_FEATURES__ = flag;
      previewStore.send({ type: "exitEditMode" });
      previewStore.send({ type: "setCommentMode", enabled: true });
      assert.equal(previewStore.getSnapshot().context.mode, "previewing-draft");
      previewStore.send({ type: "enterEditMode" });
      previewStore.send({ type: "setFocusedBlock", kind: "page", pageId: 3, blockId: 1 });
      previewStore.send({ type: "setCommentMode", enabled: true });
      assert.equal(previewStore.getSnapshot().context.mode, "commenting-draft");
      assert.equal(previewStore.getSnapshot().context.editingContext?.selection, null);
    }
  } finally {
    if (previousFlag === undefined) delete flags.__CAMOX_ENABLE_EXPERIMENTAL_FEATURES__;
    else flags.__CAMOX_ENABLE_EXPERIMENTAL_FEATURES__ = previousFlag;
    previewStore.send({ type: "exitEditMode" });
  }
});

void test("comment mode is draft-editing only and clears editing selection", async () => {
  const { previewStore } = await import("./previewStore");
  previewStore.send({ type: "exitEditMode" });
  previewStore.send({ type: "setCommentMode", enabled: true });
  assert.equal(previewStore.getSnapshot().context.mode, "previewing-draft");

  previewStore.send({ type: "enterEditMode" });
  previewStore.send({ type: "setFocusedBlock", kind: "page", pageId: 3, blockId: 1 });
  previewStore.send({ type: "setCommentMode", enabled: true });
  assert.equal(previewStore.getSnapshot().context.mode, "commenting-draft");
  assert.equal(previewStore.getSnapshot().context.editingContext?.selection, null);

  previewStore.send({ type: "exitEditMode" });
  assert.equal(previewStore.getSnapshot().context.mode, "previewing-draft");
  previewStore.send({ type: "enterEditMode" });
  previewStore.send({ type: "setCommentMode", enabled: true });
  previewStore.send({ type: "viewLiveSite" });
  assert.equal(previewStore.getSnapshot().context.mode, "previewing-live");
  previewStore.send({ type: "setCommentMode", enabled: true });
  assert.equal(previewStore.getSnapshot().context.mode, "previewing-live");
  previewStore.send({ type: "viewDraftSite" });
});

void test("comments reveal the existing editor and retain their page and field target", async () => {
  const { previewStore } = await import("./previewStore");
  const { previewCommentsStore, revealCommentTarget } = await import("./previewCommentsStore");
  const target = {
    kind: "item-field" as const,
    blockId: 7,
    itemId: 12,
    fieldName: "title",
  };
  previewStore.send({ type: "enterEditMode" });
  previewStore.send({ type: "openAddBlockDialog" });
  previewStore.send({ type: "setCommentMode", enabled: true });
  previewCommentsStore.send({ type: "startComment", pageId: 3, target, focusComposer: true });
  assert.equal(previewCommentsStore.getSnapshot().context.focusTarget, target);
  previewCommentsStore.send({ type: "composerFocused" });
  assert.equal(previewCommentsStore.getSnapshot().context.focusTarget, null);
  revealCommentTarget(3, target, "String");
  assert.equal(previewStore.getSnapshot().context.mode, "editing-draft");
  assert.equal(previewStore.getSnapshot().context.addBlockDialog, null);
  assert.deepEqual(previewStore.getSnapshot().context.editingContext?.selection, {
    type: "item-field",
    blockId: 7,
    itemId: 12,
    fieldName: "title",
    fieldType: "String",
  });
  assert.equal(previewCommentsStore.getSnapshot().context.draft?.target, target);

  previewCommentsStore.send({ type: "setMessage", message: "  Shorten this title  " });
  const draft = previewCommentsStore.getSnapshot().context.draft!;
  previewCommentsStore.send({ type: "postSucceeded", draft });
  assert.equal(previewCommentsStore.getSnapshot().context.draft, null);
  assert.equal(previewCommentsStore.getSnapshot().context.activeId, draft.id);
  assert.equal("comments" in previewCommentsStore.getSnapshot().context, false);
  previewCommentsStore.send({ type: "startComment", pageId: 3, target });
  assert.equal(previewCommentsStore.getSnapshot().context.focusTarget, null);
  previewCommentsStore.send({ type: "cancelDraft" });

  const { fieldTypesDictionary } = await import("../../core/lib/fieldTypes");
  for (const fieldType of Object.keys(fieldTypesDictionary) as Array<
    keyof typeof fieldTypesDictionary
  >) {
    assert.equal(fieldTypesDictionary[fieldType].hasOwnView, true);
    revealCommentTarget(3, { kind: "block-field", blockId: 7, fieldName: "title" }, fieldType);
    assert.deepEqual(previewStore.getSnapshot().context.editingContext?.selection, {
      type: "block-field",
      blockId: 7,
      fieldName: "title",
      fieldType,
    });
    previewStore.send({ type: "selectParent" });
    assert.deepEqual(previewStore.getSnapshot().context.editingContext?.selection, {
      type: "block",
      blockId: 7,
    });
  }

  revealCommentTarget(3, { kind: "block", blockId: 7 });
  assert.deepEqual(previewStore.getSnapshot().context.editingContext?.selection, {
    type: "block",
    blockId: 7,
  });
  previewStore.send({ type: "exitEditMode" });
});

void test("page comments retain their page without a block target", async () => {
  const { previewStore } = await import("./previewStore");
  const { previewCommentsStore, revealCommentTarget } = await import("./previewCommentsStore");
  const target = { kind: "page" as const };
  previewStore.send({ type: "enterEditMode" });
  previewStore.send({ type: "setFocusedBlock", kind: "page", pageId: 4, blockId: 7 });
  revealCommentTarget(3, target);
  assert.deepEqual(previewStore.getSnapshot().context.editingContext, {
    kind: "page",
    pageId: 3,
    selection: null,
  });

  previewCommentsStore.send({ type: "startComment", pageId: 3, target });
  previewCommentsStore.send({ type: "setMessage", message: "Review the whole page" });
  const comment = previewCommentsStore.getSnapshot().context.draft!;
  previewCommentsStore.send({ type: "postSucceeded", draft: comment });
  assert.equal(comment.pageId, 3);
  assert.deepEqual(comment.target, { kind: "page" });
  assert.equal(comment.message, "Review the whole page");

  previewCommentsStore.send({ type: "startComment", pageId: 4, target });
  assert.equal(previewCommentsStore.getSnapshot().context.draft?.pageId, 4);
  assert.equal(comment.pageId, 3);
  previewCommentsStore.send({ type: "clearSelection" });
  previewStore.send({ type: "exitEditMode" });
});

void test("draft IDs are stable for retries and stale successes cannot replace current UI", async () => {
  const { previewCommentsStore: store } = await import("./previewCommentsStore");
  store.send({ type: "startComment", pageId: 3, target: { kind: "page" }, focusComposer: true });
  const empty = store.getSnapshot().context.draft!;
  assert.match(empty.id, /^[0-9a-f-]{36}$/);
  store.send({ type: "setMessage", message: "First version" });
  const submitted = store.getSnapshot().context.draft!;
  assert.notEqual(submitted.id, empty.id);
  store.send({ type: "setMessage", message: "First version" });
  assert.equal(store.getSnapshot().context.draft, submitted);
  store.send({ type: "setMessage", message: "Revised version" });
  const revised = store.getSnapshot().context;
  assert.notEqual(revised.draft!.id, submitted.id);
  store.send({ type: "postSucceeded", draft: submitted });
  assert.equal(store.getSnapshot().context, revised);

  store.send({ type: "startComment", pageId: 4, target: { kind: "page" } });
  const replacement = store.getSnapshot().context;
  store.send({ type: "postSucceeded", draft: revised.draft! });
  assert.equal(store.getSnapshot().context, replacement);
  store.send({ type: "cancelDraft" });
  store.send({ type: "selectComment", id: "another-comment" });
  store.send({ type: "postSucceeded", draft: replacement.draft! });
  assert.equal(store.getSnapshot().context.draft, null);
  assert.equal(store.getSnapshot().context.activeId, "another-comment");
  store.send({ type: "clearSelection" });
});

void test("comment field types follow current definitions and nested item ancestry", async () => {
  const { getCommentTargetFieldType, revealCommentTarget } = await import("./previewCommentsStore");
  const { previewStore } = await import("./previewStore");
  const { createApp } = await import("../../core/createApp");
  const { createBlock, Type } = await import("../../core/createBlock");
  const definition = createBlock({
    id: "test",
    title: "Test",
    description: "Comment target fixture",
    content: { title: Type.String({ default: "" }) } as Record<
      string,
      import("@sinclair/typebox").TSchema
    >,
    component: () => null,
    toMarkdown: () => [],
  });
  const app = createApp({ blocks: [definition] });
  const bundle = {
    block: { id: 7, type: "test" },
    repeatableItems: [
      { id: 12, fieldName: "rows", parentItemId: null },
      { id: 13, fieldName: "cells", parentItemId: 12 },
    ],
  } as unknown as import("@/lib/queries").BlockBundle;
  const schema = definition._internal.contentSchema as any;
  schema.properties.rows = {
    items: { properties: { cells: { items: { properties: { image: { fieldType: "Image" } } } } } },
  };
  assert.equal(
    getCommentTargetFieldType({ kind: "block-field", blockId: 7, fieldName: "title" }, bundle, app),
    "String",
  );
  const target = { kind: "item-field" as const, blockId: 7, itemId: 13, fieldName: "image" };
  assert.equal(getCommentTargetFieldType(target, bundle, app), "Image");
  schema.properties.rows.items.properties.cells.items.properties.image.fieldType = "Link";
  assert.equal(getCommentTargetFieldType(target, bundle, app), "Link");
  assert.equal(getCommentTargetFieldType({ ...target, itemId: 99 }, bundle, app), undefined);
  delete schema.properties.rows;
  assert.equal(getCommentTargetFieldType(target, bundle, app), undefined);
  previewStore.send({ type: "enterEditMode" });
  revealCommentTarget(3, target);
  assert.deepEqual(previewStore.getSnapshot().context.editingContext?.selection, {
    type: "item",
    blockId: 7,
    itemId: 13,
  });
  previewStore.send({ type: "exitEditMode" });
});

void test("comment mode shares normal hover and redirects native preview clicks", async () => {
  const { Window } = await import("happy-dom");
  const { selectPreviewTarget } = await import("./previewSelection");
  const { previewStore } = await import("./previewStore");
  const { previewCommentsStore } = await import("./previewCommentsStore");
  const { useOverlayState } = await import("../../core/hooks/useOverlayState");
  const window = new Window();
  const doc = window.document;
  const previousCSS = globalThis.CSS;
  globalThis.CSS = window.CSS as unknown as typeof CSS;
  doc.body.innerHTML =
    '<div data-camox-block-id="7"><a data-camox-field-id="7__12__title" href="/other"><span>Title</span></a></div>';
  const field = doc.querySelector("a")!;
  const child = doc.querySelector("span")!;
  field.getBoundingClientRect = () => new window.DOMRect(10, 20, 100, 50);
  let clicks = 0;
  let hovers = 0;
  let wheels = 0;
  field.addEventListener("click", () => clicks++);
  field.addEventListener("mouseover", () => hovers++);
  field.addEventListener("wheel", () => wheels++);
  let selection: Selection = {
    type: "item-field",
    blockId: 7,
    itemId: 12,
    fieldName: "title",
    fieldType: "Link",
  };
  field.addEventListener(
    "click",
    (event) => {
      selectPreviewTarget(
        selection,
        { kind: "page", pageId: 3 },
        event as unknown as MouseEvent & { currentTarget: Element },
      );
    },
    true,
  );
  const block = doc.querySelector("div")!;
  block.addEventListener("click", (event) => {
    if (event.target !== block) return;
    selectPreviewTarget(
      { type: "block", blockId: 7 },
      { kind: "page", pageId: 3 },
      event as unknown as MouseEvent & { currentTarget: Element },
    );
  });
  try {
    previewStore.send({ type: "enterEditMode" });
    child.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.equal(clicks, 1);

    previewStore.send({ type: "setCommentMode", enabled: true });
    assert.deepEqual(useOverlayState(true, true), {
      "data-camox-hovered": true,
      "data-camox-focused": true,
    });
    child.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
    const wheel = new window.WheelEvent("wheel", { bubbles: true, cancelable: true });
    child.dispatchEvent(wheel);
    assert.equal(hovers, 1);
    assert.equal(wheels, 1);
    assert.equal(wheel.defaultPrevented, false);

    const down = new window.MouseEvent("mousedown", { bubbles: true, cancelable: true });
    child.dispatchEvent(down);
    assert.equal(down.defaultPrevented, false);
    const click = new window.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      clientX: 35,
      clientY: 45,
    });
    child.dispatchEvent(click);
    assert.equal(click.defaultPrevented, true);
    assert.equal(clicks, 1);
    assert.equal(previewStore.getSnapshot().context.mode, "editing-draft");
    assert.deepEqual(previewStore.getSnapshot().context.editingContext?.selection, {
      type: "item-field",
      blockId: 7,
      itemId: 12,
      fieldName: "title",
      fieldType: "Link",
    });
    const draft = previewCommentsStore.getSnapshot().context.draft!;
    assert.equal(draft.pageId, 3);
    assert.equal(previewCommentsStore.getSnapshot().context.focusTarget, draft.target);
    assert.deepEqual(draft.target, {
      kind: "item-field",
      blockId: 7,
      itemId: 12,
      fieldName: "title",
    });

    child.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.equal(clicks, 2);

    for (const fieldType of ["Image", "Embed", "String", "File"] as const) {
      selection = { ...selection, fieldType };
      previewStore.send({ type: "setCommentMode", enabled: true });
      child.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      assert.deepEqual(previewCommentsStore.getSnapshot().context.draft?.target, draft.target);
      assert.deepEqual(previewStore.getSnapshot().context.editingContext?.selection, selection);
    }
    previewStore.send({ type: "setCommentMode", enabled: true });
    doc.querySelector("div")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.deepEqual(previewStore.getSnapshot().context.editingContext?.selection, {
      type: "block",
      blockId: 7,
    });

    const item = doc.createElement("div");
    item.setAttribute("data-camox-repeater-item-id", "12");
    block.append(item);
    item.addEventListener("click", (event) => {
      selectPreviewTarget(
        { type: "item", blockId: 7, itemId: 12 },
        { kind: "page", pageId: 3 },
        event as unknown as MouseEvent & { currentTarget: Element },
      );
    });
    previewStore.send({ type: "setCommentMode", enabled: true });
    const itemClick = new window.MouseEvent("click", { bubbles: true, cancelable: true });
    item.dispatchEvent(itemClick);
    assert.equal(itemClick.defaultPrevented, true);
    assert.deepEqual(previewStore.getSnapshot().context.editingContext?.selection, {
      type: "item",
      blockId: 7,
      itemId: 12,
    });
    const itemDraft = previewCommentsStore.getSnapshot().context.draft!;
    assert.equal(itemDraft.pageId, 3);
    assert.deepEqual(itemDraft.target, { kind: "item", blockId: 7, itemId: 12 });

    previewCommentsStore.send({ type: "cancelDraft" });
    previewStore.send({ type: "setCommentMode", enabled: true });
    doc.body.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.equal(previewCommentsStore.getSnapshot().context.draft, null);
    assert.equal(previewStore.getSnapshot().context.mode, "commenting-draft");
    // Focusing an editor while commenting must neither select it nor place a comment.
    selectPreviewTarget(selection, { kind: "page", pageId: 3 });
    assert.equal(previewCommentsStore.getSnapshot().context.draft, null);
    selectPreviewTarget(selection, null);
    assert.equal(previewCommentsStore.getSnapshot().context.draft, null);
  } finally {
    globalThis.CSS = previousCSS;
    previewCommentsStore.send({ type: "cancelDraft" });
    previewStore.send({ type: "exitEditMode" });
    await window.happyDOM.close();
  }
});

void test("preview modes have only valid edit/source combinations across every transition", async () => {
  const { previewStore, selectIsEditMode, selectPreviewSource } = await import("./previewStore");
  const modes: PreviewMode[] = [
    "editing-draft",
    "previewing-draft",
    "previewing-live",
    "commenting-draft",
  ];
  const transitions = [
    {
      type: "enterEditMode",
      expected: ["editing-draft", "editing-draft", "editing-draft", "commenting-draft"],
    },
    {
      type: "exitEditMode",
      expected: ["previewing-draft", "previewing-draft", "previewing-live", "previewing-draft"],
    },
    {
      type: "viewLiveSite",
      expected: ["previewing-live", "previewing-live", "previewing-live", "previewing-live"],
    },
    {
      type: "viewDraftSite",
      expected: ["editing-draft", "previewing-draft", "previewing-draft", "commenting-draft"],
    },
  ] as const;

  assert.equal(previewStore.getSnapshot().context.mode, "previewing-draft");

  for (const [index, mode] of modes.entries()) {
    for (const { type, expected } of transitions) {
      previewStore.send({ type: "setCommentMode", enabled: false });
      previewStore.send({ type: "enterEditMode" });
      if (mode === "commenting-draft") previewStore.send({ type: "setCommentMode", enabled: true });
      if (mode === "previewing-draft") previewStore.send({ type: "exitEditMode" });
      if (mode === "previewing-live") previewStore.send({ type: "viewLiveSite" });

      previewStore.send({ type });
      const snapshot = previewStore.getSnapshot();
      assert.equal(snapshot.context.mode, expected[index], `${mode} → ${type}`);
      assert.equal(
        selectIsEditMode(snapshot),
        snapshot.context.mode === "editing-draft" || snapshot.context.mode === "commenting-draft",
      );
      assert.equal(
        selectPreviewSource(snapshot),
        snapshot.context.mode === "previewing-live" ? "live" : "draft",
      );
      assert.equal(selectIsEditMode(snapshot) && selectPreviewSource(snapshot) === "live", false);
      assert.equal("isCommentMode" in snapshot.context, false);
      if (type === "viewLiveSite") assert.equal(snapshot.context.isToolbarHidden, true);
      if (type === "enterEditMode" || type === "viewDraftSite") {
        assert.equal(snapshot.context.isToolbarHidden, false);
      }
    }
  }
});
