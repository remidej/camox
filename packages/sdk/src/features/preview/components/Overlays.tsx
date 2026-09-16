import { useSelector } from "@xstate/store-react";
import * as React from "react";

import { usePageBlocks } from "@/lib/normalized-data";

import { usePreviewedPage } from "../CamoxPreview";
import { isOverlayMessage, type OverlayMessage } from "../overlayMessages";
import { previewStore, selectIsEditMode } from "../previewStore";

interface OverlaysProps {
  iframeElement: HTMLIFrameElement | null;
  canAddBlocks?: boolean;
}

function CuratedAddBlockListener() {
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
        if (!selectIsEditMode(previewStore.getSnapshot())) return;

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
          type: "openAddBlockSidebar",
          afterPosition,
          via: "overlay",
        });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [pageBlocks]);
  return null;
}

export const Overlays = ({ iframeElement, canAddBlocks = false }: OverlaysProps) => {
  const isPageEditorSidebarOpen = useSelector(
    previewStore,
    (state) => state.context.isPageEditorSidebarOpen,
  );
  const selection = useSelector(previewStore, (state) => state.context.selection);
  const peekedBlock = useSelector(previewStore, (state) => state.context.peekedBlock);

  // Send focus command to iframe when selection changes externally
  React.useEffect(() => {
    if (isPageEditorSidebarOpen) return;
    if (peekedBlock) return;
    if (!selection) return;

    // Only focus String fields in the iframe
    if (selection.type !== "block-field" && selection.type !== "item-field") return;
    if (selection.fieldType !== "String") return;

    // Build the field ID
    const blockId = selection.blockId;
    const fieldName = selection.fieldName;
    const fieldId =
      selection.type === "item-field"
        ? `${blockId}__${selection.itemId}__${fieldName}`
        : `${blockId}__${fieldName}`;

    // Send focus command to iframe
    const message: OverlayMessage = {
      type: "CAMOX_FOCUS_FIELD",
      fieldId,
    };
    iframeElement?.contentWindow?.postMessage(message, "*");
  }, [selection, isPageEditorSidebarOpen, peekedBlock, iframeElement]);

  return canAddBlocks ? <CuratedAddBlockListener /> : null;
};
