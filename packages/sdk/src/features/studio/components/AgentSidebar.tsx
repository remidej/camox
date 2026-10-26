import { cn } from "../../../lib/utils";
import { SIDEBAR_GUTTER } from "../../preview/components/SidebarStack";
import { CMS_SIDEBAR_WIDTH } from "../../preview/previewConstants";
import { ChatWidget } from "./ChatWidget";
import { WorkersWidget } from "./WorkersWidget";

/**
 * The sidebar on the Canvas's right side, where editors work with Camox's agent: the Workers
 * widget over the Chat widget, which gets the larger share of the height. Laid over the Canvas,
 * as the Content Sidebar is over its left: only the cards have a background, and the Canvas shows
 * around them. Elsewhere in the studio it is only hidden, so the chat keeps its thread and the
 * Preview and Studio pages follow the editor's runs too.
 */
export function AgentSidebar({ hidden = false }: { hidden?: boolean }) {
  return (
    <aside
      aria-label="Agent"
      data-agent-sidebar
      hidden={hidden}
      className={cn(
        "absolute inset-y-0 right-0 z-10 flex flex-col gap-2 py-2 max-md:hidden",
        SIDEBAR_GUTTER,
      )}
      style={{ width: CMS_SIDEBAR_WIDTH }}
    >
      <WorkersWidget className="min-h-0 flex-[3_1_0]" />
      <ChatWidget className="min-h-0 flex-[7_1_0]" />
    </aside>
  );
}
