import { Combobox } from "@base-ui/react/combobox";
import { Button } from "@camox/ui/button";
import { Input } from "@camox/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@camox/ui/tooltip";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Link2, Plus, X } from "lucide-react";
import * as React from "react";

import { useCollectionItemModal } from "@/features/content/CollectionItemModalContext";
import { useProjectSlug } from "@/lib/auth";
import { collectionQueries } from "@/lib/queries";

import type { OverlayMessage } from "../overlayMessages";
import { DrillRow } from "./DrillRow";

/** This view owns the relationship only. Source content stays in the item modal. */
export function ReferenceFieldEditor({
  collectionId,
  value,
  onChange,
  drill,
}: {
  collectionId: string;
  value: unknown;
  onChange: (id: string | null) => void | Promise<void>;
  drill?: {
    label: string;
    fieldId: string;
    onClick: () => void;
    postToIframe: (message: OverlayMessage) => void;
  };
}) {
  const projectSlug = useProjectSlug();
  const modal = useCollectionItemModal();
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const records = useQuery(collectionQueries.records(projectSlug, collectionId));
  const selectedId = typeof value === "string" && value ? value : null;
  const selected = records.data?.find((record) => record.id === value);
  const selectedLabel = selected?.label ?? (value ? "Unavailable item" : "No item attached");

  const save = async (id: string | null) => {
    setSaving(true);
    setError(null);
    try {
      await onChange(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change reference.");
      throw cause;
    } finally {
      setSaving(false);
    }
  };
  const change = (id: string | null) => {
    void save(id).catch(() => {
      // The reference view displays the failure; event handlers do not reject.
    });
  };

  if (drill) {
    return (
      <DrillRow
        label={drill.label}
        preview={selectedLabel}
        Icon={Link2}
        onClick={drill.onClick}
        hover={{ variant: "field", fieldId: drill.fieldId }}
        postToIframe={drill.postToIframe}
      />
    );
  }

  return (
    <fieldset disabled={saving} className="space-y-3">
      {selectedId && (
        <div className="text-foreground hover:bg-accent/75 flex max-w-full items-center gap-2 rounded-lg border-2 p-1">
          <button
            type="button"
            aria-label={`Edit ${selectedLabel}`}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-sm p-2 text-left text-sm"
            onClick={() => modal.open({ collectionId, itemId: selectedId })}
          >
            <Link2 aria-hidden className="text-muted-foreground size-4 shrink-0" />
            <span className="truncate">{selectedLabel}</span>
          </button>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Unlink"
                  className="text-muted-foreground hover:text-foreground shrink-0"
                  onClick={() => change(null)}
                />
              }
            >
              <X aria-hidden className="size-4" />
            </TooltipTrigger>
            <TooltipContent>Unlink</TooltipContent>
          </Tooltip>
        </div>
      )}
      {!selectedId && (
        <Combobox.Root
          items={records.data ?? []}
          value={selected ?? null}
          itemToStringLabel={(record) => record.label}
          itemToStringValue={(record) => record.id}
          isItemEqualToValue={(record, current) => record.id === current.id}
          onValueChange={(record) => {
            if (record && record.id !== selectedId) change(record.id);
          }}
          disabled={saving || records.isPending || records.isError}
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
                  <div className="p-2">No items found.</div>
                </Combobox.Empty>
                <Combobox.List className="max-h-64 min-h-0 overflow-y-auto">
                  {(record) => (
                    <Combobox.Item
                      key={record.id}
                      value={record}
                      className="data-highlighted:bg-accent data-highlighted:text-accent-foreground flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none"
                    >
                      <span className="min-w-0 flex-1 truncate">{record.label}</span>
                      <Combobox.ItemIndicator>
                        <Check aria-hidden className="size-4" />
                      </Combobox.ItemIndicator>
                    </Combobox.Item>
                  )}
                </Combobox.List>
              </Combobox.Popup>
            </Combobox.Positioner>
          </Combobox.Portal>
        </Combobox.Root>
      )}
      {!selectedId && (
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() => modal.open({ collectionId, onSaved: (record) => save(record.id) })}
        >
          <Plus aria-hidden className="size-3.5" />
          Create item
        </Button>
      )}
      {records.isPending && <p role="status">Loading items…</p>}
      {records.isError && (
        <div role="alert" className="space-y-2">
          <p>Could not load collection items.</p>
          <Button type="button" variant="outline" onClick={() => void records.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </fieldset>
  );
}
