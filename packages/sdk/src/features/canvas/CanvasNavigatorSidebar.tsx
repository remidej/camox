import { Button } from "@camox/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  commandFilter,
  CommandInput,
  CommandItem,
  CommandList,
} from "@camox/ui/command";
import { ChevronsUpDown, Plus } from "lucide-react";
import * as React from "react";

import { cn } from "../../lib/utils";
import { CMS_SIDEBAR_WIDTH } from "../preview/previewConstants";
import { previewStore } from "../preview/previewStore";
import type { CanvasItem, CanvasPageItem, CanvasShelf } from "./canvasItems";

/** Blocks behind a bordered toggle, collapsed until opened. */
function CollapsedBlocks({ label, children }: { label: string; children: React.ReactNode }) {
  const [expanded, setExpanded] = React.useState(false);
  return (
    <div className="border-input flex flex-col overflow-hidden rounded-lg border shadow-xs">
      <button
        type="button"
        aria-expanded={expanded}
        className={cn(
          // Lines the chevron up with the names of the blocks below.
          "hover:bg-accent/75 flex w-full cursor-default items-center gap-2 px-3 py-2 text-left text-sm",
          // The whole header shows focus, inside the box's rounded border.
          "focus-visible:rounded-none focus-visible:ring-inset",
        )}
        onClick={() => setExpanded((value) => !value)}
      >
        <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
        <span className="truncate">{label}</span>
      </button>
      {expanded && <div className="border-input border-t p-1">{children}</div>}
    </div>
  );
}

function canvasItemLabel(item: CanvasItem) {
  return item.kind === "page" ? item.page.title : item.block._internal.title;
}

/** A Page's path, or its layout's pattern while a derived page has no path yet. */
function canvasPagePath({ page }: CanvasPageItem) {
  return page.pathname ?? page.pattern ?? null;
}

/** Search an item by its label, and a Page by its path too, never by its key. */
function canvasItemKeywords(item: CanvasItem) {
  const label = canvasItemLabel(item);
  const path = item.kind === "page" ? canvasPagePath(item) : null;
  return path ? [label, path] : [label];
}

/**
 * Every item of the Canvas, in Canvas order, grouped under its shelf with its
 * count, and a search that takes focus. Pages show with their path; blocks
 * start collapsed, though a search still finds them. Picking an item shows it:
 * the camera goes to it.
 */
export function CanvasNavigatorSidebar({
  shelves,
  selectedKey,
  onShowItem,
}: {
  shelves: readonly CanvasShelf[];
  /** The key of the selected item, if any. */
  selectedKey?: string;
  onShowItem: (key: string) => void;
}) {
  const [search, setSearch] = React.useState("");
  const searching = search.trim() !== "";

  const renderItem = (item: CanvasItem) => {
    const selected = item.key === selectedKey;
    const path = item.kind === "page" ? canvasPagePath(item) : null;
    return (
      <CommandItem
        key={item.key}
        value={item.key}
        keywords={canvasItemKeywords(item)}
        data-checked={selected}
        aria-current={selected ? "true" : undefined}
        onSelect={() => onShowItem(item.key)}
      >
        {item.kind === "page" ? (
          <div className="flex min-w-0 flex-col py-0.5">
            <span className="truncate font-medium">{canvasItemLabel(item)}</span>
            {path && (
              <span className="text-muted-foreground truncate font-mono text-xs">{path}</span>
            )}
          </div>
        ) : (
          <span className="truncate">{canvasItemLabel(item)}</span>
        )}
      </CommandItem>
    );
  };

  return (
    <aside
      aria-label="Canvas navigator"
      data-canvas-navigator-sidebar
      className="flex shrink-0 flex-col border-r-2"
      style={{ width: CMS_SIDEBAR_WIDTH }}
    >
      <Command
        className="rounded-none! bg-transparent"
        filter={(_value, search, keywords) => commandFilter(keywords?.join(" ") ?? "", search)}
      >
        <CommandInput
          placeholder="Search the Canvas…"
          autoFocus
          value={search}
          onValueChange={setSearch}
        />
        <CommandList className="max-h-none flex-1">
          <CommandEmpty>Nothing found.</CommandEmpty>
          {shelves.map((shelf) => {
            const heading = `${shelf.label} (${shelf.items.length})`;
            if (shelf.key === "shelf:pages") {
              return (
                <CommandGroup key={shelf.key} heading={heading}>
                  {shelf.items.map(renderItem)}
                  <div className="p-1">
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full"
                      onClick={() => previewStore.send({ type: "openCreatePageModal" })}
                    >
                      <Plus />
                      Create page
                    </Button>
                  </div>
                </CommandGroup>
              );
            }
            // Blocks start collapsed, behind a toggle naming them. Searching
            // lists the ones that match, under the shelf's heading.
            return (
              <CommandGroup key={shelf.key} heading={searching ? heading : undefined}>
                {searching || shelf.items.length === 0 ? (
                  shelf.items.map(renderItem)
                ) : (
                  <div className="p-1">
                    <CollapsedBlocks
                      label={`${shelf.items.length} ${shelf.items.length === 1 ? "block" : "blocks"}`}
                    >
                      {shelf.items.map(renderItem)}
                    </CollapsedBlocks>
                  </div>
                )}
              </CommandGroup>
            );
          })}
        </CommandList>
      </Command>
    </aside>
  );
}
