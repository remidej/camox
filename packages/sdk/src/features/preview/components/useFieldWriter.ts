import { toast } from "@camox/ui/toaster";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { referenceWritesFor } from "@/core/editing/referenceWrites";
import { referenceListIds, type ReferenceRecord } from "@/core/lib/reference";
import { recordText } from "@/core/recordItem";
import { serializeAssetField } from "@/features/content/collection-form";
import { useProjectUuid } from "@/lib/auth";
import { invalidateCollectionRecordViews } from "@/lib/collection-cache";
import {
  referenceList,
  type NormalizedCollectionRecord,
  type NormalizedReferences,
} from "@/lib/normalized-data";
import {
  type BlockBundle,
  blockMutations,
  collectionMutations,
  repeatableItemMutations,
} from "@/lib/queries";

import { reads, type StudioCache, useStudioCache } from "../../../lib/studio-reads";
import { contentFieldSchema } from "./contentFieldSchema";

/**
 * Where the page editor sidebar saves field edits: the content that owns the
 * fields currently shown (a block, a repeater item inside it, or the
 * collection record placed by one of its reference fields).
 */
export type FieldWriteTarget =
  | { kind: "block"; blockId: string }
  | { kind: "item"; blockId: string; itemId: string }
  | { kind: "record"; record: ReferenceRecord };

/** Saves one field of the write target. Awaitable for reference and reference list fields only. */
export type FieldWriter = (fieldName: string, value: unknown) => void | Promise<void>;

const fieldTypeOf = (schema: unknown, fieldName: string) =>
  contentFieldSchema(schema, fieldName)?.fieldType;

/** The block or repeatable item of a bundle that owns a reference list. */
type ListOwner = { kind: "block" } | { kind: "item"; itemId: string };

type ReferenceOwner = { content: unknown; references?: NormalizedReferences };

function listOwnerIn(bundle: BlockBundle, owner: ListOwner): ReferenceOwner | undefined {
  if (owner.kind === "block") return bundle.block;
  return bundle.repeatableItems.find((item) => item.id === owner.itemId);
}

/** A block bundle whose reference list stores `ids`, hydrated from `records` in that order. */
function withReferenceList(
  bundle: BlockBundle,
  owner: ListOwner,
  fieldName: string,
  ids: string[],
  records: readonly NormalizedCollectionRecord[],
): BlockBundle {
  const withList = <T extends ReferenceOwner>(current: T): T => ({
    ...current,
    content: { ...(current.content as Record<string, unknown>), [fieldName]: ids },
    references: {
      ...current.references,
      [fieldName]: ids.flatMap((id) => records.find((record) => record.id === id) ?? []),
    },
  });
  if (owner.kind === "block") return { ...bundle, block: withList(bundle.block) };
  return {
    ...bundle,
    repeatableItems: bundle.repeatableItems.map((item) =>
      item.id === owner.itemId ? withList(item) : item,
    ),
  };
}

/**
 * Shows a reference list change in the sidebar and preview before the server confirms it:
 * the block's draft stores the new ids, and its hydrated records follow the same order.
 * Newly linked records are fetched (or read from the record cache) and inserted as soon as
 * they resolve, so the preview shows them without waiting for the block refetch.
 * Returns an undo.
 */
function applyReferenceListOptimistically(
  studioCache: StudioCache,
  blockId: string,
  owner: ListOwner,
  fieldName: string,
  ids: string[],
  linkRecord: (id: string) => Promise<NormalizedCollectionRecord>,
) {
  // The block bundle in the draft the change was made in, even if the studio moves meanwhile.
  const edit = studioCache.edit();
  const bundle = reads.blockBundle(blockId);
  const previous = edit.get(bundle);
  const previousOwner = previous && listOwnerIn(previous, owner);
  if (!previous || !previousOwner) return () => {};
  const hydrated = referenceList(previousOwner.references, fieldName);
  edit.set(bundle, withReferenceList(previous, owner, fieldName, ids, hydrated));

  const missing = ids.filter((id) => !hydrated.some((record) => record.id === id));
  if (missing.length > 0) {
    void Promise.all(missing.map(linkRecord))
      .then((linked) =>
        edit.set(bundle, (current) => {
          // A later change or the server's own hydration wins.
          const currentOwner = current && listOwnerIn(current, owner);
          if (!current || !currentOwner) return current;
          const stored = referenceListIds(
            (currentOwner.content as Record<string, unknown>)[fieldName],
          );
          if (stored.join() !== ids.join()) return current;
          const records = [...referenceList(currentOwner.references, fieldName), ...linked];
          return withReferenceList(current, owner, fieldName, ids, records);
        }),
      )
      .catch(() => {
        // The block refetch after the write hydrates the record instead.
      });
  }
  return () => edit.rollback();
}

