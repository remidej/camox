import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * The small label above a heading, such as a section's topic. Use it instead of styling a
 * label by hand, so every eyebrow has the brand's size, tracking and case (set with
 * `--eyebrow-case` in src/styles.css).
 */
export function Eyebrow({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      className={cn("text-eyebrow text-brand [text-transform:var(--eyebrow-case)]", className)}
      {...props}
    />
  );
}
