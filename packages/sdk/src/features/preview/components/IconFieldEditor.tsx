import { Combobox } from "@base-ui/react/combobox";
import { Button } from "@camox/ui/button";
import { commandFilter } from "@camox/ui/command";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@camox/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@camox/ui/popover";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { ChevronsUpDown, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

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

  const scrollRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  // Base UI 1.4 initializes its selected navigation index only while closed.
  // Give it a closed render before opening this conditionally mounted picker.
  useEffect(() => setReady(true), []);
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

  return (
    <Combobox.Root
      inline
      open={ready}
      grid
      virtualized
      autoHighlight
      loopFocus={false}
      items={ids}
      filteredItems={filteredIds}
      value={value}
      inputValue={search}
      onInputValueChange={(nextSearch) => {
        setSearch(nextSearch);
        setActiveId("");
        virtualizer.scrollToOffset(0);
      }}
      onItemHighlighted={(id, { index, reason }) => {
        setActiveId(id ?? "");
        if (index < 0 || reason === "pointer") return;
        virtualizer.scrollToIndex(Math.floor(index / COLUMNS), { align: "auto" });
      }}
    >
      <div className="flex flex-col gap-1 p-1">
        <div className="p-1 pb-0">
          <InputGroup className="border-input/30 bg-input/30 h-8 rounded-lg shadow-none">
            <Combobox.Input
              render={<InputGroupInput />}
              aria-label="Search icons"
              placeholder="Search icons…"
            />
            <InputGroupAddon>
              <SearchIcon className="size-4" />
            </InputGroupAddon>
          </InputGroup>
        </div>
        <div className="p-1">
          <Combobox.List
            ref={scrollRef}
            aria-rowcount={Math.ceil(filteredIds.length / COLUMNS)}
            aria-colcount={COLUMNS}
            aria-label="Choose icon"
            className="no-scrollbar max-h-72 overflow-x-hidden overflow-y-auto"
          >
            <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((row) => (
                <Combobox.Row
                  key={row.key}
                  aria-rowindex={row.index + 1}
                  className="absolute top-0 left-0 grid w-full grid-cols-7 gap-1"
                  style={{ height: ROW_HEIGHT - 4, transform: `translateY(${row.start}px)` }}
                >
                  {filteredIds
                    .slice(row.index * COLUMNS, (row.index + 1) * COLUMNS)
                    .map((id, column) => {
                      const index = row.index * COLUMNS + column;
                      return (
                        <Combobox.Item
                          key={id}
                          value={id}
                          index={index}
                          aria-colindex={column + 1}
                          onClick={() => onSelect(id)}
                          title={id}
                          aria-label={id}
                          className="text-muted-foreground data-highlighted:bg-accent data-highlighted:text-accent-foreground data-selected:bg-accent data-selected:text-accent-foreground flex cursor-default items-center justify-center rounded-sm p-2 outline-none"
                        >
                          <IconSvg iconId={id} className="size-5" />
                        </Combobox.Item>
                      );
                    })}
                </Combobox.Row>
              ))}
            </div>
          </Combobox.List>
          {!filteredIds.length && (
            <div role="status" className="py-6 text-center text-sm">
              No matching icons.
            </div>
          )}
        </div>
      </div>
    </Combobox.Root>
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
