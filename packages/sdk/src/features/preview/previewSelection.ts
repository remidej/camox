import { createContext, useCallback, useContext } from "react";

import {
  previewCommentsStore,
  revealCommentTarget,
  type CommentTarget,
} from "./previewCommentsStore";
import {
  previewStore,
  selectIsCommentMode,
  selectIsEditMode,
  type Selection,
} from "./previewStore";

export const PreviewPageContext = createContext<number | null>(null);

export type SelectionEvent = {
  currentTarget: Element;
  preventDefault(): void;
  stopPropagation(): void;
};

function commentTarget(selection: Selection): CommentTarget {
  switch (selection.type) {
    case "block":
      return { kind: "block", blockId: selection.blockId };
    case "item":
      return { kind: "item", blockId: selection.blockId, itemId: selection.itemId };
    case "block-field":
      return { kind: "block-field", blockId: selection.blockId, fieldName: selection.fieldName };
    case "item-field":
      return {
        kind: "item-field",
        blockId: selection.blockId,
        itemId: selection.itemId,
        fieldName: selection.fieldName,
      };
  }
}

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
  const target = commentTarget(selection);
  previewCommentsStore.send({ type: "startComment", pageId, target, focusComposer: true });
  revealCommentTarget(target, "fieldType" in selection ? selection.fieldType : undefined);
}

export function usePreviewSelection() {
  const pageId = useContext(PreviewPageContext);
  return useCallback(
    (selection: Selection, event?: SelectionEvent) => selectPreviewTarget(selection, pageId, event),
    [pageId],
  );
}
