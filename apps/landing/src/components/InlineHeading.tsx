import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

type InlineHeadingProps = Omit<ComponentProps<"p">, "title"> & {
  lead: ReactNode;
  continuation: ReactNode;
};

export function InlineHeading({ lead, continuation, className, ...props }: InlineHeadingProps) {
  return (
    <p {...props} className={cn("text-ink text-heading", className)}>
      {lead} <span className="text-ink-muted">{continuation}</span>
    </p>
  );
}
