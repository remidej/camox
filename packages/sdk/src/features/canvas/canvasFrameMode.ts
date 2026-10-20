import { useSelector } from "@xstate/store-react";
import { useContext, useState } from "react";

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

/**
 * A frame's mode as the camera moves. A frame that leaves the camera rests only
 * once the camera is still: while it moves, every frame is paused anyway, and
 * frames it passes by would otherwise stop and restart all their effects.
 */
export function useCanvasFrameMode({ near, selected }: { near: boolean; selected: boolean }) {
  const workspaceKey = useContext(CanvasWorkspaceContext)?.workspaceKey;
  // Frames near the camera and not selected are paused either way: they skip
  // re-rendering when the camera starts or stops.
  const moving = useSelector(
    canvasStore,
    (state) => (selected || !near) && workspaceKey != null && !!state.context.moving[workspaceKey],
  );
  const away = !near && !selected;
  const [resting, setResting] = useState(away);
  if (resting !== away && (!away || !moving)) setResting(away);
  if (!away) return canvasFrameMode({ near, selected, moving });
  return resting ? "resting" : "paused";
}
