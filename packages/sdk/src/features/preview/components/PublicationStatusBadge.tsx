import { Badge } from "@camox/ui/badge";
import * as React from "react";

import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------------------------------
 * PublicationStatusBadge — Draft / Published / Modified indicator
 * -------------------------------------------------------------------------------------------------
 * Three visual states, three colors. `status` drives the color, so callers
 * don't pass a Badge `variant`.
 * -----------------------------------------------------------------------------------------------*/

/** Publication state of a collection record. */
export type PublicationStatus = "draft" | "published" | "modified";

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

type PublicationStatusBadgeProps = {
  status: PublicationStatus;
  size?: Size;
  className?: string;
};

const PublicationStatusBadge = ({
  status,
  size = "default",
  className,
}: PublicationStatusBadgeProps) => {
  const { className: statusClassName, label } = statusStyles[status];
  return (
    <Badge size={size} className={cn(statusClassName, className)}>
      {label}
    </Badge>
  );
};

export { PublicationStatusBadge };
