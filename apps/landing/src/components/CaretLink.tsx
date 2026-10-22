import { Link } from "camox/navigation";
import { ChevronRight } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

type CaretLinkProps = Omit<ComponentProps<typeof Link>, "children"> & {
  children?: ReactNode;
};

export function CaretLink({ className, children, ...props }: CaretLinkProps) {
  return (
    <Link
      {...props}
      className={cn(
        "text-brand inline-flex items-center gap-1 py-1 text-sm font-medium",
        className,
      )}
    >
      {children}
      <ChevronRight aria-hidden className="size-4" />
    </Link>
  );
}
