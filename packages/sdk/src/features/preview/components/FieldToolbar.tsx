import { Button } from "@camox/ui/button";
import { ButtonGroup } from "@camox/ui/button-group";
import { FloatingToolbar } from "@camox/ui/floating-toolbar";
import { Kbd } from "@camox/ui/kbd";
import { Toggle } from "@camox/ui/toggle";
import * as Tooltip from "@camox/ui/tooltip";
import { useSelector } from "@xstate/store-react";
import { Bold, Italic, Underline, Blend } from "lucide-react";
import * as React from "react";

import { TextLinkPopover } from "@/core/components/lexical/TextLinkPopover";
import { cn } from "@/lib/utils";

import { FORMAT_FLAGS } from "../../../core/lib/modifierFormats";
import type { OverlayMessage } from "../overlayMessages";
import { isOverlayMessage } from "../overlayMessages";
import { previewStore } from "../previewStore";

const FORMAT_BUTTONS = [
  { key: "bold", flag: FORMAT_FLAGS.bold, icon: Bold, label: "Bold", shortcut: "⌘ B" },
  { key: "italic", flag: FORMAT_FLAGS.italic, icon: Italic, label: "Italic", shortcut: "⌘ I" },
  {
    key: "underline",
    flag: FORMAT_FLAGS.underline,
    icon: Underline,
    label: "Underline",
    shortcut: "⌘ U",
  },
  { key: "gradient", flag: FORMAT_FLAGS.gradient, icon: Blend, label: "Gradient", shortcut: null },
] as const;

export const FieldToolbar = () => {
  const iframeElement = useSelector(previewStore, (state) => state.context.iframeElement);

  const [hasSelection, setHasSelection] = React.useState(false);
  const [activeFormats, setActiveFormats] = React.useState(0);
  const [linkTarget, setLinkTarget] = React.useState<string | null>(null);
  const [selectedText, setSelectedText] = React.useState("");
  const [linkPopoverOpen, setLinkPopoverOpen] = React.useState(false);

  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as OverlayMessage;
      if (!isOverlayMessage(data)) return;

      if (data.type === "CAMOX_TEXT_SELECTION_STATE") {
        setHasSelection(data.hasSelection);
        setActiveFormats(data.activeFormats);
        setLinkTarget(data.linkTarget);
        setSelectedText(data.selectedText);
        return;
      }

      if (data.type === "CAMOX_OPEN_TEXT_LINK_POPOVER") {
        setHasSelection(true);
        setLinkTarget(data.target);
        setSelectedText(data.text);
        setLinkPopoverOpen(true);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const sendFormat = (formatKey: string) => {
    iframeElement?.contentWindow?.postMessage(
      { type: "CAMOX_FORMAT_TEXT", formatKey } satisfies OverlayMessage,
      "*",
    );
  };

  const handleLinkPopoverOpenChange = (open: boolean) => {
    setLinkPopoverOpen(open);
  };

  const sendTextLink = (target: string | null, text?: string) => {
    iframeElement?.contentWindow?.postMessage(
      { type: "CAMOX_TOGGLE_TEXT_LINK", target, text } satisfies OverlayMessage,
      "*",
    );
    setLinkPopoverOpen(false);
  };

  const unlinkText = () => {
    sendTextLink(null);
  };

  const isVisible = hasSelection || linkPopoverOpen;

  const handleToolbarMouseDown = (event: React.MouseEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      event.preventDefault();
      return;
    }

    if (target.closest("input, select, textarea, button, [role='combobox']")) return;

    event.preventDefault();
  };

  return (
    <FloatingToolbar
      onMouseDown={handleToolbarMouseDown}
      className={cn(
        "bottom-17 gap-2",
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 pointer-events-none translate-y-2",
      )}
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
