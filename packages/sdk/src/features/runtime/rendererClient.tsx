import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";

import type { CamoxApp } from "../../core/createApp";
import { CompleteBlockEditingRuntimeProvider } from "../../core/editing/CompleteBlockEditingRuntime";
import { getDraftReadClient } from "../../lib/api-client";
import { createDraftScope, DraftScopeContext, followUrl } from "../../lib/draft-scope";
import { createStudioCache, StudioCacheContext } from "../../lib/studio-reads";
import { CoreCamoxProvider } from "../provider/CoreCamoxProvider";
import { STUDIO_HANDLE_KEY, type StudioHandle } from "../renderer/protocol";
import { RendererApp } from "../renderer/RendererApp";
import { connectToStudio } from "../renderer/studioConnection";
import { readHydrationData } from "./hydrationData";
import type { RendererDocumentInput } from "./runtime";

/**
 * Starts the renderer frame's document (ADR 0023): connects to the studio that loaded it, and
 * renders the pages of the frames it is given with the site's code, in a cache of its own.
 */
export async function startRendererWithApp(camoxApp: CamoxApp) {
  const handle = (window.frameElement as { [STUDIO_HANDLE_KEY]?: StudioHandle } | null)?.[
    STUDIO_HANDLE_KEY
  ];
  if (!handle) {
    console.error("Camox: the renderer document only runs in the studio's renderer frame.");
    return;
  }
  const input = readHydrationData<RendererDocumentInput>();
  if (!input.apiUrl || !input.authenticationUrl || !input.projectUuid) {
    console.error("Camox: the renderer document is missing its API or project.");
    return;
  }
  // Editing places and lists any block, so the renderer waits for every definition.
  await camoxApp.loadAllBlocks();

  const queryClient = new QueryClient();
  // The document's URL names the draft it shows, as the studio's does.
  const draftScope = createDraftScope({ queryClient, browser: window });
  followUrl(draftScope, window.location.href);
  const studioCache = createStudioCache({
    queryClient,
    scope: draftScope,
    api: getDraftReadClient,
  });
  const connection = connectToStudio(handle, { queryClient, studioCache, draftScope, camoxApp });

  const container = document.createElement("div");
  document.body.append(container);
  createRoot(container).render(
    <QueryClientProvider client={queryClient}>
      <DraftScopeContext.Provider value={draftScope}>
        <StudioCacheContext.Provider value={studioCache}>
          {/* Only the studio's members load it: its frames edit what they show. */}
          <CoreCamoxProvider
            apiUrl={input.apiUrl}
            authenticationUrl={input.authenticationUrl}
            camoxApp={camoxApp}
            projectUuid={input.projectUuid}
            initialAuthenticated
          >
            <CompleteBlockEditingRuntimeProvider>
              <RendererApp
                connection={connection}
                camoxApp={camoxApp}
                projectUuid={input.projectUuid}
                runtimeBasePath={input.runtimeBasePath}
              />
            </CompleteBlockEditingRuntimeProvider>
          </CoreCamoxProvider>
        </StudioCacheContext.Provider>
      </DraftScopeContext.Provider>
    </QueryClientProvider>,
  );
}
