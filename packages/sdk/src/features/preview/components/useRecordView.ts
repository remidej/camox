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
 * reference field still links that record, or the reference list still contains it. A stale
 * selection (the field no longer links the record) shows, and then selects, the reference field
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
  const referenceFieldName = recordSelection?.fieldName;
  const referenceField = referenceFieldName
    ? contentFieldSchema(placer?.contentSchema, referenceFieldName)
    : undefined;
  const collectionId = referenceField?.collectionId;
  const collection = collectionId ? camoxApp.getCollectionById(collectionId) : undefined;
  const isStale =
    recordSelection != null &&
    placer != null &&
    !linksRecord(
      referenceField?.fieldType,
      (placer.content as Record<string, unknown> | undefined)?.[recordSelection.fieldName],
      recordSelection.recordId,
    );
  // A record the field just linked shows once the placer's hydrated records include it.
  const placedRecord =
    recordSelection && !isStale
      ? placedRecords(placer?.references, recordSelection.fieldName).find(
          (record) => record.id === recordSelection.recordId,
        )
      : undefined;
  const referenceFieldType =
    referenceField?.fieldType === "ReferenceList" ? "ReferenceList" : "Reference";

  const recordBlockId = recordSelection?.blockId;
  const recordItemId = recordSelection?.itemId;
  const referenceFieldSelection = React.useMemo<Selection | null>(() => {
    if (recordBlockId == null || !referenceFieldName) return null;
    const field = { fieldName: referenceFieldName, fieldType: referenceFieldType } as const;
    if (recordItemId == null) return { type: "block-field", blockId: recordBlockId, ...field };
    return { type: "item-field", blockId: recordBlockId, itemId: recordItemId, ...field };
  }, [recordBlockId, recordItemId, referenceFieldName, referenceFieldType]);
  React.useEffect(() => {
    if (!isStale || !referenceFieldSelection) return;
    previewStore.send({ type: "selectTarget", ...owner, selection: referenceFieldSelection });
  }, [isStale, referenceFieldSelection, owner]);

  const shown = recordSelection && !isStale && placedRecord && collection;
  const placedRecordId = shown ? placedRecord.id : undefined;
  const { data: status } = useQuery({
    ...collectionQueries.records(projectSlug, collectionId ?? ""),
    enabled: placedRecordId != null,
    select: (records) => records.find((record) => record.id === placedRecordId)?.status,
  });

  const recordView: RecordView | null = shown
    ? { selection: recordSelection, record: placedRecord, collection, status }
    : null;

  /** Reference field and record crumbs, between the block and the record field. */
  const recordCrumbs = (fieldHasOwnView: boolean): SelectionCrumb[] => {
    if (!recordView) return [];
    const placement = recordPlacement(recordView.selection);
    const recordTarget: Selection = { type: "record", ...placement };
    return [
      {
        key: "reference-field",
        label: referenceField?.title ?? formatFieldName(placement.fieldName),
        isCurrent: false,
        hoverTarget: referenceFieldSelection,
        onClick: () =>
          previewStore.send({ type: "selectTarget", ...owner, selection: referenceFieldSelection }),
      },
      {
        key: "record",
        label: recordView.record.label,
        isCurrent: !fieldHasOwnView,
        hoverTarget: recordTarget,
        onClick: fieldHasOwnView
          ? () => previewStore.send({ type: "selectRecord", ...owner, ...placement })
          : undefined,
      },
    ];
  };

  return {
    recordView,
    /** The selection the sidebar shows: the reference field view while a record is stale. */
    viewSelection: isStale ? referenceFieldSelection : selection,
    recordCrumbs,
  };
}
