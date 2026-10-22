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
import { Plus } from "lucide-react";
import * as React from "react";

import { previewStore } from "../../preview/previewStore";
import { canvasPagePath, type CanvasPage } from "../canvasPages";

/**
 * The Canvas Navigator, shown while nothing is selected: every Page of the Canvas,
 * in Canvas order, with its path, and a search that takes focus. Picking a Page
 * shows it: the camera goes to it.
 */
export function CanvasNavigator({
  pages,
  selectedKey,
  onShowPage,
}: {
  pages: readonly CanvasPage[];
  /** The key of the selected Page, if any. */
  selectedKey?: string;
  onShowPage: (key: string) => void;
}) {
  const [search, setSearch] = React.useState("");
  return (
    <div data-canvas-navigator className="flex min-h-0 flex-1 flex-col">
      <Command
        className="rounded-none! bg-transparent"
        filter={(_value, search, keywords) => commandFilter(keywords?.join(" ") ?? "", search)}
      >
        <CommandInput
          placeholder="Search pages…"
          autoFocus
          value={search}
          onValueChange={setSearch}
        />
        <CommandList className="max-h-none flex-1">
          <CommandEmpty>Nothing found.</CommandEmpty>
          <CommandGroup heading={`Pages (${pages.length})`}>
            {pages.map((page) => {
              const selected = page.key === selectedKey;
              const path = canvasPagePath(page);
              return (
                <CommandItem
                  key={page.key}
                  value={page.key}
                  // Search a Page by its title and path, never by its key.
                  keywords={path ? [page.title, path] : [page.title]}
                  data-checked={selected}
                  aria-current={selected ? "true" : undefined}
                  onSelect={() => onShowPage(page.key)}
                >
                  <div className="flex min-w-0 flex-col py-0.5">
                    <span className="truncate font-medium">{page.title}</span>
                    {path && (
                      <span className="text-muted-foreground truncate font-mono text-xs">
                        {path}
                      </span>
                    )}
                  </div>
                </CommandItem>
              );
            })}
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
        </CommandList>
      </Command>
    </div>
  );
}
