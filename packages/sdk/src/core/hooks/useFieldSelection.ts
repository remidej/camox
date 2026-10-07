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
