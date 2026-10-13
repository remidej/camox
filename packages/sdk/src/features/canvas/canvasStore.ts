import { createStore } from "@xstate/store";

import type { CanvasCamera } from "./canvasCamera";

interface CanvasView {
  camera: CanvasCamera;
  fitted: boolean;
}

/** Workspace views outlive canvas mounts, but not the preview that hosts them. */
export const canvasStore = createStore({
  context: {
    views: {} as Partial<Record<string, CanvasView>>,
    /** Workspaces whose camera is moving, until it has been still for a moment. */
    moving: {} as Partial<Record<string, boolean>>,
  },
  on: {
    reset: () => ({ views: {}, moving: {} }),
    setCameraMoving: (context, event: { workspaceKey: string; moving: boolean }) => {
      if (!!context.moving[event.workspaceKey] === event.moving) return context;
      return { ...context, moving: { ...context.moving, [event.workspaceKey]: event.moving } };
    },
    rememberView: (context, event: { workspaceKey: string; view: CanvasView }) => {
      const previous = context.views[event.workspaceKey];
      const { camera, fitted } = event.view;
      const { x, y, scale } = camera;
      if (
        previous?.camera.x === x &&
        previous.camera.y === y &&
        previous.camera.scale === scale &&
        previous.fitted === fitted
      )
        return context;
      return {
        ...context,
        views: { ...context.views, [event.workspaceKey]: { camera: { x, y, scale }, fitted } },
      };
    },
  },
});
