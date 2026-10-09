import { toast } from "@camox/ui/toaster";
import { createStore } from "@xstate/store-react";

import type { FieldType } from "@/core/lib/fieldTypes";

/* -------------------------------------------------------------------------------------------------
 * Selection — normalized, flat pointer to the currently selected entity
 * -------------------------------------------------------------------------------------------------
 * Instead of encoding a path, the selection points directly to the entity.
 * Selection path UI is derived by walking up the parent chain from the items map.
 * ------------------------------------------------------------------------------------------------*/

export type Selection =
  | { type: "block"; blockId: number }
  | { type: "item"; blockId: number; itemId: number }
  | { type: "block-field"; blockId: number; fieldName: string; fieldType: FieldType }
  | {
      type: "item-field";
      blockId: number;
      itemId: number;
      fieldName: string;
      fieldType: FieldType;
    }
  | ({ type: "record" } & RecordPlacement)
  | ({
      type: "record-field";
      recordFieldName: string;
      recordFieldType: FieldType;
    } & RecordPlacement);

/** A collection record placed by a reference field (one placement of the record). */
export type RecordPlacement = {
  blockId: number;
  /** The repeatable item whose reference field places the record, if not the block's own. */
  itemId?: number;
  /** The block's or item's reference field that places the record. */
  fieldName: string;
  recordId: string;
  /**
   * The second hop: the record that this placement's record links through one of its own
   * reference fields (an article's author). The selection then points to that record.
   */
  nested?: { fieldName: string; recordId: string };
};

/** Copies only a placement's identity, never the event or other selection fields. */
export function recordPlacement(placement: RecordPlacement): RecordPlacement {
  return {
    blockId: placement.blockId,
    ...(placement.itemId == null ? {} : { itemId: placement.itemId }),
    fieldName: placement.fieldName,
    recordId: placement.recordId,
    ...(placement.nested
      ? { nested: { fieldName: placement.nested.fieldName, recordId: placement.nested.recordId } }
      : {}),
  };
}

/** Whether two placements are the same occurrence: same block, item, field and record. */
export function samePlacement(a: RecordPlacement, b: RecordPlacement): boolean {
  return (
    a.blockId === b.blockId &&
    (a.itemId ?? null) === (b.itemId ?? null) &&
    a.fieldName === b.fieldName &&
    a.recordId === b.recordId &&
    a.nested?.fieldName === b.nested?.fieldName &&
    a.nested?.recordId === b.nested?.recordId
  );
}

/** Derived routes have no page row, but their persisted layout remains editable. */
export type EditingOwner = { kind: "page"; pageId: number } | { kind: "layout"; layoutId: number };
export type EditingContext = EditingOwner & { selection: Selection | null };

export function sameEditingOwner(a: EditingOwner | null, b: EditingOwner | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind === "page") return b.kind === "page" && a.pageId === b.pageId;
  return b.kind === "layout" && a.layoutId === b.layoutId;
}

function targetContext(owner: EditingOwner, selection: Selection | null): EditingContext {
  // Copy only the owner IDs, never the event or resolved content.
  if (owner.kind === "page") return { kind: "page", pageId: owner.pageId, selection };
  return { kind: "layout", layoutId: owner.layoutId, selection };
}

export function selectionForOwner(
  context: { editingContext: EditingContext | null },
  owner: EditingOwner | null,
): Selection | null {
  if (!sameEditingOwner(context.editingContext, owner)) return null;
  return context.editingContext?.selection ?? null;
}

/** Read a selection only in the page that contains the editor. */
export function selectionForPage(
  context: { editingContext: EditingContext | null },
  pageId: number | null,
): Selection | null {
  return selectionForOwner(context, pageId === null ? null : { kind: "page", pageId });
}

/** Extract the blockId from any selection variant. */
export function selectionBlockId(sel: Selection | null): number | null {
  return sel?.blockId ?? null;
}

/** Extract the itemId from item and item-field selections, and records placed by an item. */
export function selectionItemId(sel: Selection | null): number | null {
  if (!sel) return null;
  if (sel.type === "item" || sel.type === "item-field") return sel.itemId;
  if (sel.type === "record" || sel.type === "record-field") return sel.itemId ?? null;
  return null;
}

/** Check if the selection is viewing a terminal field (link, image, file, etc.). */
export function selectionField(
  sel: Selection | null,
): { fieldName: string; fieldType: FieldType } | null {
  if (!sel) return null;
  if (sel.type === "block-field" || sel.type === "item-field") {
    return { fieldName: sel.fieldName, fieldType: sel.fieldType };
  }
  return null;
}

