import { Skeleton } from "@camox/ui/skeleton";
import type * as React from "react";

import { SidebarStackHeader } from "../../preview/components/SidebarStack";

/*
 * The Canvas Inspector: the Canvas sidebar's view of a selected Canvas item, laid over the
 * Canvas's own view. Each kind of item composes these pieces: a header with the item's name,
 * then a body with the item's own content.
 */

/** Stands in for the header while the item loads, in its layout, so nothing shifts. */
export function CanvasInspectorHeaderSkeleton() {
  return (
    <SidebarStackHeader>
      <Skeleton className="h-4 w-28" />
    </SidebarStackHeader>
  );
}

export function CanvasInspectorTitle({ children }: { children: string }) {
  return <h2 className="truncate text-sm font-medium">{children}</h2>;
}

export function CanvasInspectorBody({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col">{children}</div>;
}