/**
 * Returns the single field-change handler shared by every sidebar field editor
 * (field list, asset and link views). Reference and reference list changes return a promise
 * so callers like the create-record modal can wait for the link.
 * Record edits go through the per-record queue shared with inline preview
 * edits, as full content with the expected version; their assets are sent as
 * collection asset snapshots rather than block file markers.
 */
export function useFieldWriter(target: FieldWriteTarget | null, schema: unknown): FieldWriter {
  const queryClient = useQueryClient();
  const projectUuid = useProjectUuid();
  const updateBlockContent = useMutation(blockMutations.updateContent());
  const updateItemContent = useMutation(repeatableItemMutations.updateContent());
  const editRecord = useMutation(collectionMutations.edit());
  const studioCache = useStudioCache();

  return React.useCallback(
    (fieldName: string, value: unknown) => {
      if (target?.kind === "record") {
        const fieldType = fieldTypeOf(schema, fieldName);
        // A record's own reference fields report failures to their reference editor.
        const awaited = fieldType === "Reference" || fieldType === "ReferenceList";
        const { record } = target;
        const saving = referenceWritesFor(queryClient)
          .save(record, fieldName, serializeAssetField(fieldType, value), async (input) => {
            const saved = await editRecord.mutateAsync({ ...input, projectUuid });
            studioCache.set(
              reads.record({ projectUuid, collectionId: record.collectionId, id: record.id }),
              saved,
            );
            // Shared source changes must refresh every placement, not only this block.
            void invalidateCollectionRecordViews(studioCache, projectUuid, record.collectionId);
            return saved;
          })
          .then(() => undefined);
        if (awaited) return saving;
        void saving.catch((cause: unknown) => {
          toast.error(cause instanceof Error ? cause.message : "Could not save item");
        });
        return;
      }

      const content = { [fieldName]: value };
      const mutation = target?.kind === "item" ? updateItemContent : updateBlockContent;
      const id = target?.kind === "item" ? target.itemId : target?.blockId;

      const field = contentFieldSchema(schema, fieldName);
      if (field?.fieldType === "ReferenceList" && target) {
        const { collectionId = "" } = field;
        const linkRecord = async (recordId: string): Promise<NormalizedCollectionRecord> => {
          const [record, collection] = await Promise.all([
            studioCache.ensure(reads.record({ projectUuid, collectionId, id: recordId })),
            studioCache.ensure(reads.collection({ projectUuid, collectionId })),
          ]);
          return {
            id: record.id,
            collectionId,
            content: record.content,
            ...recordText(collection, record.content),
          };
        };
        return (async () => {
          const restore = applyReferenceListOptimistically(
            studioCache,
            target.blockId,
            target.kind === "item" ? { kind: "item", itemId: target.itemId } : { kind: "block" },
            fieldName,
            referenceListIds(value),
            linkRecord,
          );
          try {
            if (target.kind === "item") {
              await updateItemContent.mutateAsync({ id: target.itemId, content });
            } else {
              await updateBlockContent.mutateAsync({ id: target.blockId, content });
            }
          } catch (cause) {
            restore();
            throw cause;
          }
          void studioCache.invalidate(reads.blockBundle(target.blockId));
        })();
      }
      if (field?.fieldType === "Reference") {
        return (async () => {
          if (id == null) throw new Error("Nothing to change this reference on.");
          await mutation.mutateAsync({ id, content });
        })();
      }
      if (id == null) return;
      mutation.mutate({ id, content });
    },
    [
      target,
      schema,
      queryClient,
      studioCache,
      projectUuid,
      editRecord,
      updateBlockContent,
      updateItemContent,
    ],
  );
}
