import { Skeleton } from "@camox/ui/skeleton";

import { cn } from "@/lib/utils";

/** Stands in for the page info while it loads, in its collapsed layout, so nothing shifts. */
export const PageInfoSkeleton = ({ scrollable = false }: { scrollable?: boolean }) => (
  <div aria-hidden className={cn("space-y-4 p-2 pt-4", scrollable && "flex-1 overflow-auto")}>
    {["SEO", "GEO"].map((key) => (
      <div key={key} className="space-y-2">
        <Skeleton className="h-3.5 w-10" />
        <Skeleton className="h-9 w-full" />
      </div>
    ))}
    <div className="flex items-center gap-2">
      <Skeleton className="size-4 rounded-[4px]" />
      <Skeleton className="h-3.5 w-32" />
    </div>
  </div>
);
