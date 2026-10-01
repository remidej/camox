import { useSelector } from "@xstate/store-react";
import { createPortal } from "react-dom";

import { COMMENT_CURSOR_STYLES } from "../commentCursor";
import { previewStore, selectIsCommentMode } from "../previewStore";

/**
 * Cursor only: editable components own semantic comment targets and the shared
 * sidebar owns threads. A frame disappearing must not reset another page's draft
 * or the studio mode.
 */
export function PreviewComments({ iframeElement }: { iframeElement: HTMLIFrameElement | null }) {
  const commenting = useSelector(previewStore, selectIsCommentMode);
  const doc = iframeElement?.contentDocument;

  if (!doc || !commenting) return null;

  return createPortal(<style>{COMMENT_CURSOR_STYLES}</style>, doc.head);
}
