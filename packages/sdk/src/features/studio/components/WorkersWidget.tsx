import { cn } from "../../../lib/utils";
import { BOTTOM_CARD_EDGES, CARD_BODY_EDGES } from "../../preview/components/SidebarStack";

/** The Agent Sidebar's Workers widget, over the Chat widget. A placeholder for now. */
export function WorkersWidget({ className }: { className?: string }) {
  return (
    <section aria-label="Workers" data-workers-widget className={cn("flex flex-col", className)}>
      {/* A card like the Chat widget's, in height, edges and type. */}
      <header
        className={cn(
          "bg-background flex h-11 min-w-0 shrink-0 items-center justify-center px-3",
          BOTTOM_CARD_EDGES,
        )}
      >
        <h2 className="truncate text-sm font-medium">Workers</h2>
      </header>
      <div
        className={cn(
          "bg-background text-muted-foreground flex min-h-0 flex-1 items-center justify-center p-4 text-sm",
          CARD_BODY_EDGES,
        )}
      >
        No workers yet
      </div>
    </section>
  );
}
