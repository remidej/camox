import { isQueryBacked } from "@camox/api-contract";
import * as React from "react";

import { referenceListIds } from "@/core/lib/reference";
import {
  placedRecords,
  referenceList,
  type NormalizedCollectionRecord,
  type NormalizedReferences,
} from "@/lib/normalized-data";
import { type CollectionDefinition, useCollectionDefinition } from "@/lib/studio-definitions";

import {
  isBlockPlacement,
  previewStore,
  recordPlacement,
  type EditingOwner,
  type RecordPlacement,
  type Selection,
} from "../previewStore";
import { contentFieldSchema, type ContentFieldSchema } from "./contentFieldSchema";
import { formatFieldName } from "./ItemFieldsEditor";

/** One entry of the sidebar's selection path. */
export type SelectionCrumb = {
  key: string;
  label: string;
  isCurrent: boolean;
  onClick?: () => void;
  hoverTarget?: Selection | null;
};

type RecordSelection = Extract<Selection, { type: "record" | "record-field" }>;

export type RecordView = {
  selection: RecordSelection;
  record: NormalizedCollectionRecord;
  collection: CollectionDefinition;
  /** Whether a reference list (rather than a single reference) places the record. */
  inList: boolean;
  /** Whether the record's own reference fields open the records they link (first hop only). */
  linksRecords: boolean;
};

/**
 * Whether a reference field still links the record: the id a reference stores, any id a
 * reference list contains, or any record a query-backed list resolved to (it stores nothing).
 */
function linksRecord(
  field: ContentFieldSchema | undefined,
  owner: { content: unknown; references?: NormalizedReferences },
  fieldName: string,
  recordId: string,
) {
  if (isQueryBacked(field)) {
    return referenceList(owner.references, fieldName).some((record) => record.id === recordId);
  }
  const stored = (owner.content as Record<string, unknown> | undefined)?.[fieldName];
  if (field?.fieldType === "ReferenceList") return referenceListIds(stored).includes(recordId);
  return stored === recordId;
}

/** What places the selected record: a block or repeatable item, or a record page's layout. */
export type RecordPlacer = BlockRecordPlacer | LayoutRecordPlacer;

/** The block or repeatable item whose reference field places the selected record. */
export type BlockRecordPlacer = {
  content: unknown;
  references?: NormalizedReferences;
  /** Its content schema, which declares its reference fields. */
  contentSchema: unknown;
};

/** The layout rendering a record page, with the record its loader returned. */
export type LayoutRecordPlacer = { collectionId: string; record: NormalizedCollectionRecord };

function isLayoutPlacer(placer: RecordPlacer | null): placer is LayoutRecordPlacer {
  return placer != null && "record" in placer;
}

