import { useSelector } from "@xstate/store-react";
import * as React from "react";

import { previewStore, selectIsEditMode } from "@/features/preview/previewStore";
import { useIsAuthenticated } from "@/lib/auth";

/**
 * Whether the surrounding frame offers editing in Edit Mode. The Preview page
 * frame only does once it shows in the Canvas: it keeps the editing runtime
 * either way, so that Edit Mode never remounts the page.
 */
export const EditableSurfaceContext = React.createContext(true);

export function useIsEditable(mode: "site" | "peek" | "layout") {
  const isAuthenticated = useIsAuthenticated();
  const isEditMode = useSelector(previewStore, selectIsEditMode);
  const surface = React.use(EditableSurfaceContext);
  return isAuthenticated && (mode === "site" || mode === "layout") && isEditMode && surface;
}
