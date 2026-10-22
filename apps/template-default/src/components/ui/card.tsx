import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * A raised surface for one item among several, such as a feature, a plan or a testimonial.
 * It follows the color scheme it sits in; give it a scheme class (`light`) to set it apart,
 * for instance a light card on a dark block.
 */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("bg-panel text-ink rounded-card border-line border p-6", className)}
      {...props}
    />
  );
}
