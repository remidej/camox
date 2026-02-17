import * as React from "react";
import { useSelector } from "@xstate/store/react";
import { useFrame } from "@/components/ui/frame";
import { previewStore } from "../previewStore";
import { isOverlayMessage } from "../overlayMessages";

/**
 * OverlayTracker runs inside the iframe and handles:
 * Listening for focus commands from parent (for sidebar-triggered focus)
 */
export const OverlayTracker = () => {
  const { window: iframeWindow } = useFrame();
  const isPageContentSheetOpen = useSelector(
    previewStore,
    (state) => state.context.isPageContentSheetOpen,
  );
  const isAddBlockSheetOpen = useSelector(
    previewStore,
    (state) => state.context.isAddBlockSheetOpen,
  );

  // Clear peeked block when clicking anywhere in the preview iframe while addBlock sheet is open.
  React.useEffect(() => {
    if (!iframeWindow || !isAddBlockSheetOpen) return;

    const handleClick = () => {
      previewStore.send({ type: "exitPeekedBlock" });
    };

    iframeWindow.document.addEventListener("click", handleClick);
    return () => iframeWindow.document.removeEventListener("click", handleClick);
  }, [iframeWindow, isAddBlockSheetOpen]);

  // Listen for focus commands from parent
  React.useEffect(() => {
    if (!iframeWindow) return;

    const handleMessage = (event: MessageEvent) => {
      if (!isOverlayMessage(event.data)) return;

      const { type } = event.data;

      if (type === "CAMOX_FOCUS_FIELD") {
        if (isPageContentSheetOpen) return;

        const { fieldId } = event.data;
        const element = iframeWindow.document.querySelector(
          `[data-camox-field-id="${fieldId}"]`,
        ) as HTMLElement | null;

        if (element) {
          element.focus();
        }
      }
    };

    // Listen on the iframe's window for messages from parent
    iframeWindow.addEventListener("message", handleMessage);
    return () => iframeWindow.removeEventListener("message", handleMessage);
  }, [iframeWindow, isPageContentSheetOpen]);

  return null;
};
