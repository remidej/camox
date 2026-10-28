import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * A small inline label, such as "New" next to a heading or a plan's "Popular" tag. For a
 * label above a heading, use Eyebrow instead.
 */
export function Badge({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "rounded-control bg-accent/10 text-accent inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold",
        className,
      )}
      {...props}
    />
  );
}
