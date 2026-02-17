export interface FieldRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type OverlayMessage =
  // Field messages (Parent → Iframe)
  | { type: "CAMOX_FOCUS_FIELD"; fieldId: string }
  | { type: "CAMOX_FOCUS_FIELD_END"; fieldId: string }
  | { type: "CAMOX_HOVER_FIELD"; fieldId: string }
  | { type: "CAMOX_HOVER_FIELD_END"; fieldId: string }
  // Block messages (Parent → Iframe, for sidebar hover sync)
  | { type: "CAMOX_HOVER_BLOCK"; blockId: string }
  | { type: "CAMOX_HOVER_BLOCK_END"; blockId: string }
  // Repeater container messages (Parent → Iframe)
  | { type: "CAMOX_HOVER_REPEATER"; blockId: string; fieldName: string }
  | { type: "CAMOX_HOVER_REPEATER_END"; blockId: string; fieldName: string }
  // Repeater item messages (Parent → Iframe)
  | { type: "CAMOX_HOVER_REPEATER_ITEM"; blockId: string; itemId: string }
  | { type: "CAMOX_HOVER_REPEATER_ITEM_END"; blockId: string; itemId: string }
  // Block actions (Iframe → Parent)
  | {
      type: "CAMOX_ADD_BLOCK_REQUEST";
      blockPosition: string;
      insertPosition: "before" | "after";
    };

export function isOverlayMessage(data: unknown): data is OverlayMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    typeof (data as { type: unknown }).type === "string" &&
    (data as { type: string }).type.startsWith("CAMOX_")
  );
}

export function postOverlayMessage(message: OverlayMessage) {
  window.parent?.postMessage(message, "*");
}

/**
 * Returns the element's position relative to the document (not viewport).
 * This allows overlays to be positioned correctly regardless of scroll position,
 * by applying scroll offset at the container level instead of per-overlay.
 */
export function getElementRect(element: HTMLElement): FieldRect {
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top + window.scrollY,
    left: rect.left + window.scrollX,
    width: rect.width,
    height: rect.height,
  };
}
