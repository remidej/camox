import { Button } from "@camox/ui/button";
import { ButtonGroup } from "@camox/ui/button-group";
import { FloatingToolbar } from "@camox/ui/floating-toolbar";
import { Kbd } from "@camox/ui/kbd";
import { Toggle } from "@camox/ui/toggle";
import * as Tooltip from "@camox/ui/tooltip";
import { useSelector } from "@xstate/store-react";
import { Bold, Italic, Strikethrough, Highlighter } from "lucide-react";
import * as React from "react";

import { TextLinkPopover } from "@/core/components/lexical/TextLinkPopover";

import { FORMAT_FLAGS } from "../../../core/lib/modifierFormats";
import type { OverlayMessage } from "../overlayMessages";
import { isOverlayMessage } from "../overlayMessages";
import { previewStore } from "../previewStore";

const FORMAT_BUTTONS = [
  { key: "bold", flag: FORMAT_FLAGS.bold, icon: Bold, label: "Bold", shortcut: "⌘ B" },
  { key: "italic", flag: FORMAT_FLAGS.italic, icon: Italic, label: "Italic", shortcut: "⌘ I" },
  {
    key: "strikethrough",
    flag: FORMAT_FLAGS.strikethrough,
    icon: Strikethrough,
    label: "Strikethrough",
    shortcut: null,
  },
  {
    key: "highlight",
    flag: FORMAT_FLAGS.highlight,
    icon: Highlighter,
    label: "Highlight",
    shortcut: null,
  },
] as const;

export const FieldToolbar = ({ document }: { document: Document }) => {
  const iframeElement = useSelector(previewStore, (state) => state.context.iframeElement);

  const [hasSelection, setHasSelection] = React.useState(false);
  const [activeFormats, setActiveFormats] = React.useState(0);
  const [linkTarget, setLinkTarget] = React.useState<string | null>(null);
  const [selectedText, setSelectedText] = React.useState("");
  const [linkPopoverOpen, setLinkPopoverOpen] = React.useState(false);
  const linkPopoverOpenRef = React.useRef(false);
  const [anchor, setAnchor] = React.useState<{ top: number; left: number } | null>(null);

  const updateAnchor = React.useCallback(() => {
    if (linkPopoverOpenRef.current) return;
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setHasSelection(false);
      return;
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    setAnchor({ top: rect.top, left: rect.left + rect.width / 2 });
  }, [document]);

  React.useEffect(() => {
    document.addEventListener("selectionchange", updateAnchor);
    document.addEventListener("scroll", updateAnchor, true);
    document.defaultView?.addEventListener("resize", updateAnchor);
    return () => {
      document.removeEventListener("selectionchange", updateAnchor);
      document.removeEventListener("scroll", updateAnchor, true);
      document.defaultView?.removeEventListener("resize", updateAnchor);
    };
  }, [document, updateAnchor]);

  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as OverlayMessage;
      if (!isOverlayMessage(data)) return;

      if (data.type === "CAMOX_TEXT_SELECTION_STATE") {
        updateAnchor();
        setHasSelection(data.hasSelection);
        setActiveFormats(data.activeFormats);
        // Focus moving into the popover must not replace the link being edited.
        if (linkPopoverOpenRef.current) return;
        setLinkTarget(data.linkTarget);
        setSelectedText(data.selectedText);
        return;
      }

      if (data.type === "CAMOX_OPEN_TEXT_LINK_POPOVER") {
        updateAnchor();
        linkPopoverOpenRef.current = true;
        setHasSelection(true);
        setLinkTarget(data.target);
        setSelectedText(data.text);
        setLinkPopoverOpen(true);
      }
    };

    // Multiple previews share the host. Selection state belongs to this frame only.
    const targetWindow = document.defaultView;
    targetWindow?.addEventListener("message", handleMessage);
    return () => targetWindow?.removeEventListener("message", handleMessage);
  }, [document, updateAnchor]);

  const sendFormat = (formatKey: string) => {
    iframeElement?.contentWindow?.postMessage(
      { type: "CAMOX_FORMAT_TEXT", formatKey } satisfies OverlayMessage,
      "*",
    );
  };

  const handleLinkPopoverOpenChange = (open: boolean) => {
    linkPopoverOpenRef.current = open;
    setLinkPopoverOpen(open);
  };

  const sendTextLink = (target: string | null, text?: string) => {
    iframeElement?.contentWindow?.postMessage(
      { type: "CAMOX_TOGGLE_TEXT_LINK", target, text } satisfies OverlayMessage,
      "*",
    );
    handleLinkPopoverOpenChange(false);
  };

  const unlinkText = () => {
    sendTextLink(null);
  };

  const isVisible = anchor && (hasSelection || linkPopoverOpen);

  const handleToolbarMouseDown = (event: React.MouseEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      event.preventDefault();
      return;
    }

    if (target.closest("input, select, textarea, [role='combobox']")) return;

    event.preventDefault();
  };

  if (!isVisible) return null;

  return (
    <FloatingToolbar
      data-canvas-overlay-control
      onMouseDown={handleToolbarMouseDown}
      className="pointer-events-auto gap-2 transition-none"
      style={{
        top: `calc(${anchor.top}px * var(--canvas-zoom, 1) - 8px)`,
        left: `calc(${anchor.left}px * var(--canvas-zoom, 1))`,
        transform: "translateY(-100%)",
      }}
    >
      <ButtonGroup>
        {FORMAT_BUTTONS.map(({ key, flag, icon: Icon, label, shortcut }) => {
          const isActive = !!(activeFormats & flag);
          return (
            <Tooltip.Tooltip key={key}>
              <Tooltip.TooltipTrigger
                render={
                  <Toggle
                    data-state={isActive ? "on" : "off"}
                    pressed={isActive}
                    variant="outline"
                    aria-label={label}
                    onPressedChange={() => sendFormat(key)}
                  />
                }
              >
                <Icon />
              </Tooltip.TooltipTrigger>
              <Tooltip.TooltipContent>
                {label} {shortcut && <Kbd>{shortcut}</Kbd>}
              </Tooltip.TooltipContent>
            </Tooltip.Tooltip>
          );
        })}
        <TextLinkPopover
          open={linkPopoverOpen}
          onOpenChange={handleLinkPopoverOpenChange}
          trigger={<Button variant="outline" size="icon" aria-label="Add link" />}
          text={selectedText}
          target={linkTarget}
          onSave={sendTextLink}
          onUnlink={unlinkText}
        />
      </ButtonGroup>
    </FloatingToolbar>
  );
};
