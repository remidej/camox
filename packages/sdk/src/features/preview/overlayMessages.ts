import type { Selection } from "./previewStore";

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
      afterPosition?: string | null;
    }
  // Text selection (Iframe → Parent)
  | {
      type: "CAMOX_TEXT_SELECTION_STATE";
      hasSelection: boolean;
      activeFormats: number;
      linkTarget: string | null;
      selectedText: string;
    }
  | { type: "CAMOX_OPEN_TEXT_LINK_POPOVER"; target: string; text: string }
  // Text formatting (Parent → Iframe)
  | { type: "CAMOX_FORMAT_TEXT"; formatKey: string }
  | { type: "CAMOX_TOGGLE_TEXT_LINK"; target: string | null; text?: string };

/** Use the same preview targets for selection-path hover as the sidebar editors. */
export function selectionHoverMessage(selection: Selection, hovered: boolean): OverlayMessage {
  const blockId = String(selection.blockId);
  if (selection.type === "block") {
    return { type: hovered ? "CAMOX_HOVER_BLOCK" : "CAMOX_HOVER_BLOCK_END", blockId };
  }
  if (selection.type === "item") {
    return {
      type: hovered ? "CAMOX_HOVER_REPEATER_ITEM" : "CAMOX_HOVER_REPEATER_ITEM_END",
      blockId,
      itemId: String(selection.itemId),
    };
  }
  if (selection.fieldType === "Repeater") {
    return {
      type: hovered ? "CAMOX_HOVER_REPEATER" : "CAMOX_HOVER_REPEATER_END",
      blockId,
      fieldName: selection.fieldName,
    };
  }
  const fieldId =
    selection.type === "item-field"
      ? `${blockId}__${selection.itemId}__${selection.fieldName}`
      : `${blockId}__${selection.fieldName}`;
  return { type: hovered ? "CAMOX_HOVER_FIELD" : "CAMOX_HOVER_FIELD_END", fieldId };
}

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
