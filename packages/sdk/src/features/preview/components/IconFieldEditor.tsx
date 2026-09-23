import { Button } from "@camox/ui/button";
import { commandFilter } from "@camox/ui/command";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@camox/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@camox/ui/popover";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { ChevronsUpDown, SearchIcon } from "lucide-react";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { IconSvg } from "@/core/lib/icons";

const COLUMNS = 7;
const ROW_HEIGHT = 44;

function IconPicker({
  value,
  ids,
  onSelect,
}: {
  value: string;
  ids: string[];
  onSelect: (id: string) => void;
}) {
  // TanStack Virtual exposes a mutable instance; don't memoize its reads.
  "use no memo";

  const listId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState(value);
  // Filter before virtualizing so offscreen icons remain searchable.
  const filteredIds = useMemo(() => {
    const query = search.trim();
    if (!query) return ids;
    return ids
      .map((id) => ({ id, score: commandFilter(id, query) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ id }) => id);
  }, [ids, search]);
  const activeIndex = Math.max(0, filteredIds.indexOf(activeId));
  const activeRow = Math.floor(activeIndex / COLUMNS);
  const virtualizer = useVirtualizer({
    count: Math.ceil(filteredIds.length / COLUMNS),
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 2,
    initialOffset: () => activeRow * ROW_HEIGHT,
    // Keep aria-activedescendant mounted even when scrolling with the pointer.
    rangeExtractor: (range) =>
      [...new Set([...defaultRangeExtractor(range), activeRow])].sort((a, b) => a - b),
  });

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") {
      event.preventDefault();
      const id = filteredIds[activeIndex];
      if (id) onSelect(id);
      return;
    }

    let nextIndex: number;
    switch (event.key) {
      case "ArrowDown":
        nextIndex = event.metaKey ? filteredIds.length - 1 : activeIndex + 1;
        break;
      case "ArrowUp":
        nextIndex = event.metaKey ? 0 : activeIndex - 1;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = filteredIds.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    if (!filteredIds.length) return;
    // Preserve the command menu's sequential, wrapping keyboard navigation.
    if (nextIndex < 0) nextIndex = filteredIds.length - 1;
    if (nextIndex >= filteredIds.length) nextIndex = 0;
    setActiveId(filteredIds[nextIndex]!);
    virtualizer.scrollToIndex(Math.floor(nextIndex / COLUMNS), { align: "auto" });
  }

  return (
    <div className="flex flex-col gap-1 p-1">
      <div className="p-1 pb-0">
        <InputGroup className="border-input/30 bg-input/30 h-8 rounded-lg shadow-none">
          <InputGroupInput
            role="combobox"
            aria-label="Search icons"
            aria-autocomplete="list"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={
              filteredIds.length ? `${listId}-option-${activeIndex}` : undefined
            }
            placeholder="Search icons…"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setActiveId("");
              virtualizer.scrollToOffset(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <InputGroupAddon>
            <SearchIcon className="size-4" />
          </InputGroupAddon>
        </InputGroup>
      </div>
      <div className="p-1">
        <div
          ref={scrollRef}
          id={listId}
          role="listbox"
          aria-label="Choose icon"
          className="no-scrollbar max-h-72 overflow-x-hidden overflow-y-auto"
        >
          <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((row) => (
              <div
                key={row.key}
                role="presentation"
                className="absolute top-0 left-0 grid w-full grid-cols-7 gap-1"
                style={{ height: ROW_HEIGHT - 4, transform: `translateY(${row.start}px)` }}
              >
                {filteredIds
                  .slice(row.index * COLUMNS, (row.index + 1) * COLUMNS)
                  .map((id, column) => {
                    const index = row.index * COLUMNS + column;
                    return (
                      <button
                        key={id}
                        id={`${listId}-option-${index}`}
                        type="button"
                        role="option"
                        tabIndex={-1}
                        title={id}
                        aria-label={id}
                        aria-selected={id === value}
                        aria-posinset={index + 1}
                        aria-setsize={filteredIds.length}
                        data-active={index === activeIndex}
                        className={`text-muted-foreground data-[active=true]:bg-accent data-[active=true]:text-accent-foreground flex items-center justify-center rounded-sm p-2 outline-none ${id === value ? "bg-accent text-accent-foreground" : ""}`}
                        onPointerMove={() => setActiveId(id)}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => onSelect(id)}
                      >
                        <IconSvg iconId={id} className="size-5" />
                      </button>
                    );
                  })}
              </div>
            ))}
          </div>
        </div>
        {!filteredIds.length && (
          <div role="status" className="py-6 text-center text-sm">
            No matching icons.
          </div>
        )}
      </div>
    </div>
  );
}

export function IconFieldEditor({
  value,
  ids,
  onChange,
}: {
  value: string;
  ids: string[];
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    // Keep popover focus guards out of the parent form's space-y layout.
    <div className="flex flex-col">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              role="combobox"
              aria-label="Choose icon"
              className="w-full justify-between"
            />
          }
        >
          <span className="flex min-w-0 items-center gap-2">
            <IconSvg iconId={value} className="size-4 shrink-0" />
            <span className="truncate">{value.split(":")[1] ?? value}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </PopoverTrigger>
        <PopoverContent align="start" side="bottom" className="w-80 p-0">
          {open && (
            <IconPicker
              value={value}
              ids={ids}
              onSelect={(id) => {
                onChange(id);
                setOpen(false);
              }}
            />
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
