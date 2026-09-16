import { useSelector } from "@xstate/store-react";

import { previewStore, selectIsEditMode } from "@/features/preview/previewStore";
import { useIsAuthenticated } from "@/lib/auth";

export function useIsEditable(mode: "site" | "peek" | "layout") {
  const isAuthenticated = useIsAuthenticated();
  const isEditMode = useSelector(previewStore, selectIsEditMode);
  return isAuthenticated && (mode === "site" || mode === "layout") && isEditMode;
}
