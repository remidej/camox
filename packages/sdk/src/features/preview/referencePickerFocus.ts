import { createStore, useSelector } from "@xstate/store-react";

/**
 * One-shot request from the preview (an unset reference placeholder) to focus the record
 * picker of that placement in the sidebar. Keyed by the placement's overlay field ID
 * (`${blockId}__${fieldName}`), which the preview and sidebar already share.
 */
export const referencePickerFocus = createStore({
  context: { fieldId: null as string | null },
  on: {
    request: (_context, event: { fieldId: string }) => ({ fieldId: event.fieldId }),
    consume: (context, event: { fieldId: string }) =>
      context.fieldId === event.fieldId ? { fieldId: null } : context,
  },
});

export function useReferencePickerFocusRequested(fieldId: string | undefined) {
  return useSelector(
    referencePickerFocus,
    (state) => fieldId !== undefined && state.context.fieldId === fieldId,
  );
}
