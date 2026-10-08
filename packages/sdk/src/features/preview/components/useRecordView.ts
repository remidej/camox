import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { referenceListIds } from "@/core/lib/reference";
import { useProjectSlug } from "@/lib/auth";
import {
  placedRecords,
  type NormalizedCollectionRecord,
  type NormalizedReferences,
} from "@/lib/normalized-data";
import { collectionQueries } from "@/lib/queries";

import { useCamoxApp } from "../../provider/components/CamoxAppContext";
import { previewStore, recordPlacement, type EditingOwner, type Selection } from "../previewStore";
import { contentFieldSchema } from "./contentFieldSchema";
import { formatFieldName } from "./ItemFieldsEditor";
import type { PublicationStatus } from "./PageStatusBadge";

/** One entry of the sidebar's selection path. */
export type SelectionCrumb = {
  key: string;
  label: string;
  isCurrent: boolean;
  onClick?: () => void;
  hoverTarget?: Selection | null;
};

type RecordSelection = Extract<Selection, { type: "record" | "record-field" }>;
type Collection = NonNullable<ReturnType<ReturnType<typeof useCamoxApp>["getCollectionById"]>>;

export type RecordView = {
  selection: RecordSelection;
  record: NormalizedCollectionRecord;
  collection: Collection;
  status?: PublicationStatus;
  /** Whether a reference list (rather than a single reference) places the record. */
  inList: boolean;
  /** Whether the record's own reference fields open the records they link (first hop only). */
  linksRecords: boolean;
};

/**
 * Whether a reference field's stored value still links the record: the id a reference stores,
 * or any id a reference list contains.
 */
function linksRecord(fieldType: string | undefined, stored: unknown, recordId: string) {
  if (fieldType === "ReferenceList") return referenceListIds(stored).includes(recordId);
  return stored === recordId;
}

/** The block or repeatable item whose reference field places the selected record. */
export type RecordPlacer = {
  content: unknown;
  references?: NormalizedReferences;
  /** Its content schema, which declares its reference fields. */
  contentSchema: unknown;
};

/**
 * Resolves a record or record-field selection into the record it shows, while the placer's
 * reference field still links that record, or the reference list still contains it. A record
 * linked by a placed record (`nested`) resolves through that record's own links. A stale
 * selection (a field no longer links its record) shows, and then selects, that reference field's
 * view instead.
 */
