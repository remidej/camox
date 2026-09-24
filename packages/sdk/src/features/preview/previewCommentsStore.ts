import type { Comment, CommentTarget } from "@camox/api-contract";
import { createStore } from "@xstate/store-react";

import type { CamoxApp } from "@/core/createApp";
import { fieldTypesDictionary, type FieldType } from "@/core/lib/fieldTypes";
import type { BlockBundle } from "@/lib/queries";

import { previewStore } from "./previewStore";

export type { CommentTarget } from "@camox/api-contract";
export type CommentAuthor = Comment["author"];
export type CommentDraft = { id: string; pageId: number; target: CommentTarget; message: string };

type FieldSchema = {
  properties?: Record<string, FieldSchema>;
  items?: FieldSchema;
  fieldType?: string;
};

/** Resolve against the current definition, including nested repeater ancestry. */
export function getCommentTargetFieldType(
  target: CommentTarget,
  bundle: BlockBundle,
  app: CamoxApp,
): FieldType | undefined {
  if (target.kind !== "block-field" && target.kind !== "item-field") return;
  if (bundle.block.id !== target.blockId) return;
  let schema = app.getBlockById(bundle.block.type)?._internal.contentSchema as
    | FieldSchema
    | undefined;
  if (target.kind === "item-field") {
    const path: string[] = [];
    const visited = new Set<number>();
    let itemId: number | null = target.itemId;
    while (itemId != null) {
      if (visited.has(itemId)) return;
      visited.add(itemId);
      const item = bundle.repeatableItems.find((entry) => entry.id === itemId);
      if (!item) return;
      path.unshift(item.fieldName);
      itemId = item.parentItemId;
    }
    for (const fieldName of path) schema = schema?.properties?.[fieldName]?.items;
  }
  const fieldType = schema?.properties?.[target.fieldName]?.fieldType;
  if (fieldType && Object.hasOwn(fieldTypesDictionary, fieldType)) return fieldType as FieldType;
}

/** Field types belong to the current app, never to persisted comment targets. */
export function revealCommentTarget(target: CommentTarget, fieldType?: FieldType) {
  previewStore.send({ type: "setCommentMode", enabled: false });
  previewStore.send({ type: "closeAddBlockSidebar" });
  previewStore.send({ type: "clearPeekedBlock" });
  if (target.kind === "page") {
    previewStore.send({ type: "setSelection", selection: null });
    return;
  }
  if ((target.kind === "block-field" || target.kind === "item-field") && fieldType) {
    previewStore.send({
      type: "setSelection",
      selection:
        target.kind === "item-field"
          ? {
              type: "item-field",
              blockId: target.blockId,
              itemId: target.itemId,
              fieldName: target.fieldName,
              fieldType,
            }
          : {
              type: "block-field",
              blockId: target.blockId,
              fieldName: target.fieldName,
              fieldType,
            },
    });
    return;
  }
  previewStore.send({
    type: "setSelection",
    selection:
      "itemId" in target
        ? { type: "item", blockId: target.blockId, itemId: target.itemId }
        : { type: "block", blockId: target.blockId },
  });
}

/** Server comments belong to the query cache; this store holds composer UI only. */
export const previewCommentsStore = createStore({
  context: {
    draft: null as CommentDraft | null,
    activeId: null as string | null,
    focusTarget: null as CommentTarget | null,
  },
  on: {
    startComment: (
      context,
      event: { pageId: number; target: CommentTarget; focusComposer?: boolean },
    ) => ({
      ...context,
      draft: { id: crypto.randomUUID(), pageId: event.pageId, target: event.target, message: "" },
      activeId: null,
      focusTarget: event.focusComposer ? event.target : null,
    }),
    composerFocused: (context) => ({ ...context, focusTarget: null }),
    setMessage: (context, event: { message: string }) => {
      if (!context.draft || context.draft.message === event.message) return context;
      return {
        ...context,
        draft: { ...context.draft, id: crypto.randomUUID(), message: event.message },
      };
    },
    postSucceeded: (context, event: { draft: CommentDraft }) => {
      if (context.draft?.id !== event.draft.id) return context;
      return { ...context, draft: null, activeId: event.draft.id, focusTarget: null };
    },
    selectComment: (context, event: { id: string }) => ({ ...context, activeId: event.id }),
    cancelDraft: (context) => ({ ...context, draft: null, focusTarget: null }),
    clearSelection: (context) => ({ ...context, draft: null, activeId: null, focusTarget: null }),
  },
});
