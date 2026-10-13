import { useSelector } from "@xstate/store-react";
import { useContext } from "react";

import { canvasStore } from "./canvasStore";
import { CanvasWorkspaceContext } from "./canvasZoom";

/**
 * How much of a frame runs. Only the selected item is live, and only while the
 * camera is still. Other frames near the camera are paused: they show their
 * content, with its animations and media stopped. Frames away from it rest:
 * their content is hidden and its effects stop too.
 */
export type CanvasFrameMode = "live" | "paused" | "resting";

export function canvasFrameMode({
  near,
  selected,
  moving,
}: {
  near: boolean;
  selected: boolean;
  moving: boolean;
}): CanvasFrameMode {
  if (!near && !selected) return "resting";
  if (moving || !selected) return "paused";
  return "live";
}

export function useCanvasFrameMode(frame: { near: boolean; selected: boolean }) {
  const workspaceKey = useContext(CanvasWorkspaceContext)?.workspaceKey;
  const moving = useSelector(
    canvasStore,
    (state) => workspaceKey != null && !!state.context.moving[workspaceKey],
  );
  return canvasFrameMode({ ...frame, moving });
}
