import { type QueryClient, replaceEqualDeep, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import type { CamoxApp } from "../../core/createApp";
import { getDraftReadClient, initApiClient } from "../../lib/api-client";
import { AuthContext, createCamoxAuthClient, useProcessOtt } from "../../lib/auth";
import {
  createDraftScope,
  type DraftScope,
  followUrl,
  DraftScopeContext,
} from "../../lib/draft-scope";
import type { Project } from "../../lib/queries";
import { StudioCacheContext, createStudioCache, reads } from "../../lib/studio-reads";
import { CamoxAppProvider } from "./components/CamoxAppContext";
import { PreviewSignInPage } from "./PreviewSignInPage";

export interface CoreCamoxProviderProps {
  apiUrl: string;
  authenticationUrl: string;
  camoxApp: CamoxApp;
  children: React.ReactNode;
  projectUuid: string;
  initialAuthenticated?: boolean;
  initialProject?: Project;
}

export function CoreCamoxProvider({
  apiUrl,
  authenticationUrl,
  camoxApp,
  children,
  projectUuid,
  initialAuthenticated = false,
  initialProject,
}: CoreCamoxProviderProps) {
  const queryClient = useQueryClient();
  const authClient = React.useMemo(() => createCamoxAuthClient(apiUrl), [apiUrl]);
  // The page runtime gives every request and window its draft scope. Mounted in a host
  // application instead, the studio follows the window's URL.
  const providedScope = React.useContext(DraftScopeContext);
  const [ownScope] = React.useState(() =>
    providedScope ? null : createWindowDraftScope(queryClient),
  );
  const draftScope = providedScope ?? ownScope!;
  const initializedClient = React.useRef<{ apiUrl: string; draftScope: DraftScope } | null>(null);
  if (
    // oxlint-disable-next-line react/refs -- one-time client init must happen before children render
    initializedClient.current?.apiUrl !== apiUrl ||
    // oxlint-disable-next-line react/refs -- see above
    initializedClient.current.draftScope !== draftScope
  ) {
    initApiClient(apiUrl, draftScope);
    // oxlint-disable-next-line react/refs -- see above
    initializedClient.current = { apiUrl, draftScope };
  }
  const providedCache = React.useContext(StudioCacheContext);
  const [ownCache] = React.useState(() =>
    providedCache
      ? null
      : createStudioCache({ queryClient, scope: draftScope, api: getDraftReadClient }),
  );
  const studioCache = providedCache ?? ownCache!;

  const seededProject = React.useRef<Project | undefined>(undefined);
  // oxlint-disable-next-line react/refs -- the cache must be seeded before children query it
  if (initialProject && seededProject.current !== initialProject) {
    // Each navigation brings the project again. Rewriting an equal project still
    // updates every read of it, which re-renders every field of every frame.
    const read = reads.project({ projectUuid });
    const cached = studioCache.get(read);
    if (!cached || replaceEqualDeep(cached, initialProject) !== cached)
      studioCache.set(read, initialProject);
    // oxlint-disable-next-line react/refs -- see above
    seededProject.current = initialProject;
  }

  // OTT processing deliberately does not blank the public tree. Successful
  // exchange still reloads after mirroring the server cookie.
  const { ready, error } = useProcessOtt(authClient, { projectUuid, apiUrl }, initialAuthenticated);
  const exchangingToken = !ready;

  // The React Compiler skips this component (it reads refs while rendering), so
  // the context value is memoized by hand: every field of every frame reads it.
  const authContext = React.useMemo(
    () => ({
      authClient,
      authenticationUrl,
      apiUrl,
      projectUuid,
      initialAuthenticated,
      exchangingToken,
    }),
    [authClient, authenticationUrl, apiUrl, projectUuid, initialAuthenticated, exchangingToken],
  );
  const [isPreviewHandoff, setIsPreviewHandoff] = React.useState(false);
  React.useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- reads window.location after hydration
    setIsPreviewHandoff(new URL(window.location.href).searchParams.has("camox-preview"));
  }, []);

  if (error) return <PreviewSignInPage error={error} />;
  if (isPreviewHandoff && !ready) return <PreviewSignInPage />;
  if (isPreviewHandoff && !initialAuthenticated) {
    return (
      <PreviewSignInPage error="Draft preview is not authenticated. Run camox preview again for a fresh link." />
    );
  }

  return (
    <DraftScopeContext.Provider value={draftScope}>
      <StudioCacheContext.Provider value={studioCache}>
        <AuthContext.Provider value={authContext}>
          <CamoxAppProvider app={camoxApp}>{children}</CamoxAppProvider>
        </AuthContext.Provider>
      </StudioCacheContext.Provider>
    </DraftScopeContext.Provider>
  );
}

function createWindowDraftScope(queryClient: QueryClient) {
  if (typeof window === "undefined") return createDraftScope({ queryClient });
  const draftScope = createDraftScope({ queryClient, browser: window });
  followUrl(draftScope, window.location.href);
  return draftScope;
}