/**
 * Which side of the draft/publish split the studio is currently previewing.
 * 'draft' (default) shows in-flight editor changes; 'live' shows visitors'
 * view (the page's live published checkpoint snapshot).
 */
export type PreviewSource = "draft" | "live";
export type PreviewMode =
  | "editing-draft"
  | "commenting-draft"
  | "previewing-draft"
  | "previewing-live";

export const selectIsCommentMode = (state: { context: { mode: PreviewMode } }) =>
  state.context.mode === "commenting-draft";

/** Commenting is a draft-only editing submode. */
export const selectIsEditMode = (state: { context: { mode: PreviewMode } }) =>
  state.context.mode === "editing-draft" || selectIsCommentMode(state);

export const selectPreviewSource = (state: { context: { mode: PreviewMode } }): PreviewSource =>
  state.context.mode === "previewing-live" ? "live" : "draft";
export type ViewportMode = "full" | "tablet" | "mobile";

interface PreviewContext {
  mode: PreviewMode;
  isToolbarHidden: boolean;
  addBlockDialog: { afterPosition?: string | null } | null;
  isCreatePageModalOpen: boolean;
  editingPageId: number | null;
  viewportMode: ViewportMode;
  editingContext: EditingContext | null;
  iframeElement: HTMLIFrameElement | null;
}

const initialPreviewContext: PreviewContext = {
  mode: "previewing-draft",
  isToolbarHidden: false,
  addBlockDialog: null,
  isCreatePageModalOpen: false,
  editingPageId: null,
  viewportMode: "full",
  editingContext: null,
  iframeElement: null,
};