export function useRecordView({
  owner,
  selection,
  placer,
}: {
  owner: EditingOwner;
  selection: Selection | null;
  placer: RecordPlacer | null;
}) {
  const camoxApp = useCamoxApp();
  const projectSlug = useProjectSlug();

  const recordSelection =
    selection?.type === "record" || selection?.type === "record-field" ? selection : null;
  const nested = recordSelection?.nested;

  // First hop: the record the block or item places.
  const referenceFieldName = recordSelection?.fieldName;
  const referenceField = referenceFieldName
    ? contentFieldSchema(placer?.contentSchema, referenceFieldName)
    : undefined;
  const outerCollection = referenceField?.collectionId
    ? camoxApp.getCollectionById(referenceField.collectionId)
    : undefined;
  const outerStale =
    recordSelection != null &&
    placer != null &&
    !linksRecord(
      referenceField?.fieldType,
      (placer.content as Record<string, unknown> | undefined)?.[recordSelection.fieldName],
      recordSelection.recordId,
    );
  // A record the field just linked shows once the placer's hydrated records include it.
  const outerRecord =
    recordSelection && !outerStale
      ? placedRecords(placer?.references, recordSelection.fieldName).find(
          (record) => record.id === recordSelection.recordId,
        )
      : undefined;

  // Second hop: the record the first one links through its own reference field.
  const nestedField = nested
    ? contentFieldSchema(outerCollection?._internal.contentSchema, nested.fieldName)
    : undefined;
  const nestedCollection = nestedField?.collectionId
    ? camoxApp.getCollectionById(nestedField.collectionId)
    : undefined;
  const nestedStale =
    nested != null &&
    outerRecord != null &&
    !linksRecord(nestedField?.fieldType, outerRecord.content[nested.fieldName], nested.recordId);
  const nestedRecord =
    nested && outerRecord && !nestedStale
      ? placedRecords(outerRecord.references, nested.fieldName).find(
          (record) => record.id === nested.recordId,
        )
      : undefined;

  const fieldTypeOf = (field: typeof referenceField) =>
    field?.fieldType === "ReferenceList" ? ("ReferenceList" as const) : ("Reference" as const);
  const referenceFieldType = fieldTypeOf(referenceField);
  const nestedFieldType = fieldTypeOf(nestedField);

  const recordBlockId = recordSelection?.blockId;
  const recordItemId = recordSelection?.itemId;
  const referenceFieldSelection = React.useMemo<Selection | null>(() => {
    if (recordBlockId == null || !referenceFieldName) return null;
    const field = { fieldName: referenceFieldName, fieldType: referenceFieldType } as const;
    if (recordItemId == null) return { type: "block-field", blockId: recordBlockId, ...field };
    return { type: "item-field", blockId: recordBlockId, itemId: recordItemId, ...field };
  }, [recordBlockId, recordItemId, referenceFieldName, referenceFieldType]);
  const outerPlacement = recordSelection
    ? (({ nested: _nested, ...outer }) => outer)(recordPlacement(recordSelection))
    : null;
  // The first record's reference field that links the second.
  const recordId = recordSelection?.recordId;
  const nestedFieldName = nested?.fieldName;
  const nestedFieldSelection = React.useMemo<Selection | null>(() => {
    if (recordBlockId == null || !referenceFieldName || !recordId || !nestedFieldName) return null;
    return {
      type: "record-field",
      blockId: recordBlockId,
      ...(recordItemId == null ? {} : { itemId: recordItemId }),
      fieldName: referenceFieldName,
      recordId,
      recordFieldName: nestedFieldName,
      recordFieldType: nestedFieldType,
    };
  }, [recordBlockId, recordItemId, referenceFieldName, recordId, nestedFieldName, nestedFieldType]);

  const isStale = outerStale || nestedStale;
  const fallbackSelection = outerStale ? referenceFieldSelection : nestedFieldSelection;
  React.useEffect(() => {
    if (!isStale || !fallbackSelection) return;
    previewStore.send({ type: "selectTarget", ...owner, selection: fallbackSelection });
  }, [isStale, fallbackSelection, owner]);

  const placedRecord = nested ? nestedRecord : outerRecord;
  const collection = nested ? nestedCollection : outerCollection;
  const collectionId = collection?._internal.id;
  const shown = recordSelection && !isStale && placedRecord && collection;
  const placedRecordId = shown ? placedRecord.id : undefined;
  const { data: status } = useQuery({
    ...collectionQueries.records(projectSlug, collectionId ?? ""),
    enabled: placedRecordId != null,
    select: (records) => records.find((record) => record.id === placedRecordId)?.status,
  });

  const recordView: RecordView | null = shown
    ? {
        selection: recordSelection,
        record: placedRecord,
        collection,
        status,
        inList: (nested ? nestedFieldType : referenceFieldType) === "ReferenceList",
        linksRecords: !nested,
      }
    : null;

  /** Reference field and record crumbs, between the block (or item) and the record field. */
  const recordCrumbs = (fieldHasOwnView: boolean): SelectionCrumb[] => {
    if (!recordView || !outerRecord || !outerPlacement) return [];
    const outerTarget: Selection = { type: "record", ...outerPlacement };
    const crumbs: SelectionCrumb[] = [
      {
        key: "reference-field",
        label: referenceField?.title ?? formatFieldName(outerPlacement.fieldName),
        isCurrent: false,
        hoverTarget: referenceFieldSelection,
        onClick: () =>
          previewStore.send({ type: "selectTarget", ...owner, selection: referenceFieldSelection }),
      },
      {
        key: "record",
        label: outerRecord.label,
        isCurrent: !nested && !fieldHasOwnView,
        hoverTarget: outerTarget,
        onClick:
          nested || fieldHasOwnView
            ? () => previewStore.send({ type: "selectRecord", ...owner, ...outerPlacement })
            : undefined,
      },
    ];
    if (!nested) return crumbs;
    const nestedTarget: Selection = { type: "record", ...outerPlacement, nested };
    return [
      ...crumbs,
      {
        key: "nested-reference-field",
        label: nestedField?.title ?? formatFieldName(nested.fieldName),
        isCurrent: false,
        hoverTarget: nestedFieldSelection,
        onClick: () =>
          previewStore.send({ type: "selectTarget", ...owner, selection: nestedFieldSelection }),
      },
      {
        key: "nested-record",
        label: recordView.record.label,
        isCurrent: !fieldHasOwnView,
        hoverTarget: nestedTarget,
        onClick: fieldHasOwnView
          ? () => previewStore.send({ type: "selectRecord", ...owner, ...outerPlacement, nested })
          : undefined,
      },
    ];
  };

  return {
    recordView,
    /** The selection the sidebar shows: the reference field view while a record is stale. */
    viewSelection: isStale ? fallbackSelection : selection,
    recordCrumbs,
  };
}
