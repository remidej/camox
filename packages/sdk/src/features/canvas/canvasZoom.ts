import { useSelector } from "@xstate/store-react";
import { createContext, useContext } from "react";

import type { CanvasPoint } from "./canvasCamera";
import { canvasStore } from "./canvasStore";

type CanvasWorkspaceContext = {
  workspaceKey: string;
  zoomAt: (point: CanvasPoint, scale: number) => void;
};

export const CanvasWorkspaceContext = createContext<CanvasWorkspaceContext | null>(null);

/** Subscribe to scale only, so camera panning never rerenders overlay controls. */
export function useCanvasZoom() {
  const workspaceKey = useContext(CanvasWorkspaceContext)?.workspaceKey;
  return useSelector(canvasStore, (state) => {
    if (workspaceKey == null) return 1;
    return state.context.views[workspaceKey]?.camera.scale ?? 0.4;
  });
}

export function useCanvasZoomAt() {
  return useContext(CanvasWorkspaceContext)?.zoomAt;
}
