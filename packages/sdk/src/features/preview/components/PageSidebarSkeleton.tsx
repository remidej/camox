import { Skeleton } from "@camox/ui/skeleton";

import { cn } from "@/lib/utils";

/** Stands in for the page info while it loads, in its collapsed layout, so nothing shifts. */
export const PageInfoSidebarSkeleton = ({ scrollable = false }: { scrollable?: boolean }) => (
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

/**
 * Stands in for a page's sidebar while it loads, in the layout it loads into, so nothing
 * shifts: a curated page's blocks and page info, or a derived layout's blocks and notice.
 */
export const PageSidebarSkeleton = ({ derived = false }: { derived?: boolean }) => (
  <div
    role="status"
    aria-label="Loading page sidebar"
    className="flex min-h-0 flex-1 flex-col overflow-hidden"
  >
    <div className={derived ? "flex flex-col gap-4 px-2 pt-4" : "px-2 pt-4"}>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3.5 w-12" />
        <div className="flex flex-col gap-1">
          <Skeleton className="h-9.5 w-full rounded-lg" />
          {!derived && <Skeleton className="h-9 w-full" />}
        </div>
      </div>
      {derived && <Skeleton className="h-20 w-full rounded-lg" />}
    </div>
    {!derived && <PageInfoSidebarSkeleton />}
  </div>
);
