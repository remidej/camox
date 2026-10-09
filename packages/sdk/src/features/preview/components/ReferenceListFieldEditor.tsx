import { Button } from "@camox/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@camox/ui/tooltip";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQuery } from "@tanstack/react-query";
import { GripVertical, ListOrdered, X } from "lucide-react";
import * as React from "react";

import type { ReferenceQuery } from "@/core/lib/contentType";
import { referenceListIds } from "@/core/lib/reference";
import { useCollectionItemModal } from "@/features/content/CollectionItemModalContext";
import { useCamoxApp } from "@/features/provider/components/CamoxAppContext";
import { useProjectSlug } from "@/lib/auth";
import type { NormalizedCollectionRecord } from "@/lib/normalized-data";
import { collectionQueries } from "@/lib/queries";

import type { OverlayMessage } from "../overlayMessages";
import { referencePickerFocus, useReferencePickerFocusRequested } from "../referencePickerFocus";
import { DrillRow } from "./DrillRow";
import type { PublicationStatus } from "./PageStatusBadge";
import { RecordCard } from "./RecordCard";
import { RecordCombobox } from "./RecordCombobox";

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

type EntryHover = { fieldId: string; postToIframe: (message: OverlayMessage) => void };

/** Highlights a record's entry in the preview while its card is hovered. */
function useEntryHover(hover: EntryHover | undefined) {
  const [isHovered, setIsHovered] = React.useState(false);
  const hoverFieldId = hover?.fieldId;
  const postToIframe = hover?.postToIframe;

  // Opening the record unmounts the card without a mouseleave; pair the messages on cleanup.
  React.useEffect(() => {
    if (!isHovered || hoverFieldId === undefined || !postToIframe) return;
    postToIframe({ type: "CAMOX_HOVER_FIELD", fieldId: hoverFieldId });
    return () => postToIframe({ type: "CAMOX_HOVER_FIELD_END", fieldId: hoverFieldId });
  }, [isHovered, hoverFieldId, postToIframe]);

  return { onMouseEnter: () => setIsHovered(true), onMouseLeave: () => setIsHovered(false) };
}

/**
 * How a query picks its records, for editors: "Newest 3 by published date",
 * "First 3 by Title, A to Z". Without `orderBy`, records come in creation order.
 */
function describeQuery(query: ReferenceQuery<any>, fieldTitle: (key: string) => string) {
  const [key, direction] = Object.entries(query.orderBy ?? { createdAt: "asc" })[0]!;
  const { limit } = query;
  if (key === "createdAt" || key === "publishedAt") {
    const head = direction === "desc" ? "Newest" : "Oldest";
    const date = key === "publishedAt" ? "published date" : "creation date";
    return `${head} ${limit ?? "first"} by ${date}`;
  }
  const head = limit === undefined ? "All" : `First ${limit}`;
  return `${head} by ${fieldTitle(key)}, ${direction === "desc" ? "Z to A" : "A to Z"}`;
}

/** A query result: it can be opened, never unlinked or moved. */
function QueryResultCard({
  hover,
  ...card
}: React.ComponentProps<typeof RecordCard> & { hover?: EntryHover }) {
  const hoverHandlers = useEntryHover(hover);
  return (
    <li {...hoverHandlers} className="min-w-0">
      <RecordCard {...card} />
    </li>
  );
}

function SortableRecordCard({
  id,
  label,
  collectionTitle,
  status,
  onOpen,
  onUnlink,
  hover,
}: {
  id: string;
  label: string;
  collectionTitle: string;
  status?: PublicationStatus;
  onOpen?: () => void;
  onUnlink: () => void;
  hover?: EntryHover;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const hoverHandlers = useEntryHover(hover);

  return (
    <li
      ref={setNodeRef}
      {...hoverHandlers}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className="min-w-0"
    >
      <RecordCard
        label={label}
        collectionTitle={collectionTitle}
        status={status}
        onOpen={onOpen}
        leading={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Reorder"
            className="text-muted-foreground hover:text-foreground shrink-0 cursor-grab active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripVertical aria-hidden className="size-4" />
          </Button>
        }
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
                  onClick={onUnlink}
                />
              }
            >
              <X aria-hidden className="size-4" />
            </TooltipTrigger>
            <TooltipContent>Unlink</TooltipContent>
          </Tooltip>
        }
      />
    </li>
  );
}

/**
 * Manages which records a reference list links, and their order. Every change writes the
 * whole id array; records themselves are edited in their own view, never unlinked by deletion.
 */
