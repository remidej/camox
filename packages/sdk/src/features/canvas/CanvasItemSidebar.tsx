import { Button } from "@camox/ui/button";
import { toast } from "@camox/ui/toaster";
import * as Tooltip from "@camox/ui/tooltip";
import { Minimize } from "lucide-react";
import type * as React from "react";

import { formatShortcut } from "@/lib/utils";

import { PAGE_NICKNAME_MAX_LENGTH } from "../preview/components/PageNicknameField";
import { CMS_SIDEBAR_WIDTH, SHOW_WHOLE_CANVAS_SHORTCUT } from "../preview/previewConstants";

/**
 * A page nickname that reads as the header's title, and shows it can be edited on hover.
 * Its border and padding are always there, transparent until hovered or focused, so they
 * never move the text. Saves on Enter or blur; Escape puts the nickname back.
 */
function PageNicknameInput({
  nickname,
  onRename,
}: {
  nickname: string;
  onRename: (nickname: string) => Promise<void>;
}) {
  const save = async (input: HTMLInputElement) => {
    const next = input.value.trim();
    if (next === nickname) return;
    if (!next) {
      toast.error("Page nickname is required");
      input.value = nickname;
      return;
    }
    try {
      await onRename(next);
    } catch {
      toast.error("Could not update page");
      input.value = nickname;
    }
  };
  return (
    <input
      // A new nickname, from here or elsewhere, resets what's typed.
      key={nickname}
      aria-label="Page nickname"
      defaultValue={nickname}
      title={nickname}
      maxLength={PAGE_NICKNAME_MAX_LENGTH}
      className="hover:border-input focus-visible:border-ring focus-visible:ring-ring/50 -mx-1.5 h-8 w-full min-w-0 truncate rounded-md border border-transparent bg-transparent px-1.5 text-sm font-medium transition-[color,box-shadow,border-color] outline-none hover:shadow-xs focus-visible:ring-3"
      onBlur={(event) => void save(event.currentTarget)}
      onKeyDown={(event) => {
        // Typing here never reaches the Canvas's shortcuts.
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.currentTarget.value = nickname;
          event.currentTarget.blur();
        }
      }}
    />
  );
}

/**
 * The Canvas sidebar's view of a selected Canvas item: its name (a Page's can be renamed), beside a button that leaves
 * the selection and zooms out to the whole Canvas, then the item's content.
 */
export function CanvasItemSidebar({
  title,
  onBack,
  onRename,
  children,
}: {
  title: string;
  onBack: () => void;
  /** Makes the title an editable page nickname. */
  onRename?: (nickname: string) => Promise<void>;
  children: React.ReactNode;
}) {
  return (
    <aside
      aria-label={title}
      data-canvas-item-sidebar
      className="bg-background relative flex shrink-0 flex-col border-r-2"
      style={{ width: CMS_SIDEBAR_WIDTH }}
    >
      <header className="border-border flex min-w-0 items-center gap-2.5 border-b p-2">
        <Tooltip.Tooltip>
          <Tooltip.TooltipTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label="Show whole canvas"
                onClick={onBack}
              />
            }
          >
            <Minimize className="text-muted-foreground" />
          </Tooltip.TooltipTrigger>
          <Tooltip.TooltipContent side="bottom">
            Show whole canvas {formatShortcut(SHOW_WHOLE_CANVAS_SHORTCUT)}
          </Tooltip.TooltipContent>
        </Tooltip.Tooltip>
        {onRename ? (
          <h2 className="flex min-w-0 flex-1">
            <PageNicknameInput nickname={title} onRename={onRename} />
          </h2>
        ) : (
          <h2 className="truncate text-sm font-medium">{title}</h2>
        )}
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </aside>
  );
}
