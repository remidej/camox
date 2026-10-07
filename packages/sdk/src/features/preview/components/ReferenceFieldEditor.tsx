import { Button } from "@camox/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@camox/ui/tooltip";
import { useQuery } from "@tanstack/react-query";
import { Link2, X } from "lucide-react";
import * as React from "react";

import { useCollectionItemModal } from "@/features/content/CollectionItemModalContext";
import { useCamoxApp } from "@/features/provider/components/CamoxAppContext";
import { useProjectSlug } from "@/lib/auth";
import type { NormalizedCollectionRecord } from "@/lib/normalized-data";
import { collectionQueries } from "@/lib/queries";

import type { OverlayMessage } from "../overlayMessages";
import { referencePickerFocus, useReferencePickerFocusRequested } from "../referencePickerFocus";
import { DrillRow } from "./DrillRow";
import type { PublicationStatus } from "./PageStatusBadge";
import { RecordCard, recordThumbnail } from "./RecordCard";
import { RecordCombobox } from "./RecordCombobox";

function referenceHint({
  linked,
  required,
  status,
}: {
  linked: boolean;
  required: boolean;
  status?: PublicationStatus;
}) {
  if (!linked) return required ? "Required" : null;
  // Only a record that was never published is missing from the live site.
  if (status !== "draft") return null;
  if (required) return "Blocks publishing until this record is included";
  return "Won't appear on the live site until published";
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
}: {
  collectionId: string;
  /** Overlay field ID of this placement; the preview placeholder requests focus by it. */
  fieldId?: string;
  value: unknown;
  required?: boolean;
  /** The hydrated record from the block bundle, used for the card thumbnail. */
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
}) {
  const projectSlug = useProjectSlug();
  const collection = useCamoxApp().getCollectionById(collectionId);
  const collectionTitle = collection?._internal.title ?? collectionId;
  const modal = useCollectionItemModal();
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const records = useQuery(collectionQueries.records(projectSlug, collectionId));
  const selectedId = typeof value === "string" && value ? value : null;
  const selected = records.data?.find((option) => option.id === value);
  const hydrated = record?.id === selectedId ? record : null;
  const selectedLabel = selected?.label ?? hydrated?.label ?? "Unavailable item";
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
    setPickerOpen(true);
  }, [focusRequested, fieldId, pickerReady]);

  const hint = referenceHint({ linked: selectedId !== null, required, status: selected?.status });

  if (drill) {
    return (
      <DrillRow
        label={drill.label}
        preview={selectedId ? selectedLabel : `No ${collectionTitle} linked`}
        // The field list only flags a missing required record, not publication state.
        hint={referenceHint({ linked: selectedId !== null, required }) ?? undefined}
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
        <RecordCard
          label={selectedLabel}
          collectionTitle={collectionTitle}
          status={selected?.status}
          thumbnail={
            hydrated ? recordThumbnail(collection?._internal.contentSchema, hydrated.content) : null
          }
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
          footerAction={{
            label: "Create item",
            onSelect: (search) =>
              modal.open({
                collectionId,
                initialContent:
                  collection && search.trim()
                    ? { [collection._internal.label]: search }
                    : undefined,
                onSaved: (created) => save(created.id),
              }),
          }}
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
