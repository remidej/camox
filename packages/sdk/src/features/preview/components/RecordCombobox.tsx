import { Combobox } from "@base-ui/react/combobox";
import { Button } from "@camox/ui/button";
import { Input } from "@camox/ui/input";
import { ChevronsUpDown, Plus } from "lucide-react";
import * as React from "react";

import { PageStatusBadge, type PublicationStatus } from "./PageStatusBadge";

export type RecordOption = { id: string; label: string; status: PublicationStatus };

/**
 * Picks a collection record by label. The footer action (e.g. Create item) receives the
 * current search text so it can prefill a new record.
 */
export function RecordCombobox({
  records,
  collectionTitle,
  onSelect,
  footerAction,
  disabled,
  open: controlledOpen,
  onOpenChange,
}: {
  records: readonly RecordOption[];
  collectionTitle: string;
  onSelect: (record: RecordOption) => void;
  footerAction?: { label: string; onSelect: (search: string) => void };
  disabled?: boolean;
  /** Control the popup, e.g. to open it when the preview asks to link a record. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const [search, setSearch] = React.useState("");
  const emptyMessage =
    records.length === 0 ? `${collectionTitle} has no items yet.` : "No items found.";

  return (
    <Combobox.Root
      items={records}
      value={null as RecordOption | null}
      open={open}
      onOpenChange={setOpen}
      inputValue={search}
      onInputValueChange={setSearch}
      itemToStringLabel={(record: RecordOption) => record.label}
      itemToStringValue={(record: RecordOption) => record.id}
      isItemEqualToValue={(record: RecordOption, current: RecordOption) => record.id === current.id}
      onValueChange={(record) => {
        if (record) onSelect(record);
      }}
      disabled={disabled}
    >
      <Combobox.Trigger
        render={<Button type="button" variant="outline" className="w-full justify-between" />}
      >
        Select item
        <ChevronsUpDown aria-hidden className="text-muted-foreground size-4" />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} align="start" className="isolate z-50">
          <Combobox.Popup className="bg-popover text-popover-foreground ring-foreground/10 flex max-h-(--available-height) w-(--anchor-width) min-w-48 flex-col rounded-md p-1 shadow-md ring-1">
            <Combobox.Input
              render={<Input className="mb-1" />}
              aria-label="Search items"
              placeholder="Search items…"
            />
            <Combobox.Empty className="text-muted-foreground text-sm">
              <div className="p-2">{emptyMessage}</div>
            </Combobox.Empty>
            <Combobox.List className="max-h-64 min-h-0 overflow-y-auto">
              {(record: RecordOption) => (
                <Combobox.Item
                  key={record.id}
                  value={record}
                  className="data-highlighted:bg-accent data-highlighted:text-accent-foreground flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none"
                >
                  <span className="min-w-0 flex-1 truncate">{record.label}</span>
                  <PageStatusBadge status={record.status} size="sm" />
                </Combobox.Item>
              )}
            </Combobox.List>
            {footerAction && (
              <div className="mt-1 shrink-0 border-t pt-1">
                <button
                  type="button"
                  className="hover:bg-accent hover:text-accent-foreground flex h-9 w-full items-center gap-2 rounded-sm px-2 text-sm outline-none"
                  onClick={() => {
                    setOpen(false);
                    footerAction.onSelect(search);
                  }}
                >
                  <Plus aria-hidden className="size-4 shrink-0" />
                  <span>{footerAction.label}</span>
                </button>
              </div>
            )}
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
