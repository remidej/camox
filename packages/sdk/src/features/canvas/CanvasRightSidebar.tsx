import { useSelector } from "@xstate/store-react";

import { previewStore, selectIsCommentMode } from "../preview/previewStore";
import { CanvasChatSidebar } from "./CanvasChatSidebar";
import { CanvasFeedbackSidebar } from "./CanvasFeedbackSidebar";
import type { CanvasPage } from "./canvasPages";

/**
 * The Canvas's chat, or its feedback while commenting. Feedback is the selected
 * Page's, whatever is selected on it, or every Page's without one.
 */
export function CanvasRightSidebar({
  page,
  pages,
  blockSelected = false,
}: {
  page: CanvasPage | undefined;
  /** Every Page of the Canvas. */
  pages: readonly CanvasPage[];
  /** Whether a block of the Block Catalog is selected, which no feedback targets. */
  blockSelected?: boolean;
}) {
  const isCommentMode = useSelector(previewStore, selectIsCommentMode);
  if (!isCommentMode || blockSelected) return <CanvasChatSidebar />;

  return <CanvasFeedbackSidebar key={page?.key} page={page} pages={pages} />;
}
