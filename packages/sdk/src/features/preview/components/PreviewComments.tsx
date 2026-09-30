import { useSelector } from "@xstate/store-react";
import { createPortal } from "react-dom";

import { COMMENT_CURSOR_COLOR, COMMENT_CURSOR_PATH } from "../commentCursor";
import { previewStore, selectIsCommentMode } from "../previewStore";

// The bottom-left tip marks the click position, matching the comment bubble.
const commentCursor = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 32 32"><path d="${COMMENT_CURSOR_PATH}" fill="${COMMENT_CURSOR_COLOR}" stroke="white" stroke-width="2"/></svg>`,
)}") 1 23, crosshair`;

/**
 * Cursor only: editable components own semantic comment targets and the shared
 * sidebar owns threads. A frame disappearing must not reset another page's draft
 * or the studio mode.
 */
export function PreviewComments({ iframeElement }: { iframeElement: HTMLIFrameElement | null }) {
  const commenting = useSelector(previewStore, selectIsCommentMode);
  const doc = iframeElement?.contentDocument;

  if (!doc || !commenting) return null;

  return createPortal(
    <style>{`html, html * { cursor: ${commentCursor} !important; }`}</style>,
    doc.head,
  );
}
