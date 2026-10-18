import { Button } from "@camox/ui/button";
import { Skeleton } from "@camox/ui/skeleton";
import { toast } from "@camox/ui/toaster";
import * as Tooltip from "@camox/ui/tooltip";
import { Minimize } from "lucide-react";
import type * as React from "react";

import { formatShortcut } from "@/lib/utils";

import { PAGE_NICKNAME_MAX_LENGTH } from "../../preview/components/PageNicknameField";
import { SHOW_WHOLE_CANVAS_SHORTCUT } from "../../preview/previewConstants";

/*
 * The Canvas Inspector: the Canvas sidebar's view of a selected Canvas item. Each kind of item
 * composes these pieces: a header with a button back to the whole Canvas and the item's name,
 * then a body with the item's own content.
 */

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

const HEADER_CLASS_NAME = "border-border flex min-w-0 items-center gap-2.5 border-b p-2";

/** The item's name, beside a button that leaves the selection and zooms out to the whole Canvas. */
export function CanvasInspectorHeader({
  onBack,
  children,
}: {
  onBack: () => void;
  /** The item's name: a `CanvasInspectorTitle`, or a `CanvasInspectorNicknameTitle`. */
  children: React.ReactNode;
}) {
  return (
    <header className={HEADER_CLASS_NAME}>
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
      {children}
    </header>
  );
}

/** Stands in for the header while the item loads, in its layout, so nothing shifts. */
export function CanvasInspectorHeaderSkeleton() {
  return (
    <header className={HEADER_CLASS_NAME}>
      <Skeleton className="size-8" />
      <Skeleton className="h-4 w-28" />
    </header>
  );
}

export function CanvasInspectorTitle({ children }: { children: string }) {
  return <h2 className="truncate text-sm font-medium">{children}</h2>;
}

/** A curated page's nickname as the title, which can be renamed in place. */
export function CanvasInspectorNicknameTitle({
  nickname,
  onRename,
}: {
  nickname: string;
  onRename: (nickname: string) => Promise<void>;
}) {
  return (
    <h2 className="flex min-w-0 flex-1">
      <PageNicknameInput nickname={nickname} onRename={onRename} />
    </h2>
  );
}

export function CanvasInspectorBody({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col">{children}</div>;
}
