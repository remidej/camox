import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { referenceListIds } from "@/core/lib/reference";
import { useProjectSlug } from "@/lib/auth";
import { placedRecords, type NormalizedCollectionRecord } from "@/lib/normalized-data";
import { type BlockBundle, collectionQueries } from "@/lib/queries";

import { useCamoxApp } from "../../provider/components/CamoxAppContext";
import {
  previewStore,
  type EditingOwner,
  type RecordPlacement,
  type Selection,
} from "../previewStore";
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

/**
 * Resolves a record or record-field selection into the record it shows, while the block's
 * reference field still links that record, or the reference list still contains it. A stale
 * selection (the field no longer links the record) shows, and then selects, the reference field
 * view instead.
 */
export function useRecordView({
  owner,
  selection,
  block,
  contentSchema,
}: {
  owner: EditingOwner;
  selection: Selection | null;
  block: BlockBundle["block"] | null;
  /** The selected block's content schema, which declares its reference fields. */
  contentSchema: unknown;
}) {
  const camoxApp = useCamoxApp();
  const projectSlug = useProjectSlug();

  const recordSelection =
    selection?.type === "record" || selection?.type === "record-field" ? selection : null;
  const referenceFieldName = recordSelection?.fieldName;
  const referenceField = referenceFieldName
    ? contentFieldSchema(contentSchema, referenceFieldName)
    : undefined;
  const collectionId = referenceField?.collectionId;
  const collection = collectionId ? camoxApp.getCollectionById(collectionId) : undefined;
  const isStale =
    recordSelection != null &&
    block != null &&
    !linksRecord(
      referenceField?.fieldType,
      (block.content as Record<string, unknown> | undefined)?.[recordSelection.fieldName],
      recordSelection.recordId,
    );
  // A record the field just linked shows once the block's hydrated records include it.
  const placedRecord =
    recordSelection && !isStale
      ? placedRecords(block?.references, recordSelection.fieldName).find(
          (record) => record.id === recordSelection.recordId,
        )
      : undefined;
  const referenceFieldType =
    referenceField?.fieldType === "ReferenceList" ? "ReferenceList" : "Reference";

  const recordBlockId = recordSelection?.blockId;
  const referenceFieldSelection = React.useMemo<Selection | null>(
    () =>
      recordBlockId != null && referenceFieldName
        ? {
            type: "block-field",
            blockId: recordBlockId,
            fieldName: referenceFieldName,
            fieldType: referenceFieldType,
          }
        : null,
    [recordBlockId, referenceFieldName, referenceFieldType],
  );
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
    const { blockId, fieldName } = recordView.selection;
    const placement: RecordPlacement = { blockId, fieldName, recordId: recordView.record.id };
    const recordTarget: Selection = { type: "record", ...placement };
    return [
      {
        key: "reference-field",
        label: referenceField?.title ?? formatFieldName(fieldName),
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
