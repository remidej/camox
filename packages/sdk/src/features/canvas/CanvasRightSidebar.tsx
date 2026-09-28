import { RightSidebar } from "../preview/components/RightSidebar";
import { PreviewEditingOwnerContext } from "../preview/previewSelection";
import type { CanvasPage } from "./canvasPages";

export function CanvasRightSidebar({ page }: { page: CanvasPage | undefined }) {
  if (!page) return null;

  // Canvas selects whole pages via the URL, never the preview's retained block.
  return (
    <PreviewEditingOwnerContext value={null}>
      <RightSidebar key={page.key} pageId={page.pageId} derivedLayoutId={page.layoutId} />
    </PreviewEditingOwnerContext>
  );
}
