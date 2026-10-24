import { useSelector } from "@xstate/store-react";

import { CanvasLoadingScreen } from "../../canvas/CanvasLoadingScreen";
import { CanvasSidebarSkeleton } from "../../canvas/sidebar/CanvasSidebarSkeleton";
import { previewStore, selectIsCanvasShown } from "../previewStore";

/**
 * What holds the page's place while the editor loads. The studio never renders the site's code:
 * a loading screen shows where the page will, in the Canvas's background, until the renderer
 * frame shows it. Showing the Canvas before the editor is ready also shows the Canvas sidebar's
 * placeholder, as the editor does while the Canvas prepares.
 */
export function StudioEditingFallback({ layoutPage }: { layoutPage: boolean }) {
  const isCanvasShown = useSelector(previewStore, selectIsCanvasShown);

  return (
    <div className="flex h-full min-h-0 flex-1">
      {isCanvasShown && <CanvasSidebarSkeleton layoutPage={layoutPage} />}
      <div className="relative min-h-0 min-w-0 flex-1">
        <CanvasLoadingScreen label={isCanvasShown ? undefined : PAGE_LOADING_LABEL} />
      </div>
    </div>
  );
}

/** What the loading screen says while the page it holds the place of loads. */
export const PAGE_LOADING_LABEL = "Loading the page";
