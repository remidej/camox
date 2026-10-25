import { formatShortcut } from "@/lib/shortcuts";

import { SidebarStackHeader, useSelectionViewCount } from "../../preview/components/SidebarStack";
import { SHOW_WHOLE_CANVAS_SHORTCUT } from "../../preview/previewConstants";

/**
 * The header of the Canvas's own view, the bottom of the sidebar's stack. Under a Page's
 * inspector, it leaves the selection and zooms out to the whole Canvas.
 */
export function CanvasViewHeader({
  covered,
  onShowWholeCanvas,
}: {
  /** Whether a Page's inspector is laid over the Canvas's view. */
  covered: boolean;
  onShowWholeCanvas?: () => void;
}) {
  // Under the Page's view, and every view the selection lays over it.
  const selectionViews = useSelectionViewCount();
  const distance = covered ? 1 + selectionViews : 0;
  return (
    <SidebarStackHeader
      first
      depth={0}
      distance={distance}
      onSelect={onShowWholeCanvas}
      tooltip={<>Show entire site {formatShortcut(SHOW_WHOLE_CANVAS_SHORTCUT)}</>}
    >
      {covered ? "Site" : <h2 className="truncate text-sm font-medium">Site</h2>}
    </SidebarStackHeader>
  );
}
