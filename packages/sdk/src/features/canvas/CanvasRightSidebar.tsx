import { RightSidebar } from "../preview/components/RightSidebar";
import { PreviewEditingOwnerContext } from "../preview/previewSelection";
import type { EditingOwner } from "../preview/previewStore";
import type { CanvasPage } from "./canvasPages";

export function CanvasRightSidebar({
  page,
  owner = null,
}: {
  page: CanvasPage | undefined;
  owner?: EditingOwner | null;
}) {
  if (!page) return null;

  return (
    <PreviewEditingOwnerContext value={owner}>
      <RightSidebar key={page.key} pageId={page.pageId} derivedLayoutId={page.layoutId} />
    </PreviewEditingOwnerContext>
  );
}
