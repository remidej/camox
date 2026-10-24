import { createStore } from "@xstate/store-react";

import type { FieldType } from "@/core/lib/fieldTypes";

/* -------------------------------------------------------------------------------------------------
 * Selection — normalized, flat pointer to the currently selected entity
 * -------------------------------------------------------------------------------------------------
 * Instead of encoding a path, the selection points directly to the entity.
 * Selection path UI is derived by walking up the parent chain from the items map.
 * ------------------------------------------------------------------------------------------------*/

export type Selection =
  | { type: "block"; blockId: string }
  | { type: "item"; blockId: string; itemId: string }
  | { type: "block-field"; blockId: string; fieldName: string; fieldType: FieldType }
  | {
      type: "item-field";
      blockId: string;
      itemId: string;
      fieldName: string;
      fieldType: FieldType;
    }
  | ({ type: "record" } & RecordPlacement)
  | ({
      type: "record-field";
      recordFieldName: string;
      recordFieldType: FieldType;
    } & RecordPlacement);

/**
 * Where one placement of a collection record occurs. A block's or repeatable item's reference
 * field places it, or a layout renders it as the record of a record page.
 */
export type RecordPlacement = BlockRecordPlacement | LayoutRecordPlacement;

type LinkedRecord = {
  /**
   * The second hop: the record that this placement's record links through one of its own
   * reference fields (an article's author). The selection then points to that record.
   */
  nested?: { fieldName: string; recordId: string };
};

/** A collection record placed by a reference field of a block or repeatable item. */
export type BlockRecordPlacement = LinkedRecord & {
  blockId: string;
  /** The repeatable item whose reference field places the record, if not the block's own. */
  itemId?: string;
  /** The block's or item's reference field that places the record. */
  fieldName: string;
  recordId: string;
};

/** The record a layout renders on one of its record pages, placed by no block. */
export type LayoutRecordPlacement = LinkedRecord & { layoutId: string; recordId: string };

/**
 * The block id of what no block places, like a record page's record: it equals no id, itself
 * included, so no block field or selection ever matches it.
 */
export const NO_BLOCK_ID = "";

/**
 * Whether a block places the record. Checks `blockId` rather than `layoutId`, because editing
 * events spread a layout editing owner's `layoutId` next to block-owned placements.
 */
export function isBlockPlacement(placement: RecordPlacement): placement is BlockRecordPlacement {
  return "blockId" in placement && placement.blockId != null;
}

function copyNested(placement: RecordPlacement) {
  if (!placement.nested) return {};
  return { nested: { fieldName: placement.nested.fieldName, recordId: placement.nested.recordId } };
}

/** Copies only a placement's identity, never the event or other selection fields. */
export function recordPlacement(placement: BlockRecordPlacement): BlockRecordPlacement;
export function recordPlacement(placement: RecordPlacement): RecordPlacement;
export function recordPlacement(placement: RecordPlacement): RecordPlacement {
  if (!isBlockPlacement(placement)) {
    return { layoutId: placement.layoutId, recordId: placement.recordId, ...copyNested(placement) };
  }
  return {
    blockId: placement.blockId,
    ...(placement.itemId == null ? {} : { itemId: placement.itemId }),
    fieldName: placement.fieldName,
    recordId: placement.recordId,
    ...copyNested(placement),
  };
}

/** Whether two placements are the same occurrence: same owner, field and record. */
export function samePlacement(a: RecordPlacement, b: RecordPlacement): boolean {
  if (a.recordId !== b.recordId) return false;
  if (a.nested?.fieldName !== b.nested?.fieldName) return false;
  if (a.nested?.recordId !== b.nested?.recordId) return false;
  if (!isBlockPlacement(a)) return !isBlockPlacement(b) && a.layoutId === b.layoutId;
  if (!isBlockPlacement(b)) return false;
  return (
    a.blockId === b.blockId &&
    (a.itemId ?? null) === (b.itemId ?? null) &&
    a.fieldName === b.fieldName
  );
}

/** Derived routes have no page row, but their persisted layout remains editable. */
export type EditingOwner = { kind: "page"; pageId: string } | { kind: "layout"; layoutId: string };
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
  pageId: string | null,
): Selection | null {
  return selectionForOwner(context, pageId === null ? null : { kind: "page", pageId });
}

/** A selection that belongs to a block: anything but a record a layout places. */
export type BlockSelection =
  | Exclude<Selection, { type: "record" | "record-field" }>
  | BlockRecordSelection;
type BlockRecordSelection = Extract<Selection, { type: "record" | "record-field" }> &
  BlockRecordPlacement;

