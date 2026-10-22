import { Button } from "@camox/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@camox/ui/tooltip";
import { Link2, X } from "lucide-react";
import * as React from "react";

import { titleField } from "@/core/recordItem";
import { useCollectionItemSheet } from "@/features/content/CollectionItemSheetContext";
import { useCamoxApp } from "@/features/provider/components/CamoxAppContext";
import { useProjectUuid } from "@/lib/auth";
import type { NormalizedCollectionRecord } from "@/lib/normalized-data";

import { reads, useReadQuery } from "../../../lib/studio-reads";
import type { OverlayMessage } from "../overlayMessages";
import { referencePickerFocus, useReferencePickerFocusRequested } from "../referencePickerFocus";
import { DrillRow } from "./DrillRow";
import { RecordCard } from "./RecordCard";
import { RecordCombobox } from "./RecordCombobox";

function referenceHint({ linked, required }: { linked: boolean; required: boolean }) {
  return !linked && required ? "Required" : null;
}

/** This view owns the reference only. Record content is edited elsewhere. */
export function ReferenceFieldEditor({
  collectionId,
  fieldId,
  value,
  required = false,
  record = null,
  onChange,
  onOpenRecord,
  drill,
  allowCreate = true,
}: {
  collectionId: string;
  /** Overlay field ID of this placement; the preview placeholder requests focus by it. */
  fieldId?: string;
  value: unknown;
  required?: boolean;
  /** The hydrated record from the block bundle, used for the card label before records load. */
  record?: NormalizedCollectionRecord | null;
  onChange: (id: string | null) => void | Promise<void>;
  /** Opens the linked record's view, where its fields are edited. */
  onOpenRecord?: (id: string) => void;
  drill?: {
    label: string;
    fieldId: string;
    onClick: () => void;
    postToIframe: (message: OverlayMessage) => void;
  };
  /** Offer Create item in the picker; off where the create sheet would replace a form. */
  allowCreate?: boolean;
}) {
  const projectUuid = useProjectUuid();
  const collection = useCamoxApp().getCollectionById(collectionId);
  const collectionTitle = collection?._internal.title ?? collectionId;
  const sheet = useCollectionItemSheet();
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const records = useReadQuery(reads.records({ projectUuid, collectionId }));
  const selectedId = typeof value === "string" && value ? value : null;
  const selected = records.data?.find((option) => option.id === value);
  const hydrated = record?.id === selectedId ? record : null;
  const selectedLabel = selected?.title ?? hydrated?.title ?? "Unavailable item";
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const focusRequested = useReferencePickerFocusRequested(drill ? undefined : fieldId);
  const pickerReady = !selectedId && records.isSuccess && !saving;

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

  React.useEffect(() => {
    if (!focusRequested || !fieldId || !pickerReady) return;
    referencePickerFocus.send({ type: "consume", fieldId });
    // oxlint-disable-next-line react/set-state-in-effect -- consumes a one-shot focus request from an external store
    setPickerOpen(true);
  }, [focusRequested, fieldId, pickerReady]);

  const hint = referenceHint({ linked: selectedId !== null, required });

  if (drill) {
    return (
      <DrillRow
        label={drill.label}
        preview={selectedId ? selectedLabel : `No ${collectionTitle} linked`}
        hint={hint ?? undefined}
        Icon={Link2}
        onClick={drill.onClick}
        hover={{ variant: "field", fieldId: drill.fieldId }}
        postToIframe={drill.postToIframe}
      />
    );
  }

  return (
    <fieldset disabled={saving} className="min-w-0 space-y-3">
      {selectedId && (
        <RecordCard
          label={selectedLabel}
          collectionTitle={collectionTitle}
          onOpen={onOpenRecord ? () => onOpenRecord(selectedId) : undefined}
          actions={
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
          }
        />
      )}
      {!selectedId && (
        <RecordCombobox
          records={records.data ?? []}
          collectionTitle={collectionTitle}
          onSelect={(option) => change(option.id)}
          disabled={saving || records.isPending || records.isError}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          footerAction={
            allowCreate
              ? {
                  label: "Create item",
                  onSelect: (search) =>
                    sheet.open({
                      collectionId,
                      initialContent:
                        collection && search.trim() && titleField(collection._internal.toTitle)
                          ? { [titleField(collection._internal.toTitle)!]: search }
                          : undefined,
                      onSaved: (created) => save(created.id),
                    }),
                }
              : undefined
          }
        />
      )}
      {hint && (
        <p data-reference-hint className="text-muted-foreground text-xs">
          {hint}
        </p>
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
