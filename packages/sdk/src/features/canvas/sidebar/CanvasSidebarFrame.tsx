import type * as React from "react";

import { CMS_SIDEBAR_WIDTH } from "../../preview/previewConstants";

/**
 * The Canvas sidebar's own box, laid over the Canvas's left side: the Canvas Navigator or the
 * Canvas Inspector, or a stand-in for either, goes in it. Only its cards have a background:
 * around them, the Canvas shows through.
 */
export function CanvasSidebarFrame({
  label,
  children,
  ...props
}: { label?: string; children: React.ReactNode } & React.ComponentProps<"aside">) {
  return (
    <aside
      aria-label={label}
      className="absolute inset-y-0 left-0 z-10 flex flex-col py-2"
      style={{ width: CMS_SIDEBAR_WIDTH }}
      {...props}
    >
      {children}
    </aside>
  );
}
