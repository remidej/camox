import type { Comment, CommentTarget } from "@camox/api-contract";
import { toast } from "@camox/ui/toaster";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { blockQueries } from "@/lib/queries";

import { useCamoxApp } from "../provider/components/CamoxAppContext";
import {
  getCommentTargetFieldType,
  previewCommentsStore,
  revealCommentTarget,
} from "./previewCommentsStore";
import { previewStore } from "./previewStore";

export function useSelectComment(pageId: number) {
  const app = useCamoxApp();
  const queryClient = useQueryClient();

  return React.useCallback(
    async (comment: Pick<Comment, "id" | "target">) => {
      const { id, target } = comment;
      if (!target) return;

      const editingContext = previewStore.getSnapshot().context.editingContext;
      previewCommentsStore.send({ type: "selectComment", id });
      if (target.kind === "page") {
        revealCommentTarget(pageId, target);
        return;
      }

      try {
        const bundle = await queryClient.fetchQuery(blockQueries.get(target.blockId));
        if (previewCommentsStore.getSnapshot().context.activeId !== id) return;
        if (previewStore.getSnapshot().context.editingContext !== editingContext) return;
        if (
          "itemId" in target &&
          !bundle.repeatableItems.some((item) => item.id === target.itemId)
        ) {
          toast.error("This feedback target is no longer available.");
          return;
        }
        const fieldType = getCommentTargetFieldType(target, bundle, app);
        if (isFieldTarget(target) && !fieldType) {
          toast.error("This feedback field is no longer available.");
          return;
        }
        revealCommentTarget(pageId, target, fieldType);
      } catch {
        toast.error("This feedback target is no longer available.");
      }
    },
    [app, pageId, queryClient],
  );
}

function isFieldTarget(
  target: CommentTarget,
): target is Extract<CommentTarget, { kind: "block-field" | "item-field" }> {
  return target.kind === "block-field" || target.kind === "item-field";
}
