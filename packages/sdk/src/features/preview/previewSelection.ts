import { useSelector } from "@xstate/store-react";
import { createContext, useCallback, useContext } from "react";

import {
  previewStore,
  selectIsCanvasShown,
  selectionForOwner,
  type EditingOwner,
  type Selection,
} from "./previewStore";

export const PreviewEditingOwnerContext = createContext<EditingOwner | null>(null);

export function usePreviewTargetSelection() {
  const owner = useContext(PreviewEditingOwnerContext);
  return useSelector(previewStore, (state) => selectionForOwner(state.context, owner));
}

export function selectPreviewTarget(selection: Selection | null, owner: EditingOwner | null) {
  if (!selectIsCanvasShown(previewStore.getSnapshot())) return;
  if (owner === null) return;
  if (selection?.type === "block") {
    previewStore.send({ type: "setFocusedBlock", ...owner, blockId: selection.blockId });
    return;
  }
  previewStore.send({ type: "selectTarget", ...owner, selection });
}

export function usePreviewSelection() {
  const owner = useContext(PreviewEditingOwnerContext);
  return useCallback((selection: Selection) => selectPreviewTarget(selection, owner), [owner]);
}
