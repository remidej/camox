import { useMutation } from "@tanstack/react-query";
import * as React from "react";

import { useRequireDraftSource } from "@/core/hooks/useRequireDraftSource";
import { blockMutations, repeatableItemMutations } from "@/lib/queries";

/**
 * Where the page editor sidebar saves field edits: the content that owns the
 * fields currently shown (a block, or a repeater item inside it).
 */
export type FieldWriteTarget =
  | { kind: "block"; blockId: number }
  | { kind: "item"; blockId: number; itemId: number };

/** Saves one field of the write target. Awaitable for reference fields only. */
export type FieldWriter = (fieldName: string, value: unknown) => void | Promise<void>;

const isReferenceField = (schema: unknown, fieldName: string) =>
  (schema as any)?.properties?.[fieldName]?.fieldType === "Reference";

/**
 * Returns the single field-change handler shared by every sidebar field editor
 * (field list, asset and link views). Edits are dropped outside the draft
 * source. Reference changes return a promise (rejecting outside the draft
 * source) so callers like the create-record modal can wait for the link.
 */
export function useFieldWriter(target: FieldWriteTarget | null, schema: unknown): FieldWriter {
  const updateBlockContent = useMutation(blockMutations.updateContent());
  const updateItemContent = useMutation(repeatableItemMutations.updateContent());
  const requireDraft = useRequireDraftSource();

  return React.useCallback(
    (fieldName: string, value: unknown) => {
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
    [target, schema, updateBlockContent, updateItemContent, requireDraft],
  );
}
