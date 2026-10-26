import type * as React from "react";

import { CMS_SIDEBAR_WIDTH } from "../../preview/previewConstants";

/**
 * The Canvas sidebar's own box, beside the Canvas: the Canvas Navigator or the Canvas
 * Inspector, or a stand-in for either, goes in it.
 */
export function CanvasSidebarFrame({
  label,
  children,
  ...props
}: { label?: string; children: React.ReactNode } & React.ComponentProps<"aside">) {
  return (
    <aside
      aria-label={label}
      className="bg-background relative flex shrink-0 flex-col"
      style={{ width: CMS_SIDEBAR_WIDTH }}
      {...props}
    >
      {children}
    </aside>
  );
}
