import { createContext, useCallback, useContext } from "react";

import { previewCommentsStore, revealCommentTarget } from "./previewCommentsStore";
import {
  previewStore,
  selectIsCommentMode,
  selectIsEditMode,
  type Selection,
} from "./previewStore";

export const PreviewPageContext = createContext<number | null>(null);

export type SelectionEvent = {
  currentTarget: Element;
  clientX?: number;
  clientY?: number;
  preventDefault(): void;
  stopPropagation(): void;
};

/** Both editing and commenting use the target already known by the editable component. */
export function selectPreviewTarget(
  selection: Selection,
  pageId: number | null,
  event?: SelectionEvent,
) {
  const snapshot = previewStore.getSnapshot();
  if (!selectIsEditMode(snapshot)) return;
  if (!selectIsCommentMode(snapshot)) {
    if (selection.type === "block") {
      previewStore.send({ type: "setFocusedBlock", blockId: selection.blockId });
      return;
    }
    previewStore.send({ type: "setSelection", selection });
    return;
  }

  // Focus alone must not place a comment or start inline editing.
  if (!event) return;
  event.preventDefault();
  event.stopPropagation();
  if (pageId === null) return;
  const element = event.currentTarget;
  const rect = element.getBoundingClientRect();
  const field = selection.type === "block-field" || selection.type === "item-field";
  const itemId = "itemId" in selection ? selection.itemId : undefined;
  const attribute = field
    ? "data-camox-field-id"
    : selection.type === "item"
      ? "data-camox-repeater-item-id"
      : element.hasAttribute("data-camox-comment-block-id")
        ? "data-camox-comment-block-id"
        : "data-camox-block-id";
  const id = field
    ? [selection.blockId, itemId, selection.fieldName].filter((part) => part != null).join("__")
    : String(itemId ?? selection.blockId);
  const target = {
    blockId: selection.blockId,
    itemId,
    fieldName: field ? selection.fieldName : undefined,
    fieldType: field ? selection.fieldType : undefined,
    selector: `[${attribute}="${CSS.escape(id)}"]`,
    label: field
      ? `Field · ${selection.fieldName}`
      : `${selection.type === "item" ? "Item" : "Block"} · ${id}`,
    x:
      event.clientX == null
        ? 0.5
        : Math.max(0, Math.min(1, (event.clientX - rect.left) / (rect.width || 1))),
    y:
      event.clientY == null
        ? 0.5
        : Math.max(0, Math.min(1, (event.clientY - rect.top) / (rect.height || 1))),
  };
  previewCommentsStore.send({ type: "startComment", pageId, target, focusComposer: true });
  revealCommentTarget(target);
}

export function usePreviewSelection() {
  const pageId = useContext(PreviewPageContext);
  return useCallback(
    (selection: Selection, event?: SelectionEvent) => selectPreviewTarget(selection, pageId, event),
    [pageId],
  );
}
