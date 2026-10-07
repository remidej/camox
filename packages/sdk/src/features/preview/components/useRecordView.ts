import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { useProjectSlug } from "@/lib/auth";
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
  className?: string;
};

type RecordSelection = Extract<Selection, { type: "record" | "record-field" }>;
type PlacedRecord = Exclude<
  NonNullable<NonNullable<BlockBundle["block"]["references"]>[string]>,
  unknown[]
>;
type Collection = NonNullable<ReturnType<ReturnType<typeof useCamoxApp>["getCollectionById"]>>;

export type RecordView = {
  selection: RecordSelection;
  record: PlacedRecord;
  collection: Collection;
  status?: PublicationStatus;
};

/**
 * Resolves a record or record-field selection into the record it shows, while the block's
 * reference field still links that record. A stale selection (the record was unlinked or
 * replaced) shows, and then selects, the reference field view instead.
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
  const placed = referenceFieldName ? block?.references?.[referenceFieldName] : undefined;
  // Reference list placements are not selectable yet; only single references resolve here.
  const placedRecord = placed && !Array.isArray(placed) ? placed : undefined;
  const isStale =
    recordSelection != null &&
    block != null &&
    ((block.content as Record<string, unknown> | undefined)?.[recordSelection.fieldName] !==
      recordSelection.recordId ||
      placedRecord?.id !== recordSelection.recordId);

  const recordBlockId = recordSelection?.blockId;
  const referenceFieldSelection = React.useMemo<Selection | null>(
    () =>
      recordBlockId != null && referenceFieldName
        ? {
            type: "block-field",
            blockId: recordBlockId,
            fieldName: referenceFieldName,
            fieldType: "Reference",
          }
        : null,
    [recordBlockId, referenceFieldName],
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

  /** Reference field and purple record crumbs, between the block and the record field. */
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
        className: "text-purple-700 dark:text-purple-400",
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
