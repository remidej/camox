import { useSelector } from "@xstate/store-react";
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
  selectionForOwner,
  type EditingOwner,
  type Selection,
} from "./previewStore";

export const PreviewEditingOwnerContext = createContext<EditingOwner | null>(null);

export function usePreviewTargetSelection() {
  const owner = useContext(PreviewEditingOwnerContext);
  return useSelector(previewStore, (state) => selectionForOwner(state.context, owner));
}

export type SelectionEvent = {
  currentTarget: Element;
  preventDefault(): void;
  stopPropagation(): void;
};

function commentTarget(selection: Selection | null): CommentTarget {
  if (!selection) return { kind: "page" };
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
  selection: Selection | null,
  owner: EditingOwner | null,
  event?: SelectionEvent,
) {
  const snapshot = previewStore.getSnapshot();
  if (!selectIsEditMode(snapshot)) return;
  if (!selectIsCommentMode(snapshot)) {
    if (owner === null) return;
    if (selection?.type === "block") {
      previewStore.send({ type: "setFocusedBlock", ...owner, blockId: selection.blockId });
      return;
    }
    previewStore.send({ type: "selectTarget", ...owner, selection });
    return;
  }

  // Focus alone must not place a comment or start inline editing.
  if (!event) return;
  event.preventDefault();
  event.stopPropagation();
  if (owner?.kind !== "page") return;
  const { pageId } = owner;
  const target = commentTarget(selection);
  previewCommentsStore.send({
    type: "startComment",
    pageId,
    target,
    focusComposer: true,
    popover: true,
    anchor: event.currentTarget,
  });
  revealCommentTarget(
    pageId,
    target,
    selection && "fieldType" in selection ? selection.fieldType : undefined,
  );
}

export function usePreviewSelection() {
  const owner = useContext(PreviewEditingOwnerContext);
  return useCallback(
    (selection: Selection, event?: SelectionEvent) => selectPreviewTarget(selection, owner, event),
    [owner],
  );
}