export const previewStore = createStore({
  context: initialPreviewContext,
  on: {
    /** Leaving the preview discards its session; returning starts fresh. */
    reset: () => initialPreviewContext,
    setCommentMode: (context, event: { enabled: boolean }) => {
      if (!selectIsEditMode({ context })) return context;
      const commenting = event.enabled;
      return {
        ...context,
        mode: commenting ? ("commenting-draft" as const) : ("editing-draft" as const),
        editingContext:
          commenting && context.editingContext
            ? { ...context.editingContext, selection: null }
            : context.editingContext,
      };
    },
    exitEditMode: (context) => {
      if (!selectIsEditMode({ context })) return context;
      return {
        ...context,
        mode: "previewing-draft" as const,
      };
    },
    enterEditMode: (context) => {
      if (selectIsEditMode({ context })) return context;
      return {
        ...context,
        mode: "editing-draft" as const,
        isToolbarHidden: false,
      };
    },
    hideToolbar: (context) => ({ ...context, isToolbarHidden: true }),
    viewLiveSite: (context, _, enqueue) => {
      enqueue.effect(() => {
        toast("Viewing live version of the site");
      });
      return {
        ...context,
        mode: "previewing-live" as const,
        isToolbarHidden: true,
      };
    },
    setViewportMode: (context, event: { mode: ViewportMode }) => {
      if (context.viewportMode === event.mode) return context;
      return { ...context, viewportMode: event.mode };
    },
    cycleViewportMode: (context) => {
      const nextMode: ViewportMode =
        context.viewportMode === "full"
          ? "tablet"
          : context.viewportMode === "tablet"
            ? "mobile"
            : "full";
      return { ...context, viewportMode: nextMode };
    },
    /* --- Selection events --- */

    activatePage: (context, event: { pageId: number | null }) => {
      const owner: EditingOwner | null =
        event.pageId === null ? null : { kind: "page", pageId: event.pageId };
      if (sameEditingOwner(context.editingContext, owner)) return context;
      return {
        ...context,
        editingContext: owner ? targetContext(owner, null) : null,
        addBlockDialog: null,
      };
    },
    activateLayout: (context, event: { layoutId: number }) => {
      const owner: EditingOwner = { kind: "layout", layoutId: event.layoutId };
      if (sameEditingOwner(context.editingContext, owner)) return context;
      return {
        ...context,
        editingContext: targetContext(owner, null),
        addBlockDialog: null,
      };
    },
    selectTarget: (context, event: EditingContext) => ({
      ...context,
      editingContext: targetContext(event, event.selection),
    }),
    setFocusedBlock: (context, event: EditingOwner & { blockId: number }) => ({
      ...context,
      editingContext: targetContext(event, { type: "block", blockId: event.blockId }),
      addBlockDialog: null,
    }),
    selectItem: (context, event: EditingOwner & { blockId: number; itemId: number }) => ({
      ...context,
      editingContext: targetContext(event, {
        type: "item",
        blockId: event.blockId,
        itemId: event.itemId,
      }),
    }),
    selectBlockField: (
      context,
      event: EditingOwner & { blockId: number; fieldName: string; fieldType: FieldType },
    ) => ({
      ...context,
      editingContext: targetContext(event, {
        type: "block-field" as const,
        blockId: event.blockId,
        fieldName: event.fieldName,
        fieldType: event.fieldType,
      }),
    }),
    selectItemField: (
      context,
      event: EditingOwner & {
        blockId: number;
        itemId: number;
        fieldName: string;
        fieldType: FieldType;
      },
    ) => ({
      ...context,
      editingContext: targetContext(event, {
        type: "item-field" as const,
        blockId: event.blockId,
        itemId: event.itemId,
        fieldName: event.fieldName,
        fieldType: event.fieldType,
      }),
    }),
    selectRecord: (context, event: EditingOwner & RecordPlacement) => ({
      ...context,
      editingContext: targetContext(event, { type: "record" as const, ...recordPlacement(event) }),
    }),
    selectRecordField: (
      context,
      event: EditingOwner &
        RecordPlacement & { recordFieldName: string; recordFieldType: FieldType },
    ) => ({
      ...context,
      editingContext: targetContext(event, {
        type: "record-field" as const,
        ...recordPlacement(event),
        recordFieldName: event.recordFieldName,
        recordFieldType: event.recordFieldType,
      }),
    }),
    selectParent: (context) => {
      const editingContext = context.editingContext;
      const sel = editingContext?.selection;
      if (!sel) return context;
      if (sel.type === "record-field") {
        return {
          ...context,
          editingContext: {
            ...editingContext,
            selection: { type: "record" as const, ...recordPlacement(sel) },
          },
        };
      }
      if (sel.type === "record" && sel.nested) {
        // A linked record steps up to the reference field of the record that links it.
        const { nested: _nested, ...outer } = recordPlacement(sel);
        return {
          ...context,
          editingContext: {
            ...editingContext,
            selection: {
              type: "record-field" as const,
              ...outer,
              recordFieldName: sel.nested.fieldName,
              recordFieldType: "Reference" as const,
            },
          },
        };
      }
      if (sel.type === "record") {
        // The reference field that places the record, in its block or repeatable item.
        const field = { fieldName: sel.fieldName, fieldType: "Reference" as const };
        return {
          ...context,
          editingContext: {
            ...editingContext,
            selection:
              sel.itemId == null
                ? { type: "block-field" as const, blockId: sel.blockId, ...field }
                : {
                    type: "item-field" as const,
                    blockId: sel.blockId,
                    itemId: sel.itemId,
                    ...field,
                  },
          },
        };
      }
      if (sel.type === "block-field") {
        return {
          ...context,
          editingContext: {
            ...editingContext,
            selection: { type: "block" as const, blockId: sel.blockId },
          },
        };
      }
      if (sel.type === "item-field") {
        return {
          ...context,
          editingContext: {
            ...editingContext,
            selection: { type: "item" as const, blockId: sel.blockId, itemId: sel.itemId },
          },
        };
      }
      if (sel.type === "item") {
        return {
          ...context,
          editingContext: {
            ...editingContext,
            selection: { type: "block" as const, blockId: sel.blockId },
          },
        };
      }
      return context;
    },
    clearSelection: (context) => ({
      ...context,
      editingContext: context.editingContext
        ? { ...context.editingContext, selection: null }
        : null,
    }),
    openAddBlockDialog: (context, event: { afterPosition?: string | null }) => ({
      ...context,
      addBlockDialog: { afterPosition: event.afterPosition },
    }),
    closeAddBlockDialog: (context) => ({
      ...context,
      addBlockDialog: null,
    }),
    focusCreatedBlock: (context, event: EditingOwner & { blockId: number }) => ({
      ...context,
      editingContext: targetContext(event, { type: "block", blockId: event.blockId }),
      addBlockDialog: null,
    }),
    openCreatePageModal: (context) => ({
      ...context,
      isCreatePageModalOpen: true,
    }),
    closeCreatePageModal: (context) => ({
      ...context,
      isCreatePageModalOpen: false,
    }),
    openEditPageModal: (context, event: { pageId: number }) => {
      if (context.editingPageId === event.pageId) return context;
      return { ...context, editingPageId: event.pageId };
    },
    closeEditPageModal: (context) => ({
      ...context,
      editingPageId: null,
    }),
    setIframeElement: (context, event: { element: HTMLIFrameElement | null }) => ({
      ...context,
      iframeElement: event.element,
    }),
    viewDraftSite: (context, _, enqueue) => {
      if (context.mode !== "previewing-live") return context;
      enqueue.effect(() => {
        toast("Previewing draft content", { duration: 2500 });
      });
      return {
        ...context,
        mode: "previewing-draft" as const,
        isToolbarHidden: false,
      };
    },
  },
});
