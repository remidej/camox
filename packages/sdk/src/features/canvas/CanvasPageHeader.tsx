import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@camox/ui/popover";
import * as React from "react";

import type { CanvasPage } from "./canvasPages";
import { TemplateInstanceInput } from "./TemplateInstanceInput";

export function CanvasPageHeader({
  page,
  pathname,
  selected,
  onSelect,
  onHoverChange,
  onChange,
}: {
  page: CanvasPage;
  pathname: string | null;
  selected: boolean;
  onSelect: () => void;
  onHoverChange?: (hovered: boolean) => void;
  onChange: (pathname: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const path = pathname ?? page.pattern;
  const pathClassName = "text-foreground max-w-1/2 min-w-0 truncate text-right text-xs font-normal";
  const focusClassName = "focus-visible:ring-ring outline-none focus-visible:ring-2";
  const name = (
    <button
      type="button"
      className={`min-w-0 flex-1 truncate text-left text-sm font-medium ${focusClassName}`}
      title={page.title}
      aria-pressed={selected}
      disabled={!pathname}
      onClick={onSelect}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
    >
      {page.title}
    </button>
  );
  const headerClassName = "text-foreground flex h-10 w-full min-w-0 items-center gap-3 text-left";
  if (!page.templateId)
    return (
      <h2 className={headerClassName}>
        {name}
        <span
          data-canvas-path
          className={`${pathClassName} hidden @min-[20rem]/canvas-header:block`}
          title={path}
        >
          {path}
        </span>
      </h2>
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <h2 className={headerClassName}>
        {name}
        <PopoverTrigger
          data-canvas-path
          aria-label={`Edit instance path for ${page.title}`}
          className={`${pathClassName} ${focusClassName}`}
          title={path}
        >
          {path}
        </PopoverTrigger>
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
