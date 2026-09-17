import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import type { PreviewMode } from "./previewStore";

// Test real store transitions without browser-only notifications or telemetry.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@camox/ui/toaster") {
      return { url: "data:text/javascript,export const toast = () => {}", shortCircuit: true };
    }
    if (specifier === "@/lib/telemetry-client") {
      return {
        url: "data:text/javascript,export const trackClientEvent = () => {}",
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

void test("comments are opt-in and cannot activate when the prototype flag is disabled", async () => {
  const flags = globalThis as typeof globalThis & { __CAMOX_ENABLE_COMMENTS__?: boolean };
  const { areCommentsEnabled } = await import("./commentsEnabled");
  const { previewStore } = await import("./previewStore");
  try {
    delete flags.__CAMOX_ENABLE_COMMENTS__;
    assert.equal(areCommentsEnabled(), false);
    flags.__CAMOX_ENABLE_COMMENTS__ = false;
    assert.equal(areCommentsEnabled(), false);
    previewStore.send({ type: "enterEditMode" });
    previewStore.send({ type: "setFocusedBlock", blockId: 1 });
    previewStore.send({ type: "setCommentMode", enabled: true });
    assert.equal(previewStore.getSnapshot().context.isCommentMode, false);
    assert.deepEqual(previewStore.getSnapshot().context.selection, { type: "block", blockId: 1 });
  } finally {
    flags.__CAMOX_ENABLE_COMMENTS__ = true;
    previewStore.send({ type: "exitEditMode" });
  }
  assert.equal(areCommentsEnabled(), true);
});

void test("comment mode is draft-editing only and clears editing selection", async () => {
  const { previewStore } = await import("./previewStore");
  previewStore.send({ type: "exitEditMode" });
  previewStore.send({ type: "setCommentMode", enabled: true });
  assert.equal(previewStore.getSnapshot().context.isCommentMode, false);

  previewStore.send({ type: "enterEditMode" });
  previewStore.send({ type: "setFocusedBlock", blockId: 1 });
  previewStore.send({ type: "setCommentMode", enabled: true });
  assert.equal(previewStore.getSnapshot().context.isCommentMode, true);
  assert.equal(previewStore.getSnapshot().context.selection, null);

  previewStore.send({ type: "exitEditMode" });
  assert.equal(previewStore.getSnapshot().context.isCommentMode, false);
  previewStore.send({ type: "enterEditMode" });
  previewStore.send({ type: "setCommentMode", enabled: true });
  previewStore.send({ type: "viewLivePage" });
  assert.equal(previewStore.getSnapshot().context.isCommentMode, false);
  previewStore.send({ type: "setCommentMode", enabled: true });
  assert.equal(previewStore.getSnapshot().context.isCommentMode, false);
  previewStore.send({ type: "viewDraftPage" });
});

void test("comments reveal the existing editor and retain their page and field target", async () => {
  const { previewStore } = await import("./previewStore");
  const { previewCommentsStore, revealCommentTarget } = await import("./previewCommentsStore");
  const target = {
    blockId: 7,
    itemId: 12,
    fieldName: "title",
    selector: '[data-camox-field-id="7__12__title"]',
    label: "Field · title",
    x: 0.5,
    y: 0.5,
  };
  previewStore.send({ type: "enterEditMode" });
  previewStore.send({ type: "openAddBlockSidebar" });
  previewStore.send({ type: "setCommentMode", enabled: true });
  previewCommentsStore.send({ type: "startComment", pageId: 3, target, focusComposer: true });
  assert.equal(previewCommentsStore.getSnapshot().context.focusTarget, target);
  previewCommentsStore.send({ type: "composerFocused" });
  assert.equal(previewCommentsStore.getSnapshot().context.focusTarget, null);
  revealCommentTarget(target);
  assert.equal(previewStore.getSnapshot().context.isCommentMode, false);
  assert.equal(previewStore.getSnapshot().context.isAddBlockSidebarOpen, false);
  assert.deepEqual(previewStore.getSnapshot().context.selection, {
    type: "item-field",
    blockId: 7,
    itemId: 12,
    fieldName: "title",
    fieldType: "String",
  });
  assert.equal(previewCommentsStore.getSnapshot().context.draft?.target, target);

  previewCommentsStore.send({ type: "setMessage", message: "   " });
  const author = { name: "Rémi de Juvigny", image: "/avatar.png" };
  const createdAt = 1_700_000_000_000;
  previewCommentsStore.send({ type: "postComment", id: "empty", author, createdAt });
  assert.equal(previewCommentsStore.getSnapshot().context.comments.length, 0);
  previewCommentsStore.send({ type: "setMessage", message: "  Shorten this title  " });
  previewCommentsStore.send({ type: "postComment", id: "comment-1", author, createdAt });
  assert.deepEqual(previewCommentsStore.getSnapshot().context.comments, [
    {
      id: "comment-1",
      pageId: 3,
      target,
      message: "Shorten this title",
      author,
      createdAt,
    },
  ]);
  assert.equal(previewCommentsStore.getSnapshot().context.draft, null);
  previewCommentsStore.send({ type: "startComment", pageId: 3, target });
  assert.equal(previewCommentsStore.getSnapshot().context.focusTarget, null);
  previewCommentsStore.send({ type: "cancelDraft" });

  const { fieldTypesDictionary } = await import("../../core/lib/fieldTypes");
  for (const fieldType of Object.keys(fieldTypesDictionary) as Array<
    keyof typeof fieldTypesDictionary
  >) {
    assert.equal(fieldTypesDictionary[fieldType].hasOwnView, true);
    revealCommentTarget({ ...target, itemId: undefined, fieldType });
    assert.deepEqual(previewStore.getSnapshot().context.selection, {
      type: "block-field",
      blockId: 7,
      fieldName: "title",
      fieldType,
    });
    previewStore.send({ type: "selectParent" });
    assert.deepEqual(previewStore.getSnapshot().context.selection, { type: "block", blockId: 7 });
  }

  revealCommentTarget({ ...target, itemId: undefined, fieldName: undefined });
  assert.deepEqual(previewStore.getSnapshot().context.selection, { type: "block", blockId: 7 });
  previewStore.send({ type: "exitEditMode" });
});

void test("comment pointing uses native overlay attributes and suppresses unrelated hover/focus", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { useOverlayState } = await import("../../core/hooks/useOverlayState");
  const { previewStore } = await import("./previewStore");
  function Overlay({ target }: { target: string }) {
    return createElement("div", useOverlayState(target, true, true));
  }
  const render = (target: string) => renderToStaticMarkup(createElement(Overlay, { target }));
  previewStore.send({ type: "enterEditMode" });
  assert.match(render("field:7__title"), /data-camox-hovered="true"/);
  assert.match(render("field:7__title"), /data-camox-focused="true"/);

  previewStore.send({ type: "setCommentMode", enabled: true });
  previewStore.send({ type: "hoverCommentTarget", target: "field:7__title" });
  assert.match(render("field:7__title"), /data-camox-hovered="true"/);
  assert.doesNotMatch(render("field:7__title"), /data-camox-focused/);
  assert.equal(render("block:7"), "<div></div>");
  assert.equal(render("item:12"), "<div></div>");

  previewStore.send({ type: "hoverCommentTarget", target: "block:7" });
  assert.match(render("block:7"), /data-camox-hovered="true"/);
  assert.equal(render("field:7__title"), "<div></div>");
  previewStore.send({ type: "hoverCommentTarget", target: null });
  assert.equal(render("block:7"), "<div></div>");

  previewStore.send({ type: "setCommentMode", enabled: false });
  assert.equal(previewStore.getSnapshot().context.commentHoverTarget, null);
  assert.match(render("field:7__title"), /data-camox-focused="true"/);
  previewStore.send({ type: "hoverCommentTarget", target: "block:7" });
  assert.equal(previewStore.getSnapshot().context.commentHoverTarget, null);
  previewStore.send({ type: "exitEditMode" });
});

void test("preview modes have only valid edit/source combinations across every transition", async () => {
  const { previewStore, selectIsEditMode, selectPreviewSource } = await import("./previewStore");
  const modes: PreviewMode[] = ["editing-draft", "previewing-draft", "previewing-live"];
  const transitions = [
    { type: "enterEditMode", expected: ["editing-draft", "editing-draft", "editing-draft"] },
    { type: "exitEditMode", expected: ["previewing-draft", "previewing-draft", "previewing-live"] },
    { type: "viewLivePage", expected: ["previewing-live", "previewing-live", "previewing-live"] },
    { type: "viewDraftPage", expected: ["editing-draft", "previewing-draft", "previewing-draft"] },
  ] as const;

  assert.equal(previewStore.getSnapshot().context.mode, "previewing-draft");

  for (const [index, mode] of modes.entries()) {
    for (const { type, expected } of transitions) {
      previewStore.send({ type: "enterEditMode" });
      if (mode === "previewing-draft") previewStore.send({ type: "exitEditMode" });
      if (mode === "previewing-live") previewStore.send({ type: "viewLivePage" });

      previewStore.send({ type });
      const snapshot = previewStore.getSnapshot();
      assert.equal(snapshot.context.mode, expected[index], `${mode} → ${type}`);
      assert.equal(selectIsEditMode(snapshot), snapshot.context.mode === "editing-draft");
      assert.equal(
        selectPreviewSource(snapshot),
        snapshot.context.mode === "previewing-live" ? "live" : "draft",
      );
      assert.equal(selectIsEditMode(snapshot) && selectPreviewSource(snapshot) === "live", false);
      if (type === "viewLivePage") assert.equal(snapshot.context.isToolbarHidden, true);
      if (type === "enterEditMode" || type === "viewDraftPage") {
        assert.equal(snapshot.context.isToolbarHidden, false);
      }
    }
  }
});
