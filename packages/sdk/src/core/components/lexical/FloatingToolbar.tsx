import * as React from "react";
import { createPortal } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  SELECTION_CHANGE_COMMAND,
  COMMAND_PRIORITY_LOW,
} from "lexical";
import { TEXT_MODIFIERS } from "../../lib/modifiers";

interface FloatingToolbarProps {
  portalContainer: HTMLElement;
  targetWindow: Window;
}

export function FloatingToolbar({
  portalContainer,
  targetWindow,
}: FloatingToolbarProps) {
  const [editor] = useLexicalComposerContext();
  const toolbarRef = React.useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = React.useState(false);
  const [position, setPosition] = React.useState({ top: 0, left: 0 });
  const [activeFormats, setActiveFormats] = React.useState<number>(0);

  const updateToolbar = React.useCallback(() => {
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || selection.isCollapsed()) {
        setIsVisible(false);
        return;
      }

      // Get format bitmask from selection
      let format = 0;
      for (const modifier of Object.values(TEXT_MODIFIERS)) {
        const key = modifier === TEXT_MODIFIERS.bold ? "bold" : "italic";
        if (selection.hasFormat(key as any)) {
          format |= modifier.formatFlag;
        }
      }
      setActiveFormats(format);

      // Position from native selection
      const nativeSelection = targetWindow.getSelection();
      if (!nativeSelection || nativeSelection.rangeCount === 0) {
        setIsVisible(false);
        return;
      }

      const range = nativeSelection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0) {
        setIsVisible(false);
        return;
      }

      setPosition({
        top: rect.top - 40,
        left: rect.left + rect.width / 2,
      });
      setIsVisible(true);
    });
  }, [editor, targetWindow]);

  React.useEffect(() => {
    return editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        updateToolbar();
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor, updateToolbar]);

  // Also update on mouse up to catch drag selections
  React.useEffect(() => {
    const handleMouseUp = () => {
      setTimeout(updateToolbar, 10);
    };
    targetWindow.addEventListener("mouseup", handleMouseUp);
    return () => targetWindow.removeEventListener("mouseup", handleMouseUp);
  }, [targetWindow, updateToolbar]);

  if (!isVisible) return null;

  const modifierEntries = Object.entries(TEXT_MODIFIERS);

  return createPortal(
    <div
      ref={toolbarRef}
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        transform: "translateX(-50%)",
        zIndex: 10000,
        display: "flex",
        gap: "2px",
        padding: "4px",
        borderRadius: "6px",
        background: "rgba(0, 0, 0, 0.85)",
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {modifierEntries.map(([key, modifier]) => {
        const isActive = !!(activeFormats & modifier.formatFlag);
        return (
          <button
            key={key}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              editor.dispatchCommand(FORMAT_TEXT_COMMAND, key as any);
              // Re-check after format
              setTimeout(updateToolbar, 10);
            }}
            style={{
              width: "28px",
              height: "28px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: key === "bold" ? 700 : 400,
              fontStyle: key === "italic" ? "italic" : "normal",
              color: isActive ? "white" : "rgba(255,255,255,0.65)",
              background: isActive
                ? "rgba(255,255,255,0.2)"
                : "transparent",
            }}
          >
            {modifier.icon}
          </button>
        );
      })}
    </div>,
    portalContainer,
  );
}
