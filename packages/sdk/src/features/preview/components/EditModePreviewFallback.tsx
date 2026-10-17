import { useSelector } from "@xstate/store-react";
import type * as React from "react";

import { CanvasLoadingScreen } from "../../canvas/CanvasLoadingScreen";
import { CanvasSidebarSkeleton } from "../../canvas/CanvasSidebarSkeleton";
import { previewStore, selectIsEditMode } from "../previewStore";

/**
 * The read-only page shown while the editor loads. Turning on Edit Mode before the editor
 * is ready shows what the editor shows while the Canvas prepares: the Canvas sidebar's
 * placeholder, and a loading screen where the Canvas will be. The page's frame keeps its
 * place in the tree underneath, so it never reloads.
 */
export function EditModePreviewFallback({
  derived,
  children,
}: {
  derived: boolean;
  children: React.ReactNode;
}) {
  const isEditMode = useSelector(previewStore, selectIsEditMode);

  return (
    <div className="flex h-full min-h-0 flex-1">
      {isEditMode && <CanvasSidebarSkeleton derived={derived} />}
      <div className="relative min-h-0 min-w-0 flex-1">
        {children}
        {isEditMode && <CanvasLoadingScreen />}
      </div>
    </div>
  );
}
