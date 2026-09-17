import { useSelector } from "@xstate/store-react";
import * as React from "react";
import { createPortal } from "react-dom";

import { previewCommentsStore } from "../previewCommentsStore";
import { previewStore, selectIsCommentMode, selectIsEditMode } from "../previewStore";

// The bottom-left tip marks the click position, matching the comment bubble.
const commentCursor = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M16 1a15 15 0 0 1 0 30H1V16A15 15 0 0 1 16 1Z" fill="#2563eb" stroke="white" stroke-width="2"/><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" transform="translate(8 8) scale(.625)" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
)}") 1 31, crosshair`;

/** Comment mode lifecycle and cursor. Editable components handle selection and clicks. */
export function PreviewComments() {
  const iframe = useSelector(previewStore, (state) => state.context.iframeElement);
  const editing = useSelector(previewStore, selectIsEditMode);
  const commenting = useSelector(previewStore, selectIsCommentMode);
  const doc = iframe?.contentDocument;

  React.useEffect(
    () => () => {
      previewStore.send({ type: "setCommentMode", enabled: false });
      previewCommentsStore.send({ type: "clearSelection" });
    },
    [],
  );

  React.useEffect(() => {
    if (!editing) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      previewStore.send({ type: "setCommentMode", enabled: false });
    };
    doc?.addEventListener("keydown", escape);
    document.addEventListener("keydown", escape);
    return () => {
      doc?.removeEventListener("keydown", escape);
      document.removeEventListener("keydown", escape);
    };
  }, [doc, editing]);

  if (!doc || !commenting) return null;

  return createPortal(
    <style>{`html, html * { cursor: ${commentCursor} !important; }`}</style>,
    doc.head,
  );
}
