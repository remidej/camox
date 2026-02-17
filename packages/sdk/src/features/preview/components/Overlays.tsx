import * as React from "react";
import { useSelector } from "@xstate/store/react";
import { previewStore } from "../previewStore";
import { isOverlayMessage, type OverlayMessage } from "../overlayMessages";
import { usePreviewedPage } from "../CamoxPreview";

interface OverlaysProps {
  iframeElement: HTMLIFrameElement | null;
}

export const Overlays = ({ iframeElement }: OverlaysProps) => {
  const isPageContentSheetOpen = useSelector(
    previewStore,
    (state) => state.context.isPageContentSheetOpen,
  );
  const selectionBreadcrumbs = useSelector(
    previewStore,
    (state) => state.context.selectionBreadcrumbs,
  );
  const page = usePreviewedPage();

  // Listen for messages from iframe
  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!isOverlayMessage(event.data)) return;

      const message = event.data;

      // Handle add block request from iframe
      if (message.type === "CAMOX_ADD_BLOCK_REQUEST") {
        const { blockPosition, insertPosition } = message;

        let afterPosition: string | null = null;
        if (insertPosition === "after") {
          afterPosition = blockPosition;
        } else {
          // Insert before: find the previous block's position
          const blockIndex = page?.blocks.findIndex(
            (b) => b.position === blockPosition,
          );
          if (blockIndex !== undefined && blockIndex > 0) {
            afterPosition = page?.blocks[blockIndex - 1].position ?? null;
          } else if (blockIndex === 0) {
            afterPosition = "";
          }
        }

        previewStore.send({
          type: "openAddBlockSheet",
          afterPosition,
        });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [page]);

  // Send focus command to iframe when selection changes externally
  React.useEffect(() => {
    if (isPageContentSheetOpen) return;
    if (selectionBreadcrumbs.length === 0) return;

    // Get the last breadcrumb which should be the field
    const fieldBreadcrumb = selectionBreadcrumbs.find(
      (b) => b.type === "String",
    );
    if (!fieldBreadcrumb) return;

    // Build the field ID from breadcrumbs
    const blockBreadcrumb = selectionBreadcrumbs.find(
      (b) => b.type === "Block",
    );
    if (!blockBreadcrumb) return;

    const repeatableItemBreadcrumb = selectionBreadcrumbs.find(
      (b) => b.type === "RepeatableObject",
    );

    const fieldId = repeatableItemBreadcrumb
      ? `${blockBreadcrumb.id}__${repeatableItemBreadcrumb.id}__${fieldBreadcrumb.id}`
      : `${blockBreadcrumb.id}__${fieldBreadcrumb.id}`;

    // Send focus command to iframe
    const message: OverlayMessage = {
      type: "CAMOX_FOCUS_FIELD",
      fieldId,
    };
    iframeElement?.contentWindow?.postMessage(message, "*");
  }, [selectionBreadcrumbs, isPageContentSheetOpen, iframeElement]);

  return null;
};
