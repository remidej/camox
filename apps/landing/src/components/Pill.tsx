import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

type PillProps = ComponentProps<"span">;

export function Pill({ className, ...props }: PillProps) {
  return (
    <span
      {...props}
      className={cn("text-brand text-eyebrow inline-block rounded-full uppercase", className)}
    />
  );
}
