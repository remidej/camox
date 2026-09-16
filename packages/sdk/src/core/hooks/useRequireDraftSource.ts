import * as React from "react";

import { previewStore, selectPreviewSource } from "@/features/preview/previewStore";

/**
 * Ignore stale editor callbacks after switching to live preview.
 * Draft editing is guaranteed by the store's mode; this guard also covers
 * callbacks from hidden controls and edits that finish asynchronously.
 */
export function useRequireDraftSource() {
  return React.useCallback(() => {
    return selectPreviewSource(previewStore.getSnapshot()) === "draft";
  }, []);
}
