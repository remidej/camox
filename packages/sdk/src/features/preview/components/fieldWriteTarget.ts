import { toast } from "@camox/ui/toaster";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { referenceWritesFor } from "@/core/editing/referenceWrites";
import { useRequireDraftSource } from "@/core/hooks/useRequireDraftSource";
import type { ReferenceRecord } from "@/core/lib/reference";
import { useProjectSlug } from "@/lib/auth";
import { invalidateCollectionRecordViews } from "@/lib/collection-cache";
import {
  blockMutations,
  collectionMutations,
  collectionQueries,
  repeatableItemMutations,
} from "@/lib/queries";

/**
 * Where the page editor sidebar saves field edits: the content that owns the
 * fields currently shown (a block, a repeater item inside it, or the
 * collection record placed by one of its reference fields).
 */
export type FieldWriteTarget =
  | { kind: "block"; blockId: number }
  | { kind: "item"; blockId: number; itemId: number }
  | { kind: "record"; record: ReferenceRecord };

/** Saves one field of the write target. Awaitable for reference fields only. */
export type FieldWriter = (fieldName: string, value: unknown) => void | Promise<void>;

const isReferenceField = (schema: unknown, fieldName: string) =>
  (schema as any)?.properties?.[fieldName]?.fieldType === "Reference";

/**
 * Returns the single field-change handler shared by every sidebar field editor
 * (field list, asset and link views). Edits are dropped outside the draft
 * source. Reference changes return a promise (rejecting outside the draft
 * source) so callers like the create-record modal can wait for the link.
 * Record edits go through the per-record queue shared with inline preview
 * edits, as full content with the expected version.
 */
export function useFieldWriter(target: FieldWriteTarget | null, schema: unknown): FieldWriter {
  const queryClient = useQueryClient();
  const projectSlug = useProjectSlug();
  const updateBlockContent = useMutation(blockMutations.updateContent());
  const updateItemContent = useMutation(repeatableItemMutations.updateContent());
  const editRecord = useMutation(collectionMutations.edit());
  const requireDraft = useRequireDraftSource();

  return React.useCallback(
    (fieldName: string, value: unknown) => {
      if (target?.kind === "record") {
        if (!requireDraft()) return;
        const { record } = target;
        void referenceWritesFor(queryClient)
          .save(record, fieldName, value, async (input) => {
            const saved = await editRecord.mutateAsync({ ...input, projectSlug });
            queryClient.setQueryData(
              collectionQueries.record(projectSlug, record.collectionId, record.id).queryKey,
              saved,
            );
            // Shared source changes must refresh every placement, not only this block.
            void invalidateCollectionRecordViews(queryClient, projectSlug, record.collectionId);
            return saved;
          })
          .catch((cause: unknown) => {
            toast.error(cause instanceof Error ? cause.message : "Could not save item");
          });
        return;
      }

      const content = { [fieldName]: value };
      const mutation = target?.kind === "item" ? updateItemContent : updateBlockContent;
      const id = target?.kind === "item" ? target.itemId : target?.blockId;

      if (isReferenceField(schema, fieldName)) {
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
      editRecord,
      updateBlockContent,
      updateItemContent,
      requireDraft,
    ],
  );
}
