import { useSelector } from "@xstate/store-react";
import { createContext, useContext } from "react";

import { canvasStore } from "./canvasStore";

type CanvasWorkspaceContext = {
  workspaceKey: string;
  /** Paints the camera onto an element outside the Canvas viewport, until the returned cleanup. */
  mirrorCamera: (element: HTMLElement) => () => void;
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
