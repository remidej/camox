import { useSelector } from "@xstate/store-react";

import { previewStore } from "../../features/preview/previewStore";

/** Native hover, sidebar hover and comment pointing all drive the same overlay attributes. */
export function useOverlayState(target: string, hovered: boolean, focused = false) {
  const commentHover = useSelector(previewStore, (state) =>
    state.context.isCommentMode ? state.context.commentHoverTarget === target : null,
  );

  return {
    "data-camox-hovered": (commentHover ?? hovered) || undefined,
    "data-camox-focused": (commentHover === null && focused) || undefined,
  };
}
