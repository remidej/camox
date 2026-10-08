import { toast } from "@camox/ui/toaster";
import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { referenceWritesFor } from "@/core/editing/referenceWrites";
import { useRequireDraftSource } from "@/core/hooks/useRequireDraftSource";
import { lexicalStateToPlainText } from "@/core/lib/lexicalState";
import { referenceListIds, type ReferenceRecord } from "@/core/lib/reference";
import { serializeAssetField } from "@/features/content/collection-form";
import { useCamoxApp } from "@/features/provider/components/CamoxAppContext";
import { useProjectSlug } from "@/lib/auth";
import { invalidateCollectionRecordViews } from "@/lib/collection-cache";
import {
  referenceList,
  type NormalizedCollectionRecord,
  type NormalizedReferences,
} from "@/lib/normalized-data";
import {
  type BlockBundle,
  blockMutations,
  blockQueries,
  collectionMutations,
  collectionQueries,
  repeatableItemMutations,
} from "@/lib/queries";

import { contentFieldSchema } from "./contentFieldSchema";

/**
 * Where the page editor sidebar saves field edits: the content that owns the
 * fields currently shown (a block, a repeater item inside it, or the
 * collection record placed by one of its reference fields).
 */
export type FieldWriteTarget =
  | { kind: "block"; blockId: number }
  | { kind: "item"; blockId: number; itemId: number }
  | { kind: "record"; record: ReferenceRecord };

/** Saves one field of the write target. Awaitable for reference and reference list fields only. */
export type FieldWriter = (fieldName: string, value: unknown) => void | Promise<void>;

const fieldTypeOf = (schema: unknown, fieldName: string) =>
  contentFieldSchema(schema, fieldName)?.fieldType;

/** The block or repeatable item of a bundle that owns a reference list. */
type ListOwner = { kind: "block" } | { kind: "item"; itemId: number };

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
  queryClient: QueryClient,
  blockId: number,
  owner: ListOwner,
  fieldName: string,
  ids: string[],
  linkRecord: (id: string) => Promise<NormalizedCollectionRecord>,
) {
  const queryKey = blockQueries.get(blockId).queryKey;
  const previous = queryClient.getQueryData<BlockBundle>(queryKey);
  const previousOwner = previous && listOwnerIn(previous, owner);
  if (!previous || !previousOwner) return () => {};
  const hydrated = referenceList(previousOwner.references, fieldName);
  queryClient.setQueryData(queryKey, withReferenceList(previous, owner, fieldName, ids, hydrated));

  const missing = ids.filter((id) => !hydrated.some((record) => record.id === id));
  if (missing.length > 0) {
    void Promise.all(missing.map(linkRecord))
      .then((linked) =>
        queryClient.setQueryData<BlockBundle>(queryKey, (current) => {
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
  return () => queryClient.setQueryData(queryKey, previous);
}

/**
 * Returns the single field-change handler shared by every sidebar field editor
 * (field list, asset and link views). Edits are dropped outside the draft
 * source. Reference and reference list changes return a promise (rejecting outside the draft
 * source) so callers like the create-record modal can wait for the link.
 * Record edits go through the per-record queue shared with inline preview
 * edits, as full content with the expected version; their assets are sent as
 * collection asset snapshots rather than block file markers.
 */
export function useFieldWriter(target: FieldWriteTarget | null, schema: unknown): FieldWriter {
  const queryClient = useQueryClient();
  const projectSlug = useProjectSlug();
  const camoxApp = useCamoxApp();
  const updateBlockContent = useMutation(blockMutations.updateContent());
  const updateItemContent = useMutation(repeatableItemMutations.updateContent());
  const editRecord = useMutation(collectionMutations.edit());
  const requireDraft = useRequireDraftSource();

  return React.useCallback(
    (fieldName: string, value: unknown) => {
      if (target?.kind === "record") {
        const fieldType = fieldTypeOf(schema, fieldName);
        // A record's own reference fields report failures to their reference editor.
        const awaited = fieldType === "Reference" || fieldType === "ReferenceList";
        if (!requireDraft()) {
          return awaited
            ? Promise.reject(new Error("Switch to draft to change this reference."))
            : undefined;
        }
        const { record } = target;
        const saving = referenceWritesFor(queryClient)
          .save(record, fieldName, serializeAssetField(fieldType, value), async (input) => {
            const saved = await editRecord.mutateAsync({ ...input, projectSlug });
            queryClient.setQueryData(
              collectionQueries.record(projectSlug, record.collectionId, record.id).queryKey,
              saved,
            );
            // Shared source changes must refresh every placement, not only this block.
            void invalidateCollectionRecordViews(queryClient, projectSlug, record.collectionId);
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
          const record = await queryClient.ensureQueryData(
            collectionQueries.record(projectSlug, collectionId, recordId),
          );
          const labelField = camoxApp.getCollectionById(collectionId)?._internal.label;
          const label = labelField ? record.draft[labelField] : undefined;
          return {
            id: record.id,
            collectionId,
            content: record.draft,
            version: record.version,
            label: typeof label === "string" ? lexicalStateToPlainText(label) : "",
          };
        };
        return (async () => {
          if (!requireDraft()) throw new Error("Switch to draft to change this list.");
          const restore = applyReferenceListOptimistically(
            queryClient,
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
          void queryClient.invalidateQueries({
            queryKey: blockQueries.get(target.blockId).queryKey,
          });
        })();
      }
      if (field?.fieldType === "Reference") {
        return (async () => {
          if (id == null || !requireDraft())
            throw new Error("Switch to draft to change this reference.");
          await mutation.mutateAsync({ id, content });
        })();
      }
      if (id == null) return;
      if (!requireDraft()) return;
      mutation.mutate({ id, content });
    },
    [
      target,
      schema,
      queryClient,
      projectSlug,
      camoxApp,
      editRecord,
      updateBlockContent,
      updateItemContent,
      requireDraft,
    ],
  );
}
