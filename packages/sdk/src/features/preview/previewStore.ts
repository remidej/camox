import { toast } from "@camox/ui/toaster";
import { createStore } from "@xstate/store-react";

import { Block } from "@/core/createBlock";
import type { FieldType } from "@/core/lib/fieldTypes";
import { trackClientEvent } from "@/lib/telemetry-client";

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
    };

/** Extract the blockId from any selection variant. */
export function selectionBlockId(sel: Selection | null): number | null {
  return sel?.blockId ?? null;
}

/** Extract the itemId from item or item-field selections. */
export function selectionItemId(sel: Selection | null): number | null {
  if (!sel) return null;
  if (sel.type === "item" || sel.type === "item-field") return sel.itemId;
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
export type PreviewMode = "editing-draft" | "previewing-draft" | "previewing-live";

export const selectIsEditMode = (state: { context: { mode: PreviewMode } }) =>
  state.context.mode === "editing-draft";

export const selectPreviewSource = (state: { context: { mode: PreviewMode } }): PreviewSource =>
  state.context.mode === "previewing-live" ? "live" : "draft";
export type ViewportMode = "full" | "tablet" | "mobile";

interface PreviewContext {
  mode: PreviewMode;
  isToolbarHidden: boolean;
  isPageEditorSidebarOpen: boolean;
  isAddBlockSidebarOpen: boolean;
  /** Source label for the in-progress add-block flow (popover, shortcut, page-tree, overlay). */
  addBlockSource: string | null;
  isCreatePageModalOpen: boolean;
  editingPageId: number | null;
  viewportMode: ViewportMode;
  peekedBlock: Block | null;
  peekedBlockPosition: string | null;
  skipPeekedBlockExitAnimation: boolean;
  selection: Selection | null;
  iframeElement: HTMLIFrameElement | null;
}

export const previewStore = createStore({
  context: {
    mode: "previewing-draft",
    isToolbarHidden: false,
    isPageEditorSidebarOpen: false,
    isAddBlockSidebarOpen: false,
    addBlockSource: null,
    isCreatePageModalOpen: false,
    editingPageId: null,
    viewportMode: "full",
    peekedBlock: null,
    peekedBlockPosition: null,
    skipPeekedBlockExitAnimation: false,
    selection: null,
    iframeElement: null,
  } as PreviewContext,
  on: {
    exitEditMode: (context, _, enqueue) => {
      if (context.mode !== "editing-draft") return context;
      enqueue.effect(() => {
        trackClientEvent("edit_mode_toggled", { enabled: false });
      });
      return { ...context, mode: "previewing-draft" as const };
    },
    enterEditMode: (context, _, enqueue) => {
      if (context.mode === "editing-draft") return context;
      enqueue.effect(() => {
        trackClientEvent("edit_mode_toggled", { enabled: true });
      });
      return {
        ...context,
        mode: "editing-draft" as const,
        isToolbarHidden: false,
      };
    },
    hideToolbar: (context) => ({ ...context, isToolbarHidden: true }),
    viewLivePage: (context, _, enqueue) => {
      enqueue.effect(() => {
        if (context.mode === "editing-draft") {
          trackClientEvent("edit_mode_toggled", { enabled: false });
        }
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
    setPeekedBlock: (context, event: { block: Block; afterPosition?: string | null }) => {
      if (!event.block) return context;
      return {
        ...context,
        peekedBlock: event.block,
        peekedBlockPosition: event.afterPosition ?? null,
      };
    },
    exitPeekedBlock: (context) => ({
      ...context,
      peekedBlock: null,
      peekedBlockPosition: null,
      isAddBlockSidebarOpen: false,
    }),
    clearPeekedBlock: (context) => ({
      ...context,
      peekedBlock: null,
      peekedBlockPosition: null,
    }),

    /* --- Selection events --- */

    setSelection: (context, event: { selection: Selection | null }) => ({
      ...context,
      selection: event.selection,
    }),
    setFocusedBlock: (context, event: { blockId: number }) => ({
      ...context,
      selection: { type: "block" as const, blockId: event.blockId },
      peekedBlock: null,
      peekedBlockPosition: null,
      isAddBlockSidebarOpen: false,
    }),
    selectItem: (context, event: { blockId: number; itemId: number }) => ({
      ...context,
      selection: { type: "item" as const, blockId: event.blockId, itemId: event.itemId },
    }),
    selectBlockField: (
      context,
      event: { blockId: number; fieldName: string; fieldType: FieldType },
    ) => ({
      ...context,
      selection: {
        type: "block-field" as const,
        blockId: event.blockId,
        fieldName: event.fieldName,
        fieldType: event.fieldType,
      },
    }),
    selectItemField: (
      context,
      event: { blockId: number; itemId: number; fieldName: string; fieldType: FieldType },
    ) => ({
      ...context,
      selection: {
        type: "item-field" as const,
        blockId: event.blockId,
        itemId: event.itemId,
        fieldName: event.fieldName,
        fieldType: event.fieldType,
      },
    }),
    selectParent: (context) => {
      const sel = context.selection;
      if (!sel) return context;
      if (sel.type === "block-field") {
        return { ...context, selection: { type: "block" as const, blockId: sel.blockId } };
      }
      if (sel.type === "item-field") {
        return {
          ...context,
          selection: { type: "item" as const, blockId: sel.blockId, itemId: sel.itemId },
        };
      }
      if (sel.type === "item") {
        return { ...context, selection: { type: "block" as const, blockId: sel.blockId } };
      }
      return context;
    },
    clearSelection: (context) => ({
      ...context,
      selection: null,
    }),
    openAddBlockSidebar: (context, event: { afterPosition?: string | null; via?: string }) => ({
      ...context,
      isAddBlockSidebarOpen: true,
      addBlockSource: event.via ?? null,
      peekedBlock: null,
      peekedBlockPosition: event.afterPosition ?? null,
    }),
    closeAddBlockSidebar: (context) => ({
      ...context,
      isAddBlockSidebarOpen: false,
      addBlockSource: null,
      peekedBlock: null,
      peekedBlockPosition: null,
    }),
    focusCreatedBlock: (context, event: { blockId: number }) => ({
      ...context,
      selection: { type: "block" as const, blockId: event.blockId },
      isAddBlockSidebarOpen: false,
      peekedBlock: null,
      peekedBlockPosition: null,
      skipPeekedBlockExitAnimation: true,
    }),
    clearSkipPeekedBlockExitAnimation: (context) => ({
      ...context,
      skipPeekedBlockExitAnimation: false,
    }),
    toggleContentSheet: (context) => ({
      ...context,
      isPageEditorSidebarOpen: false,
    }),
    openBlockContentSheet: (context, event: { blockId: number }) => {
      const currentBlockMatches = context.selection?.blockId === event.blockId;
      return {
        ...context,
        isPageEditorSidebarOpen: false,
        selection: currentBlockMatches
          ? context.selection
          : { type: "block" as const, blockId: event.blockId },
      };
    },
    closeBlockContentSheet: (context) => ({
      ...context,
      isPageEditorSidebarOpen: false,
    }),
    openCreatePageModal: (context) => ({
      ...context,
      isCreatePageModalOpen: true,
    }),
    closeCreatePageModal: (context) => ({
      ...context,
      isCreatePageModalOpen: false,
    }),
    openEditPageModal: (context, event: { pageId: number }, enqueue) => {
      if (context.editingPageId === event.pageId) return context;
      enqueue.effect(() => trackClientEvent("page_editor_opened", { pageId: event.pageId }));
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
    viewDraftPage: (context, _, enqueue) => {
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
