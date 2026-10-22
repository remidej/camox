import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * Centers a block's content at the page width, with the gutter on each side. Use it right
 * inside a Section. For a narrower column of text, add `max-w-text`.
 */
export function Container({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("max-w-page px-gutter mx-auto w-full", className)} {...props} />;
}
