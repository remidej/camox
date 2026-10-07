import { useSelector } from "@xstate/store-react";
import * as React from "react";

import { usePageBlocks } from "@/lib/normalized-data";

import { usePreviewedPage } from "../CamoxPreview";
import { isOverlayMessage, overlayFieldId, type OverlayMessage } from "../overlayMessages";
import {
  previewStore,
  selectIsEditMode,
  selectionForOwner,
  type EditingOwner,
  type Selection,
} from "../previewStore";

interface OverlaysProps {
  owner: EditingOwner | null;
  iframeElement: HTMLIFrameElement | null;
  canAddBlocks?: boolean;
}

function CuratedAddBlockListener({ iframeElement }: { iframeElement: HTMLIFrameElement | null }) {
  const page = usePreviewedPage();
  const { pageBlocks } = usePageBlocks(page);

  // Listen for messages from iframe
  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!isOverlayMessage(event.data)) return;

      const message = event.data;

      // Handle add block request from iframe
      if (message.type === "CAMOX_ADD_BLOCK_REQUEST") {
        // Ignore stale iframe messages after leaving edit mode.
        const snapshot = previewStore.getSnapshot();
        if (!selectIsEditMode(snapshot)) return;
        // Canvas mounts one listener per page. Only the active frame may
        // resolve insertion positions and open the shared picker.
        if (!iframeElement || snapshot.context.iframeElement !== iframeElement) return;
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
  }, [pageBlocks, page.page.id, iframeElement]);
  return null;
}

/** The iframe field ID of a selected String field; only those are focused in the iframe. */
function stringFieldId(selection: Selection | null): string | null {
  if (!selection) return null;
  const { blockId } = selection;
  switch (selection.type) {
    case "block-field":
      return selection.fieldType === "String" ? overlayFieldId(blockId, selection.fieldName) : null;
    case "item-field":
      return selection.fieldType === "String"
        ? overlayFieldId(blockId, selection.fieldName, { itemId: selection.itemId })
        : null;
    case "record-field":
      return selection.recordFieldType === "String"
        ? overlayFieldId(blockId, selection.recordFieldName, { placement: selection })
        : null;
    default:
      return null;
  }
}

export const Overlays = ({ iframeElement, canAddBlocks = false, owner }: OverlaysProps) => {
  const selection = useSelector(previewStore, (state) => selectionForOwner(state.context, owner));

  // Send focus command to iframe when selection changes externally
  React.useEffect(() => {
    const fieldId = stringFieldId(selection);
    if (!fieldId) return;

    // Send focus command to iframe
    const message: OverlayMessage = {
      type: "CAMOX_FOCUS_FIELD",
      fieldId,
    };
    iframeElement?.contentWindow?.postMessage(message, "*");
  }, [selection, iframeElement]);

  return canAddBlocks ? <CuratedAddBlockListener iframeElement={iframeElement} /> : null;
};
