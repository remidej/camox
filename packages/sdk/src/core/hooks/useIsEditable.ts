import { useSelector } from "@xstate/store-react";
import * as React from "react";

import { previewStore, selectIsCanvasShown } from "@/features/preview/previewStore";
import { useIsAuthenticated } from "@/lib/auth";

/**
 * Whether the surrounding frame offers editing while the Canvas shows. The Preview page
 * frame only does once it shows in the Canvas: it keeps the editing runtime
 * either way, so that toggling the Canvas never remounts the page.
 */
export const EditableSurfaceContext = React.createContext(true);

export function useIsEditable(mode: "site" | "peek" | "layout") {
  const isAuthenticated = useIsAuthenticated();
  const isCanvasShown = useSelector(previewStore, selectIsCanvasShown);
  const surface = React.use(EditableSurfaceContext);
  return isAuthenticated && (mode === "site" || mode === "layout") && isCanvasShown && surface;
}
