import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@camox/ui/popover";
import { toast } from "@camox/ui/toaster";
import { useSelector } from "@xstate/store-react";
import * as React from "react";

import { COMMENT_CURSOR } from "../preview/commentCursor";
import { PAGE_NICKNAME_MAX_LENGTH } from "../preview/components/PageNicknameField";
import { selectPreviewTarget } from "../preview/previewSelection";
import { previewStore, selectIsCommentMode } from "../preview/previewStore";
import type { CanvasPage } from "./canvasPages";
import { TemplateInstanceInput } from "./TemplateInstanceInput";

export function CanvasPageHeader({
  page,
  pathname,
  selected,
  onSelect,
  onHoverChange,
  onChange,
  onRename,
  comments,
}: {
  page: CanvasPage;
  pathname: string | null;
  selected: boolean;
  onSelect: (commenting: boolean) => void;
  onHoverChange?: (hovered: boolean) => void;
  onChange: (pathname: string) => void;
  onRename?: (nickname: string) => Promise<void>;
  comments?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const finishing = React.useRef(false);
  const focusInput = React.useCallback((input: HTMLInputElement | null) => {
    input?.focus();
    input?.select();
  }, []);
  const save = async () => {
    if (finishing.current || draft === null || !onRename) return;
    const nickname = draft.trim();
    if (!nickname) {
      toast.error("Page nickname is required");
      return;
    }
    finishing.current = true;
    if (nickname === page.title) {
      setDraft(null);
      return;
    }
    setSaving(true);
    try {
      await onRename(nickname);
      setDraft(null);
    } catch {
      finishing.current = false;
      toast.error("Could not update page");
    } finally {
      setSaving(false);
    }
  };
  const isCommentMode = useSelector(previewStore, selectIsCommentMode);
  const path = pathname ?? page.pattern;
  const pathClassName =
    "text-muted-foreground w-full min-w-0 truncate text-left text-xs font-normal";
  const focusClassName = "focus-visible:ring-ring outline-none focus-visible:ring-2";
  const name =
    draft !== null ? (
      <input
        aria-label="Page nickname"
        className={`bg-background min-w-0 flex-1 rounded px-1 text-sm font-medium ${focusClassName}`}
        value={draft}
        maxLength={PAGE_NICKNAME_MAX_LENGTH}
        readOnly={saving}
        ref={focusInput}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            void save();
          }
          if (event.key === "Escape" && !saving) {
            finishing.current = true;
            setDraft(null);
          }
        }}
      />
    ) : (
      <button
        type="button"
        className={`min-w-0 truncate text-left text-sm font-medium ${focusClassName}`}
        style={{ cursor: isCommentMode ? COMMENT_CURSOR : undefined }}
        title={page.title}
        aria-pressed={selected}
        disabled={!pathname}
        onDoubleClick={() => {
          if (!onRename || isCommentMode) return;
          finishing.current = false;
          setDraft(page.title);
        }}
        onClick={(event) => {
          const commenting = isCommentMode && page.pageId != null;
          if (commenting) {
            selectPreviewTarget(null, { kind: "page", pageId: page.pageId! }, event);
          }
          onSelect(commenting);
        }}
        onMouseEnter={() => onHoverChange?.(true)}
        onMouseLeave={() => onHoverChange?.(false)}
      >
        {page.title}
      </button>
    );
  const nameAndComments = (
    <span className="flex w-full min-w-0 items-center gap-3">
      {name}
      {comments}
    </span>
  );
  const headerClassName =
    "text-foreground flex h-10 w-full min-w-0 flex-col items-start justify-center gap-1 text-left";
  if (!page.templateId)
    return (
      <h2 className={headerClassName}>
        <span data-canvas-path className={pathClassName} title={path}>
          {path}
        </span>
        {nameAndComments}
      </h2>
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <h2 className={headerClassName}>
        <PopoverTrigger
          data-canvas-path
          aria-label={`Edit instance path for ${page.title}`}
          className={`${pathClassName} ${focusClassName}`}
          title={path}
        >
          {path}
        </PopoverTrigger>
        {nameAndComments}
      </h2>
      <PopoverContent className="w-96 max-w-[calc(100vw-2rem)]" align="start">
        <PopoverTitle>Preview {page.title}</PopoverTitle>
        <TemplateInstanceInput
          page={page}
          pathname={pathname}
          onChange={(path) => {
            onChange(path);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
