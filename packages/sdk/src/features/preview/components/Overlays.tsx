import { useSelector } from "@xstate/store-react";
import * as React from "react";

import { usePageBlocks } from "@/lib/normalized-data";

import { usePreviewedPage } from "../CamoxPreview";
import { useEditingFrame, type EditingFrameElement } from "../editingFrame";
import { isOverlayMessage, overlayFieldId, recordFieldId } from "../overlayMessages";
import {
  previewStore,
  selectIsCanvasShown,
  selectionForOwner,
  type EditingOwner,
  type Selection,
} from "../previewStore";

interface OverlaysProps {
  owner: EditingOwner | null;
  /** The frame showing the Page these overlays edit. */
  frame: EditingFrameElement | null;
  canAddBlocks?: boolean;
}

function CuratedAddBlockListener({ frame }: { frame: EditingFrameElement | null }) {
  const page = usePreviewedPage();
  const { pageBlocks } = usePageBlocks(page);
  // Canvas mounts one listener per page; only the editing frame's may answer.
  const { document: editingDocument } = useEditingFrame();
  const isEditingFrame = !!editingDocument && editingDocument === frame?.contentDocument;

  // Listen for messages from the page
  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!isOverlayMessage(event.data)) return;

      const message = event.data;

      // Handle add block request from the page
      if (message.type === "CAMOX_ADD_BLOCK_REQUEST") {
        // Ignore stale page messages after hiding the Canvas.
        const snapshot = previewStore.getSnapshot();
        if (!selectIsCanvasShown(snapshot)) return;
        if (!isEditingFrame) return;
        const owner = snapshot.context.editingContext;
        if (owner?.kind !== "page" || owner.pageId !== page.page.id) return;

        const { blockPosition, insertPosition } = message;

        let afterPosition: string | null = null;
        if (message.afterPosition !== undefined) {
          afterPosition = message.afterPosition;
        } else if (insertPosition === "after") {
          afterPosition = blockPosition;
        } else {
          // Insert before: find the previous block's position
          const blockIndex = pageBlocks.findIndex((b) => b.position === blockPosition);
          if (blockIndex > 0) {
            afterPosition = pageBlocks[blockIndex - 1].position ?? null;
          } else if (blockIndex === 0) {
            afterPosition = "";
          }
        }

        previewStore.send({
          type: "openAddBlockDialog",
          afterPosition,
        });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [pageBlocks, page.page.id, isEditingFrame]);
  return null;
}

/** The field ID of a selected String field; only those are focused in the page. */
function stringFieldId(selection: Selection | null): string | null {
  if (!selection) return null;
  switch (selection.type) {
    case "block-field":
      return selection.fieldType === "String"
        ? overlayFieldId(selection.blockId, selection.fieldName)
        : null;
    case "item-field":
      return selection.fieldType === "String"
        ? overlayFieldId(selection.blockId, selection.fieldName, { itemId: selection.itemId })
        : null;
    case "record-field":
      return selection.recordFieldType === "String"
        ? recordFieldId(selection, selection.recordFieldName)
        : null;
    default:
      return null;
  }
}

export const Overlays = ({ frame, canAddBlocks = false, owner }: OverlaysProps) => {
  const selection = useSelector(previewStore, (state) => selectionForOwner(state.context, owner));
  const { document: editingDocument, send } = useEditingFrame();
  const isEditingFrame = !!editingDocument && editingDocument === frame?.contentDocument;

  // Focus a field in the page when the Studio selects it, if the page is being edited.
  React.useEffect(() => {
    const fieldId = stringFieldId(selection);
    if (!fieldId || !isEditingFrame) return;
    send({ type: "CAMOX_FOCUS_FIELD", fieldId });
  }, [selection, isEditingFrame, send]);

  return canAddBlocks ? <CuratedAddBlockListener frame={frame} /> : null;
};
