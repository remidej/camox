import { Button } from "@camox/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@camox/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@camox/ui/popover";
import { ChevronsUpDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { IconSvg } from "@/core/lib/icons";

// Keep every option searchable without requesting the entire SVG collection.
function IconPreview({ id }: { id: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (visible || !ref.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setVisible(true);
      observer.disconnect();
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [visible]);
  return (
    <span ref={ref} className="flex size-5 items-center justify-center">
      {visible && <IconSvg iconId={id} className="size-5" />}
    </span>
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
          <Command defaultValue={value} label="Choose icon" loop>
            <CommandInput placeholder="Search icons…" aria-label="Search icons" />
            <CommandList>
              <CommandEmpty>No matching icons.</CommandEmpty>
              <CommandGroup className="[&_[cmdk-group-items]]:grid [&_[cmdk-group-items]]:grid-cols-7 [&_[cmdk-group-items]]:gap-1">
                {ids.map((id) => (
                  <CommandItem
                    key={id}
                    value={id}
                    title={id}
                    aria-label={id}
                    data-checked={id === value}
                    hideCheck
                    className={`aspect-square justify-center p-2 ${id === value ? "bg-accent text-accent-foreground" : ""}`}
                    onSelect={() => {
                      onChange(id);
                      setOpen(false);
                    }}
                  >
                    <IconPreview id={id} />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
