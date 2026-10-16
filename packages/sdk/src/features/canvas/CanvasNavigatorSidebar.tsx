import {
  Command,
  CommandEmpty,
  CommandGroup,
  commandFilter,
  CommandInput,
  CommandItem,
  CommandList,
} from "@camox/ui/command";

import { CMS_SIDEBAR_WIDTH } from "../preview/previewConstants";
import type { CanvasItem, CanvasShelf } from "./canvasItems";

function canvasItemLabel(item: CanvasItem) {
  return item.kind === "page" ? item.page.title : item.block._internal.title;
}

/** Search an item by its label, and a Page by its path too, never by its key. */
function canvasItemKeywords(item: CanvasItem) {
  const label = canvasItemLabel(item);
  return item.kind === "page" && item.page.pathname ? [label, item.page.pathname] : [label];
}

/**
 * Every item of the Canvas, in Canvas order, grouped under its shelf with its
 * count, and a search that takes focus. Picking one shows it: the camera goes to it.
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
        <CommandInput placeholder="Search the Canvas…" autoFocus />
        <CommandList className="max-h-none flex-1">
          <CommandEmpty>Nothing found.</CommandEmpty>
          {shelves.map((shelf) => (
            <CommandGroup key={shelf.key} heading={`${shelf.label} (${shelf.items.length})`}>
              {shelf.items.map((item) => (
                <CommandItem
                  key={item.key}
                  value={item.key}
                  keywords={canvasItemKeywords(item)}
                  data-checked={item.key === selectedKey}
                  aria-current={item.key === selectedKey ? "true" : undefined}
                  onSelect={() => onShowItem(item.key)}
                >
                  <span className="truncate">{canvasItemLabel(item)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </aside>
  );
}