/**
 * Resolves a record or record-field selection into the record it shows, while the placer's
 * reference field still links that record, or the reference list still contains it. A layout
 * places the record its record page loaded, through no reference field. A record
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
  const recordSelection =
    selection?.type === "record" || selection?.type === "record-field" ? selection : null;
  const nested = recordSelection?.nested;

  // First hop: the record the block or item places, or the record page's record.
  const blockSelection =
    recordSelection && isBlockPlacement(recordSelection) ? recordSelection : null;
  const layoutSelection =
    recordSelection && !isBlockPlacement(recordSelection) ? recordSelection : null;
  const blockPlacer = placer && !isLayoutPlacer(placer) ? placer : null;
  const layoutPlacer = isLayoutPlacer(placer) ? placer : null;
  const referenceFieldName = blockSelection?.fieldName;
  const referenceField = referenceFieldName
    ? contentFieldSchema(blockPlacer?.contentSchema, referenceFieldName)
    : undefined;
  const outerCollectionId = layoutSelection
    ? layoutPlacer?.collectionId
    : referenceField?.collectionId;
  const outerCollection = useCollectionDefinition(outerCollectionId);
  const outerStale = blockSelection
    ? blockPlacer != null &&
      !linksRecord(referenceField, blockPlacer, blockSelection.fieldName, blockSelection.recordId)
    : layoutSelection != null &&
      layoutPlacer != null &&
      layoutPlacer.record.id !== layoutSelection.recordId;
  // A record the field just linked shows once the placer's hydrated records include it.
  const findOuterRecord = () => {
    if (outerStale) return undefined;
    if (blockSelection)
      return placedRecords(blockPlacer?.references, blockSelection.fieldName).find(
        (record) => record.id === blockSelection.recordId,
      );
    if (layoutSelection) return layoutPlacer?.record;
    return undefined;
  };
  const outerRecord = findOuterRecord();

  // Second hop: the record the first one links through its own reference field.
  const nestedField = nested
    ? contentFieldSchema(outerCollection?.contentSchema, nested.fieldName)
    : undefined;
  const nestedCollection = useCollectionDefinition(nestedField?.collectionId);
  const nestedStale =
    nested != null &&
    outerRecord != null &&
    !linksRecord(nestedField, outerRecord, nested.fieldName, nested.recordId);
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

  const recordBlockId = blockSelection?.blockId;
  const recordItemId = blockSelection?.itemId;
  const recordLayoutId = layoutSelection?.layoutId;
  const referenceFieldSelection = React.useMemo<Selection | null>(() => {
    if (recordBlockId == null || !referenceFieldName) return null;
    const field = { fieldName: referenceFieldName, fieldType: referenceFieldType } as const;
    if (recordItemId == null) return { type: "block-field", blockId: recordBlockId, ...field };
    return { type: "item-field", blockId: recordBlockId, itemId: recordItemId, ...field };
  }, [recordBlockId, recordItemId, referenceFieldName, referenceFieldType]);
  const outerPlacement: RecordPlacement | null = recordSelection
    ? (({ nested: _nested, ...outer }) => outer)(recordPlacement(recordSelection))
    : null;
  // The first record's reference field that links the second.
  const recordId = recordSelection?.recordId;
  const nestedFieldName = nested?.fieldName;
  const nestedFieldSelection = React.useMemo<Selection | null>(() => {
    if (!recordId || !nestedFieldName) return null;
    const field = { recordFieldName: nestedFieldName, recordFieldType: nestedFieldType };
    if (recordLayoutId != null) {
      return { type: "record-field", layoutId: recordLayoutId, recordId, ...field };
    }
    if (recordBlockId == null || !referenceFieldName) return null;
    return {
      type: "record-field",
      blockId: recordBlockId,
      ...(recordItemId == null ? {} : { itemId: recordItemId }),
      fieldName: referenceFieldName,
      recordId,
      ...field,
    };
  }, [
    recordBlockId,
    recordItemId,
    recordLayoutId,
    referenceFieldName,
    recordId,
    nestedFieldName,
    nestedFieldType,
  ]);

  const isStale = outerStale || nestedStale;
  const fallbackSelection = outerStale ? referenceFieldSelection : nestedFieldSelection;
  React.useEffect(() => {
    if (!isStale || !fallbackSelection) return;
    previewStore.send({ type: "selectTarget", ...owner, selection: fallbackSelection });
  }, [isStale, fallbackSelection, owner]);

  const placedRecord = nested ? nestedRecord : outerRecord;
  const collection = nested ? nestedCollection : outerCollection;
  const shown = recordSelection && !isStale && placedRecord && collection;

  const recordView: RecordView | null = shown
    ? {
        selection: recordSelection,
        record: placedRecord,
        collection,
        inList: (nested ? nestedFieldType : referenceFieldType) === "ReferenceList",
        linksRecords: !nested,
      }
    : null;

  /** Reference field and record crumbs, between the block (or item) and the record field. */
  const recordCrumbs = (fieldHasOwnView: boolean): SelectionCrumb[] => {
    if (!recordView || !outerRecord || !outerPlacement) return [];
    const outerTarget: Selection = { type: "record", ...outerPlacement };
    // A record page's record has no reference field above it.
    const referenceFieldCrumbs: SelectionCrumb[] = isBlockPlacement(outerPlacement)
      ? [
          {
            key: "reference-field",
            label: referenceField?.title ?? formatFieldName(outerPlacement.fieldName),
            isCurrent: false,
            hoverTarget: referenceFieldSelection,
            onClick: () =>
              previewStore.send({
                type: "selectTarget",
                ...owner,
                selection: referenceFieldSelection,
              }),
          },
        ]
      : [];
    const crumbs: SelectionCrumb[] = [
      ...referenceFieldCrumbs,
      {
        key: "record",
        label: outerRecord.title,
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
        label: recordView.record.title,
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
