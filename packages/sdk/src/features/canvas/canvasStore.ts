import { createStore } from "@xstate/store";

import type { CanvasCamera } from "./canvasCamera";

interface CanvasView {
  camera: CanvasCamera;
  fitted: boolean;
}

/**
 * What each workspace shows, for the Studio session: it outlives the Canvas, so leaving the
 * Website Section or switching drafts or locales, which mount it afresh, lands where it was.
 */
export const canvasStore = createStore({
  context: {
    views: {} as Partial<Record<string, CanvasView>>,
    /** Workspaces whose camera is moving, until it has been still for a moment. */
    moving: {} as Partial<Record<string, boolean>>,
    /** Counts requests to zoom out to the whole Canvas; a mounted Canvas answers each new one. */
    overviewRequests: 0,
  },
  on: {
    reset: () => ({ views: {}, moving: {}, overviewRequests: 0 }),
    requestOverview: (context) => ({ ...context, overviewRequests: context.overviewRequests + 1 }),
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
