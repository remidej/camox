import { Badge } from "@camox/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@camox/ui/tooltip";
import * as React from "react";

import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------------------------------
 * PageStatusBadge — Draft / Published / Modified indicator
 * -------------------------------------------------------------------------------------------------
 * Three visual states, three colors. `status` drives the color, so callers
 * don't pass a Badge `variant`; `modifiedReason` opts the layout-cascade
 * variants into a tooltip that explains _why_ the page is modified.
 * -----------------------------------------------------------------------------------------------*/

/** Publication state shared by pages and collection records. */
export type PublicationStatus = "draft" | "published" | "modified";

type ModifiedReason =
  | { reason: "self" }
  | { reason: "layout"; layoutId: number; layoutHandle: string; affectedPagesCount: number }
  | { reason: "both"; layoutId: number; layoutHandle: string; affectedPagesCount: number }
  | null;

type Size = React.ComponentProps<typeof Badge>["size"];

// Tinted pattern, mirroring Badge's `destructive` variant
// (`bg-destructive/10 text-destructive`) for a subtler look than solid fills.
const statusStyles: Record<PublicationStatus, { className: string; label: string }> = {
  draft: {
    className: "bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400",
    label: "Draft",
  },
  published: {
    className: "bg-primary/10 text-primary dark:bg-primary/20",
    label: "Published",
  },
  modified: {
    className: "bg-purple-500/10 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400",
    label: "Modified",
  },
};

type PageStatusBadgeProps = {
  status: PublicationStatus;
  /** Optional — only the `'layout'` / `'both'` shapes surface the tooltip. */
  modifiedReason?: ModifiedReason;
  size?: Size;
  className?: string;
};

const PageStatusBadge = ({
  status,
  modifiedReason,
  size = "default",
  className,
}: PageStatusBadgeProps) => {
  const { className: statusClassName, label } = statusStyles[status];
  const badge = (
    <Badge size={size} className={cn(statusClassName, className)}>
      {label}
    </Badge>
  );

  // Only the layout-cascade variants get the explanatory tooltip — for
  // 'self', the badge is self-explanatory ("you edited this page").
  if (
    status === "modified" &&
    modifiedReason &&
    (modifiedReason.reason === "layout" || modifiedReason.reason === "both")
  ) {
    const pluralized = modifiedReason.affectedPagesCount === 1 ? "page" : "pages";
    const headline =
      modifiedReason.reason === "layout"
        ? `Layout ${modifiedReason.layoutHandle} has unpublished changes`
        : `This page and layout ${modifiedReason.layoutHandle} both have unpublished changes`;
    return (
      <Tooltip>
        <TooltipTrigger render={<span className="shrink-0" />}>{badge}</TooltipTrigger>
        <TooltipContent>
          {headline} (affects {modifiedReason.affectedPagesCount} {pluralized})
        </TooltipContent>
      </Tooltip>
    );
  }
  return badge;
};

export { PageStatusBadge };
