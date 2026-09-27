import { lazy, Suspense } from "react";

import { isCanvasEnabled } from "./routes";

const LazyCamoxCanvas = lazy(() =>
  import("../canvas/CamoxCanvas").then((module) => ({ default: module.CamoxCanvas })),
);

export function CanvasRoute({ runtimeBasePath }: { runtimeBasePath: string }) {
  // Guard before mounting the lazy component: disabled builds never load Canvas
  // or mount any of its draft-data queries, even for a direct URL.
  if (!isCanvasEnabled())
    return <div className="text-muted-foreground p-6 text-sm">Studio page not found</div>;

  return (
    <Suspense fallback={<div className="text-muted-foreground p-6 text-sm">Loading canvas…</div>}>
      <LazyCamoxCanvas runtimeBasePath={runtimeBasePath} />
    </Suspense>
  );
}
