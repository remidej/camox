import { $createLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  FORMAT_TEXT_COMMAND,
  type RangeSelection,
} from "lexical";
import * as React from "react";

import type { OverlayMessage } from "../../../features/preview/overlayMessages";
import { isOverlayMessage, postOverlayMessage } from "../../../features/preview/overlayMessages";
import { FORMAT_FLAGS } from "../../lib/modifierFormats";
import { $selectionHasHighlight, $toggleHighlight } from "./HighlightNode";
import { selectTextLink } from "./selectTextLink";

interface SelectionBroadcasterProps {
  targetWindow: Window;
}

function getLinkTargetFromSelection(): string | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;

  let node: any = selection.anchor.getNode();
  while (node) {
    if (node.getType?.() === "link") {
      const url = node.getURL?.();
      return typeof url === "string" ? url : null;
    }
    node = node.getParent?.();
  }

  return null;
}

export function SelectionBroadcaster({ targetWindow }: SelectionBroadcasterProps) {
  const [editor] = useLexicalComposerContext();
  const lastTextSelectionRef = React.useRef<RangeSelection | null>(null);

  const broadcastSelection = React.useCallback(() => {
    // Use the native selection as the source of truth for whether text is selected,
    // since Lexical's internal state can lag behind on mouseup / double-click / triple-click.
    const nativeSelection = targetWindow.getSelection();
    const hasNativeSelection =
      nativeSelection != null && nativeSelection.rangeCount > 0 && !nativeSelection.isCollapsed;

    if (!hasNativeSelection) {
      postOverlayMessage({
        type: "CAMOX_TEXT_SELECTION_STATE",
        hasSelection: false,
        activeFormats: 0,
        linkTarget: null,
        selectedText: "",
      });
      return;
    }

    // Read format flags from Lexical's state
    let format = 0;
    let linkTarget: string | null = null;
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      lastTextSelectionRef.current = selection.clone();
      for (const key of ["bold", "italic", "strikethrough"] as const) {
        if (selection.hasFormat(key)) format |= FORMAT_FLAGS[key];
      }
      if ($selectionHasHighlight()) format |= FORMAT_FLAGS.highlight;
      linkTarget = getLinkTargetFromSelection();
    });

    postOverlayMessage({
      type: "CAMOX_TEXT_SELECTION_STATE",
      hasSelection: true,
      activeFormats: format,
      linkTarget,
      selectedText: nativeSelection?.toString() ?? "",
    });
  }, [editor, targetWindow]);

  // Listen to the native selectionchange event — fires for drag, click,
  // double-click, triple-click, keyboard selection, and programmatic changes.
  React.useEffect(() => {
    const doc = targetWindow.document;
    const handleSelectionChange = () => broadcastSelection();
    doc.addEventListener("selectionchange", handleSelectionChange);
    return () => doc.removeEventListener("selectionchange", handleSelectionChange);
  }, [targetWindow, broadcastSelection]);

  React.useEffect(() => {
    return editor.registerRootListener((root) => {
      if (!root) return;

      const handleLinkClick = (event: MouseEvent) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;

        const anchor = target.closest("a");
        if (!anchor || !root.contains(anchor)) return;

        const href = anchor.dataset.camoxLinkTarget ?? anchor.getAttribute("href");
        if (!href) return;

        event.preventDefault();
        event.stopPropagation();

        const link = selectTextLink(editor, anchor);
        if (!link) return;
        lastTextSelectionRef.current = link.selection;

        broadcastSelection();
        postOverlayMessage({
          type: "CAMOX_OPEN_TEXT_LINK_POPOVER",
          target: link.target,
          text: link.text,
        });
      };

      root.addEventListener("click", handleLinkClick);
      return () => root.removeEventListener("click", handleLinkClick);
    });
  }, [editor, targetWindow, broadcastSelection]);

  // Listen for format commands from CMS side
  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as OverlayMessage;
      if (
        !isOverlayMessage(data) ||
        (data.type !== "CAMOX_FORMAT_TEXT" && data.type !== "CAMOX_TOGGLE_TEXT_LINK")
      ) {
        return;
      }

      // Only the editor that owns the current selection should handle this.
      // Check if the native selection falls within this editor's root element.
      const root = editor.getRootElement();
      const nativeSelection = targetWindow.getSelection();
      if (!root || !nativeSelection || nativeSelection.rangeCount === 0) return;
      if (!root.contains(nativeSelection.anchorNode)) return;

      root.focus();
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection) && !selection.isCollapsed()) {
          lastTextSelectionRef.current = selection.clone();
          return;
        }
        if (lastTextSelectionRef.current) {
          $setSelection(lastTextSelectionRef.current.clone());
        }
      });

      if (data.type === "CAMOX_FORMAT_TEXT") {
        if (data.formatKey === "highlight") editor.update($toggleHighlight);
        else if (
          data.formatKey === "bold" ||
          data.formatKey === "italic" ||
          data.formatKey === "strikethrough"
        )
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, data.formatKey);
      } else if (data.target === null) {
        editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
      } else if (typeof data.text === "string") {
        const target = data.target;
        editor.update(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;
          const linkNode = $createLinkNode(target);
          linkNode.append($createTextNode(data.text));
          selection.insertNodes([linkNode]);
        });
      } else {
        editor.dispatchCommand(TOGGLE_LINK_COMMAND, data.target);
      }
      // Re-broadcast after formatting so toggle state updates
      setTimeout(broadcastSelection, 10);
    };

    targetWindow.addEventListener("message", handleMessage);
    return () => targetWindow.removeEventListener("message", handleMessage);
  }, [editor, targetWindow, broadcastSelection]);

  return null;
}
