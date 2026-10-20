import { createStore } from "@xstate/store";
import * as React from "react";

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
    /** The keys of each workspace's collapsed shelves. */
    collapsedShelves: {} as Partial<Record<string, readonly string[]>>,
    /** Workspaces whose camera is moving, until it has been still for a moment. */
    moving: {} as Partial<Record<string, boolean>>,
    /** Counts requests to zoom out to the whole Canvas; a mounted Canvas answers each new one. */
    overviewRequests: 0,
  },
  on: {
    reset: () => ({ views: {}, collapsedShelves: {}, moving: {}, overviewRequests: 0 }),
    /** Sets the shelves a workspace opens with collapsed. */
    openShelves: (context, event: { workspaceKey: string; collapsed: readonly string[] }) => ({
      ...context,
      collapsedShelves: { ...context.collapsedShelves, [event.workspaceKey]: event.collapsed },
    }),
    setShelfCollapsed: (
      context,
      event: { workspaceKey: string; shelfKey: string; collapsed: boolean },
    ) => {
      const collapsed = context.collapsedShelves[event.workspaceKey] ?? [];
      if (collapsed.includes(event.shelfKey) === event.collapsed) return context;
      const next = event.collapsed
        ? [...collapsed, event.shelfKey]
        : collapsed.filter((key) => key !== event.shelfKey);
      return {
        ...context,
        collapsedShelves: { ...context.collapsedShelves, [event.workspaceKey]: next },
      };
    },
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

function subscribe(onChange: () => void) {
  const subscription = canvasStore.subscribe(onChange);
  return () => subscription.unsubscribe();
}

const noShelves: readonly string[] = [];

/**
 * The keys of a workspace's collapsed shelves. The first time a workspace opens
 * in the session, `defaults` are collapsed. It always opens with the shelf
 * holding the selection expanded, so the camera can start on the selection.
 */
export function useCollapsedShelves(
  workspaceKey: string,
  defaults: readonly string[],
  selectedShelf: string | undefined,
): ReadonlySet<string> {
  const stored = React.useSyncExternalStore(
    subscribe,
    () => canvasStore.getSnapshot().context.collapsedShelves[workspaceKey],
    () => undefined,
  );
  // Shown from the first render, until the store holds them.
  const [opening, setOpening] = React.useState<readonly string[] | null>(() =>
    (canvasStore.getSnapshot().context.collapsedShelves[workspaceKey] ?? defaults).filter(
      (key) => key !== selectedShelf,
    ),
  );
  React.useLayoutEffect(() => {
    if (!opening) return;
    canvasStore.send({ type: "openShelves", workspaceKey, collapsed: opening });
    // oxlint-disable-next-line react/set-state-in-effect -- hands the opening shelves over to the store before paint
    setOpening(null);
  }, [opening, workspaceKey]);
  const keys = opening ?? stored ?? noShelves;
  return React.useMemo(() => new Set(keys), [keys]);
}

export function setShelfCollapsed(workspaceKey: string, shelfKey: string, collapsed: boolean) {
  canvasStore.send({ type: "setShelfCollapsed", workspaceKey, shelfKey, collapsed });
}
