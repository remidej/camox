import { createStore } from "@xstate/store-react";

import type { FieldType } from "@/core/lib/fieldTypes";

import { previewStore } from "./previewStore";

export type CommentTarget = {
  /** Omitted for page-level discussions. */
  blockId?: number;
  itemId?: number;
  fieldName?: string;
  fieldType?: FieldType;
  selector: string;
  label: string;
  x: number;
  y: number;
};

export function revealCommentTarget(target: CommentTarget) {
  previewStore.send({ type: "setCommentMode", enabled: false });
  previewStore.send({ type: "closeAddBlockSidebar" });
  previewStore.send({ type: "clearPeekedBlock" });
  if (target.blockId == null) {
    previewStore.send({ type: "setSelection", selection: null });
    return;
  }
  if (target.fieldName != null) {
    previewStore.send({
      type: "setSelection",
      selection:
        target.itemId == null
          ? {
              type: "block-field",
              blockId: target.blockId,
              fieldName: target.fieldName,
              fieldType: target.fieldType ?? "String",
            }
          : {
              type: "item-field",
              blockId: target.blockId,
              itemId: target.itemId,
              fieldName: target.fieldName,
              fieldType: target.fieldType ?? "String",
            },
    });
    return;
  }
  previewStore.send({
    type: "setSelection",
    selection:
      target.itemId == null
        ? { type: "block", blockId: target.blockId }
        : { type: "item", blockId: target.blockId, itemId: target.itemId },
  });
}
type Draft = { pageId: number; target: CommentTarget; message: string };
export type CommentAuthor = { name: string; image: string | null };
type Comment = Draft & { id: string; author: CommentAuthor; createdAt: number };

/** UI prototype only: comments live in memory, scoped to their originating page. */
export const previewCommentsStore = createStore({
  context: {
    comments: [] as Comment[],
    draft: null as Draft | null,
    activeId: null as string | null,
    focusTarget: null as CommentTarget | null,
  },
  on: {
    startComment: (
      context,
      event: { pageId: number; target: CommentTarget; focusComposer?: boolean },
    ) => ({
      ...context,
      draft: { pageId: event.pageId, target: event.target, message: "" },
      activeId: null,
      focusTarget: event.focusComposer ? event.target : null,
    }),
    composerFocused: (context) => ({ ...context, focusTarget: null }),
    setMessage: (context, event: { message: string }) => ({
      ...context,
      draft: context.draft ? { ...context.draft, message: event.message } : null,
    }),
    postComment: (context, event: { id: string; author: CommentAuthor; createdAt: number }) => {
      const draft = context.draft;
      if (!draft?.message.trim()) return context;
      return {
        ...context,
        comments: [
          ...context.comments,
          {
            ...draft,
            id: event.id,
            message: draft.message.trim(),
            author: event.author,
            createdAt: event.createdAt,
          },
        ],
        draft: null,
        activeId: event.id,
        focusTarget: null,
      };
    },
    selectComment: (context, event: { id: string }) => ({ ...context, activeId: event.id }),
    cancelDraft: (context) => ({ ...context, draft: null, focusTarget: null }),
    clearSelection: (context) => ({ ...context, draft: null, activeId: null, focusTarget: null }),
  },
});