export function ReferenceListFieldEditor({
  collectionId,
  fieldId,
  value,
  maxItems,
  query,
  records: hydratedRecords = [],
  onChange,
  onOpenRecord,
  recordHover,
  drill,
  allowCreate = true,
}: {
  collectionId: string;
  /** Overlay field ID of this placement; the preview placeholder requests focus by it. */
  fieldId?: string;
  value: unknown;
  maxItems?: number;
  /**
   * Makes the list query-backed: its records are the query's resolved results (`records`),
   * shown read-only, since code defines their membership and order.
   */
  query?: ReferenceQuery<any>;
  /** Hydrated records from the block bundle, used for card labels before records load. */
  records?: readonly NormalizedCollectionRecord[];
  onChange?: (ids: string[]) => void | Promise<void>;
  /** Opens a linked record's view, where its fields are edited. */
  onOpenRecord?: (id: string) => void;
  /** Highlights a linked record's entry in the preview while its card is hovered. */
  recordHover?: {
    fieldId: (recordId: string) => string;
    postToIframe: (message: OverlayMessage) => void;
  };
  drill?: {
    label: string;
    fieldId: string;
    onClick: () => void;
    postToIframe: (message: OverlayMessage) => void;
  };
  /** Offer Create item in the picker; off where the create modal would replace a form. */
  allowCreate?: boolean;
}) {
  const projectSlug = useProjectSlug();
  const collection = useCamoxApp().getCollectionById(collectionId);
  const collectionTitle = collection?._internal.title ?? collectionId;
  const modal = useCollectionItemModal();
  const records = useQuery({
    ...collectionQueries.records(projectSlug, collectionId),
    enabled: !drill,
  });
  const storedIds = referenceListIds(value);
  // The order shown while a write is in flight, so dragged cards don't snap back.
  const [pendingIds, setPendingIds] = React.useState<string[] | null>(null);
  const ids = pendingIds ?? storedIds;
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const focusRequested = useReferencePickerFocusRequested(drill ? undefined : fieldId);
  const canAdd = maxItems === undefined || ids.length < maxItems;
  const pickerReady = canAdd && records.isSuccess && !saving;

  React.useEffect(() => {
    if (!focusRequested || !fieldId || !pickerReady) return;
    referencePickerFocus.send({ type: "consume", fieldId });
    setPickerOpen(true);
  }, [focusRequested, fieldId, pickerReady]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (drill && query) {
    const count = hydratedRecords.length;
    return (
      <DrillRow
        label={drill.label}
        preview={`${count} ${count === 1 ? "result" : "results"}`}
        Icon={ListOrdered}
        onClick={drill.onClick}
        hover={{ variant: "field", fieldId: drill.fieldId }}
        postToIframe={drill.postToIframe}
      />
    );
  }

  if (drill) {
    return (
      <DrillRow
        label={drill.label}
        preview={
          storedIds.length > 0 ? `${storedIds.length} linked` : `No ${collectionTitle} linked`
        }
        Icon={ListOrdered}
        onClick={drill.onClick}
        hover={{ variant: "field", fieldId: drill.fieldId }}
        postToIframe={drill.postToIframe}
      />
    );
  }

  if (query) {
    const fieldTitle = (key: string) => {
      const field = collection?._internal.contentSchema.properties[key] as
        | { title?: string }
        | undefined;
      return field?.title ?? key;
    };
    return (
      <div className="min-w-0 space-y-3">
        <p data-query-summary className="text-muted-foreground px-1 text-xs">
          {describeQuery(query, fieldTitle)}
        </p>
        {hydratedRecords.length > 0 && (
          <ul className="flex min-w-0 flex-col gap-2">
            {hydratedRecords.map((record) => (
              <QueryResultCard
                key={record.id}
                label={record.label}
                collectionTitle={collectionTitle}
                status={records.data?.find((option) => option.id === record.id)?.status}
                onOpen={onOpenRecord ? () => onOpenRecord(record.id) : undefined}
                hover={
                  recordHover && {
                    fieldId: recordHover.fieldId(record.id),
                    postToIframe: recordHover.postToIframe,
                  }
                }
              />
            ))}
          </ul>
        )}
      </div>
    );
  }

  const save = async (next: string[]) => {
    if (sameIds(next, ids)) return;
    setPendingIds(next);
    setSaving(true);
    setError(null);
    try {
      await onChange?.(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change the list.");
      throw cause;
    } finally {
      setPendingIds(null);
      setSaving(false);
    }
  };
  const change = (next: string[]) => {
    void save(next).catch(() => {
      // The list view displays the failure; event handlers do not reject.
    });
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    change(arrayMove(ids, from, to));
  };

  const options = (records.data ?? []).filter((option) => !ids.includes(option.id));

  return (
    <fieldset disabled={saving} className="min-w-0 space-y-3">
      {ids.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          modifiers={[restrictToVerticalAxis]}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="flex min-w-0 flex-col gap-2">
              {ids.map((id) => {
                const summary = records.data?.find((option) => option.id === id);
                const hydrated = hydratedRecords.find((record) => record.id === id);
                return (
                  <SortableRecordCard
                    key={id}
                    id={id}
                    label={summary?.label ?? hydrated?.label ?? "Unavailable item"}
                    collectionTitle={collectionTitle}
                    status={summary?.status}
                    onOpen={onOpenRecord ? () => onOpenRecord(id) : undefined}
                    onUnlink={() => change(ids.filter((linked) => linked !== id))}
                    hover={
                      recordHover && {
                        fieldId: recordHover.fieldId(id),
                        postToIframe: recordHover.postToIframe,
                      }
                    }
                  />
                );
              })}
            </ul>
          </SortableContext>
        </DndContext>
      )}
      {!canAdd && <p className="text-muted-foreground px-1 text-xs">Limit of {maxItems} reached</p>}
      {canAdd && (
        <RecordCombobox
          records={options}
          collectionTitle={collectionTitle}
          emptyMessage={
            records.data?.length ? `Every ${collectionTitle} item is already linked.` : undefined
          }
          onSelect={(option) => change([...ids, option.id])}
          disabled={saving || records.isPending || records.isError}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          footerAction={
            allowCreate
              ? {
                  label: "Create item",
                  onSelect: (search) =>
                    modal.open({
                      collectionId,
                      initialContent:
                        collection && search.trim()
                          ? { [collection._internal.label]: search }
                          : undefined,
                      onSaved: (created) => save([...ids, created.id]),
                    }),
                }
              : undefined
          }
        />
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
