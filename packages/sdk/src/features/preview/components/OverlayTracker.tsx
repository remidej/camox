import * as React from "react";

import { isOverlayMessage } from "../overlayMessages";
import { useFrame } from "./Frame";

/**
 * OverlayTracker runs inside the iframe and handles:
 * Listening for focus commands from parent (for sidebar-triggered focus)
 */
export const OverlayTracker = () => {
  const { window: iframeWindow } = useFrame();

  // Listen for focus commands from parent
  React.useEffect(() => {
    if (!iframeWindow) return;

    const handleMessage = (event: MessageEvent) => {
      if (!isOverlayMessage(event.data)) return;

      const { type } = event.data;

      if (type === "CAMOX_FOCUS_FIELD") {
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
  }, [iframeWindow]);

  return null;
};