/** Narrows to selections inside a block, excluding records placed by a layout. */
export function isBlockSelection(sel: Selection | null): sel is BlockSelection {
  if (!sel) return false;
  if (sel.type === "record" || sel.type === "record-field") return isBlockPlacement(sel);
  return true;
}

/** Extract the blockId from any selection variant; null for a record a layout places. */
export function selectionBlockId(sel: Selection | null): string | null {
  if (!isBlockSelection(sel)) return null;
  return sel.blockId;
}

/** Extract the itemId from item and item-field selections, and records placed by an item. */
export function selectionItemId(sel: Selection | null): string | null {
  if (!isBlockSelection(sel)) return null;
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

export type WebsiteView = "canvas" | "preview";

export const selectIsCanvasShown = (state: { context: { view: WebsiteView } }) =>
  state.context.view === "canvas";

export type ViewportMode = "full" | "tablet" | "mobile";

interface PreviewContext {
  view: WebsiteView;
  isToolbarHidden: boolean;
  addBlockSheet: { afterPosition?: string | null } | null;
  isCreatePageModalOpen: boolean;
  editingPageId: string | null;
  viewportMode: ViewportMode;
  editingContext: EditingContext | null;
}

const initialPreviewContext: PreviewContext = {
  view: "preview",
  isToolbarHidden: false,
  addBlockSheet: null,
  isCreatePageModalOpen: false,
  editingPageId: null,
  viewportMode: "full",
  editingContext: null,
};

export const previewStore = createStore({
  context: initialPreviewContext,
  on: {
    /** Starts over, as a new Studio session does. */
    reset: () => initialPreviewContext,
    /** Takes the studio's state, in the renderer frame's document: only its connection sends it. */
    mirror: (_, event: { context: PreviewContext }) => event.context,
    hideCanvas: (context) => {
      if (!selectIsCanvasShown({ context })) return context;
      return {
        ...context,
        view: "preview" as const,
      };
    },
    showCanvas: (context) => {
      if (selectIsCanvasShown({ context })) return context;
      return {
        ...context,
        view: "canvas" as const,
        isToolbarHidden: false,
      };
    },
    hideToolbar: (context) => ({ ...context, isToolbarHidden: true }),
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

    activatePage: (context, event: { pageId: string | null }) => {
      const owner: EditingOwner | null =
        event.pageId === null ? null : { kind: "page", pageId: event.pageId };
      if (sameEditingOwner(context.editingContext, owner)) return context;
      return {
        ...context,
        editingContext: owner ? targetContext(owner, null) : null,
        addBlockSheet: null,
      };
    },
    activateLayout: (context, event: { layoutId: string }) => {
      const owner: EditingOwner = { kind: "layout", layoutId: event.layoutId };
      if (sameEditingOwner(context.editingContext, owner)) return context;
      return {
        ...context,
        editingContext: targetContext(owner, null),
        addBlockSheet: null,
      };
    },
    selectTarget: (context, event: EditingContext) => ({
      ...context,
      editingContext: targetContext(event, event.selection),
    }),
    setFocusedBlock: (context, event: EditingOwner & { blockId: string }) => ({
      ...context,
      editingContext: targetContext(event, { type: "block", blockId: event.blockId }),
      addBlockSheet: null,
    }),
    selectItem: (context, event: EditingOwner & { blockId: string; itemId: string }) => ({
      ...context,
      editingContext: targetContext(event, {
        type: "item",
        blockId: event.blockId,
        itemId: event.itemId,
      }),
    }),
    selectBlockField: (
      context,
      event: EditingOwner & { blockId: string; fieldName: string; fieldType: FieldType },
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
        blockId: string;
        itemId: string;
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
      // A record page's record is the root of its layout's selection path.
      if (sel.type === "record" && !isBlockPlacement(sel)) return context;
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
    openAddBlockSheet: (context, event: { afterPosition?: string | null }) => ({
      ...context,
      addBlockSheet: { afterPosition: event.afterPosition },
    }),
    closeAddBlockSheet: (context) => ({
      ...context,
      addBlockSheet: null,
    }),
    focusCreatedBlock: (context, event: EditingOwner & { blockId: string }) => ({
      ...context,
      editingContext: targetContext(event, { type: "block", blockId: event.blockId }),
      addBlockSheet: null,
    }),
    openCreatePageModal: (context) => ({
      ...context,
      isCreatePageModalOpen: true,
    }),
    closeCreatePageModal: (context) => ({
      ...context,
      isCreatePageModalOpen: false,
    }),
    openEditPageModal: (context, event: { pageId: string }) => {
      if (context.editingPageId === event.pageId) return context;
      return { ...context, editingPageId: event.pageId };
    },
    closeEditPageModal: (context) => ({
      ...context,
      editingPageId: null,
    }),
  },
});
