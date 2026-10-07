import { useSelector } from "@xstate/store-react";
import { useContext } from "react";

import { PreviewEditingOwnerContext } from "../../features/preview/previewSelection";
import { previewStore, selectionForOwner } from "../../features/preview/previewStore";
import type { FieldType } from "../lib/fieldTypes.tsx";

/**
 * Returns whether the given field is currently selected based on the normalized selection state.
 *
 * Matches when the selection points to this exact field (type + name + optional repeatable item).
 */
export function useFieldSelection(
  blockId: number,
  fieldName: string,
  fieldType: FieldType,
  repeatableItemId?: number,
): boolean {
  const owner = useContext(PreviewEditingOwnerContext);
  return useSelector(previewStore, (state) => {
    const sel = selectionForOwner(state.context, owner);
    if (!sel || sel.blockId !== blockId) return false;

    // Check for field-level selections
    if (sel.type === "block-field") {
      if (repeatableItemId) return false; // Field is in a repeater but selection is at block level
      return sel.fieldType === fieldType && sel.fieldName === fieldName;
    }

    if (sel.type === "item-field") {
      if (!repeatableItemId) return false; // Field is at block level but selection is in an item
      return (
        sel.itemId === repeatableItemId &&
        sel.fieldType === fieldType &&
        sel.fieldName === fieldName
      );
    }

    return false;
  });
}

/** A record placed by a block's reference field. */
export type RecordPlacement = { blockId: number; fieldName: string; recordId: string };

/**
 * Returns whether the placed record, or one of its record fields when `recordFieldName` is
 * given, is selected. Matches only this placement, so other placements of the same record
 * stay unselected.
 */
export function useRecordSelection(
  placement: RecordPlacement | null,
  recordFieldName?: string,
): boolean {
  const owner = useContext(PreviewEditingOwnerContext);
  return useSelector(previewStore, (state) => {
    const sel = selectionForOwner(state.context, owner);
    if (!placement || !sel) return false;
    if (sel.type !== "record" && sel.type !== "record-field") return false;
    if (sel.blockId !== placement.blockId || sel.fieldName !== placement.fieldName) return false;
    if (sel.recordId !== placement.recordId) return false;
    if (recordFieldName === undefined) return sel.type === "record";
    return sel.type === "record-field" && sel.recordFieldName === recordFieldName;
  });
}
