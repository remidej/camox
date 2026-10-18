import { Skeleton } from "@camox/ui/skeleton";

import { PageInfoSkeleton } from "../../preview/components/PageInfoSkeleton";
import type { CanvasPage } from "../canvasPages";

/*
 * Stand-ins for a Page's inspector while it loads, each in the layout it loads into, so
 * nothing shifts. They live apart from the inspectors so the Preview can show them without
 * importing the inspectors.
 */

/** A `BlocksGroup` of a `CollapsedPageTree`. */
function BlocksGroupSkeleton({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-3.5 w-12" />
      <div className="flex flex-col gap-1">
        <Skeleton className="h-9.5 w-full rounded-lg" />
        {children}
      </div>
    </div>
  );
}

function LoadingPage({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      aria-label="Loading page sidebar"
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      {children}
    </div>
  );
}

/** A curated page's blocks and page info. */
export function CuratedPageSkeleton() {
  return (
    <LoadingPage>
      <div className="px-2 pt-4">
        <BlocksGroupSkeleton>
          <Skeleton className="h-9 w-full" />
        </BlocksGroupSkeleton>
      </div>
      <PageInfoSkeleton />
    </LoadingPage>
  );
}

/** A layout page's blocks and notice. */
export function LayoutPageSkeleton() {
  return (
    <LoadingPage>
      <div className="flex flex-col gap-4 px-2 pt-4">
        <BlocksGroupSkeleton />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
    </LoadingPage>
  );
}

export function PageInspectorSkeleton({ kind }: { kind: CanvasPage["kind"] }) {
  return kind === "curated" ? <CuratedPageSkeleton /> : <LayoutPageSkeleton />;
}
