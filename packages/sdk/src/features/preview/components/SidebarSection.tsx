import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function SidebarSection({
  divider = "none",
  className,
  ...props
}: ComponentProps<"section"> & { divider?: "top" | "bottom" | "none" }) {
  return (
    <section
      className={cn(
        "border-border space-y-4 px-2 py-4",
        divider === "top" && "border-t",
        divider === "bottom" && "border-b",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarSectionHeader({ className, ...props }: ComponentProps<"h3">) {
  return (
    <h3
      className={cn(
        "text-muted-foreground flex items-center gap-2 text-sm leading-none font-medium",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarSectionContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("space-y-4", className)} {...props} />;
}
