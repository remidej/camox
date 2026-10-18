import { useSelector } from "@xstate/store-react";
import type * as React from "react";

import { CanvasLoadingScreen } from "../../canvas/CanvasLoadingScreen";
import { CanvasSidebarSkeleton } from "../../canvas/sidebar/CanvasSidebarSkeleton";
import { previewStore, selectIsCanvasShown } from "../previewStore";

/**
 * The read-only page shown while the editor loads. Showing the Canvas before the editor
 * is ready shows what the editor shows while the Canvas prepares: the Canvas sidebar's
 * placeholder, and a loading screen where the Canvas will be. The page's frame keeps its
 * place in the tree underneath, so it never reloads.
 */
export function StudioEditingFallback({
  layoutPage,
  children,
}: {
  layoutPage: boolean;
  children: React.ReactNode;
}) {
  const isCanvasShown = useSelector(previewStore, selectIsCanvasShown);

  return (
    <div className="flex h-full min-h-0 flex-1">
      {isCanvasShown && <CanvasSidebarSkeleton layoutPage={layoutPage} />}
      <div className="relative min-h-0 min-w-0 flex-1">
        {children}
        {isCanvasShown && <CanvasLoadingScreen />}
      </div>
    </div>
  );
}
