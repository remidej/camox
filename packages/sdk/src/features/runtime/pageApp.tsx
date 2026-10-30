import {
  HydrationBoundary,
  QueryClientProvider,
  type DehydratedState,
  type QueryClient,
} from "@tanstack/react-query";
import * as React from "react";

import type { CamoxApp } from "../../core/createApp";
import { useAuthState, useSignInRedirect } from "../../lib/auth";
import { type DraftScope, DraftScopeContext } from "../../lib/draft-scope";
import { CuratedPageContent } from "../page/CuratedPageContent";
import { DerivedPageContent } from "../page/DerivedPageContent";
import { UnplacedBlockContent } from "../page/UnplacedBlockContent";
import { UnplacedLayoutContent } from "../page/UnplacedLayoutContent";
import { Frame } from "../preview/components/Frame";
import { PreviewActivation } from "../preview/components/PreviewActivation";
import { CoreCamoxProvider } from "../provider/CoreCamoxProvider";
import { PreviewSignInPage } from "../provider/PreviewSignInPage";
import { useSignInShortcut } from "../provider/signInShortcut";
import { EditingFallbackSlot } from "./editingFallback";
import { PageNavigationProvider } from "./pageNavigation";
import { PreviewDocumentContext } from "./PreviewDocumentContext";
import type { PageRenderInput } from "./runtime";
import { RuntimeChromeSlot } from "./runtimeChromeLoader";

/** The page app of one server request or browser window, viewing the draft `draftScope` names. */
export function PageApp({
  camoxApp,
  draftScope,
  input,
  queryClient,
}: {
  camoxApp: CamoxApp;
  draftScope: DraftScope;
  input: PageRenderInput;
  queryClient: QueryClient;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <DraftScopeContext.Provider value={draftScope}>
        <HydrationBoundary state={input.dehydratedState as DehydratedState}>
          <PageNavigationProvider
            camoxApp={camoxApp}
            initialInput={input}
            queryClient={queryClient}
          >
            {(currentInput) => (
              <CoreCamoxProvider
                camoxApp={camoxApp}
                authenticationUrl={input.authenticationUrl}
                apiUrl={input.apiUrl}
                projectUuid={input.projectUuid}
                initialAuthenticated={input.presentation === "studio"}
                initialProject={currentInput.project}
                sessionless={input.look}
              >
                <PreviewDocumentContext.Provider value={currentInput.previewDocument}>
                  {input.previewHandoff ? (
                    <PreviewSignInPage />
                  ) : input.look ? (
                    // The look document only shows the draft: no sign-in.
                    <PageContent camoxApp={camoxApp} input={currentInput} />
                  ) : (
                    <PageExperience
                      camoxApp={camoxApp}
                      input={currentInput}
                      queryClient={queryClient}
                      studioDocument={input.presentation === "studio"}
                    />
                  )}
                </PreviewDocumentContext.Provider>
              </CoreCamoxProvider>
            )}
          </PageNavigationProvider>
        </HydrationBoundary>
      </DraftScopeContext.Provider>
    </QueryClientProvider>
  );
}

const LazyEditablePageExperience = React.lazy(() =>
  import("../preview/EditablePageExperience").then((module) => ({
    default: module.EditablePageExperience,
  })),
);

class EditingActivationBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("Camox editing runtime failed to load.", error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const subscribeToHydration = () => () => {};

function PageExperience({
  camoxApp,
  input,
  queryClient,
  studioDocument,
}: {
  camoxApp: CamoxApp;
  input: PageRenderInput;
  queryClient: QueryClient;
  studioDocument: boolean;
}) {
  const { isAuthenticated, isLoading } = useAuthState();
  const hasHydrated = React.useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const signIn = useSignInRedirect();
  // A Canvas-only location is a Studio location too, but renders in the page tree.
  const studioOnly = !!input.routeKind || !!input.canvasOnly;
  React.useEffect(() => {
    if (studioOnly && !isAuthenticated && !isLoading) signIn();
  }, [studioOnly, isAuthenticated, isLoading, signIn]);
  useSignInShortcut(hasHydrated && !studioOnly && !isAuthenticated && !isLoading);

  const loading = <div className="text-muted-foreground p-6 text-sm">Loading Studio…</div>;
  const readOnlyPage = input.routeKind ? (
    loading
  ) : input.canvasOnly ? null : (
    <PageContent camoxApp={camoxApp} input={input} />
  );

  const isolatedPage = <Frame>{readOnlyPage}</Frame>;
  if (isAuthenticated) {
    // The studio renders no block itself: the renderer frame loads the site's code. Until it
    // shows the page, a loading screen holds the page's place.
    const editor = hasHydrated ? (
      <LazyEditablePageExperience camoxApp={camoxApp} input={input} queryClient={queryClient} />
    ) : null;

    return (
      <RuntimeChromeSlot
        input={input}
        // Only a visitor's document, already showing the page, signs in without the chrome loaded.
        fallback={input.routeKind ? loading : studioDocument ? null : isolatedPage}
      >
        <EditingActivationBoundary fallback={<StudioLoadError />}>
          {input.routeKind ? (
            <React.Suspense fallback={loading}>{editor ?? loading}</React.Suspense>
          ) : (
            <PreviewActivation fallback={<EditingFallbackSlot layoutPage={!!input.derived} />}>
              {editor}
            </PreviewActivation>
          )}
        </EditingActivationBoundary>
      </RuntimeChromeSlot>
    );
  }
  if (studioOnly) return null;
  // After sign-out, the containing document still belongs to studio. Do not
  // suddenly put site markup under its styles or theme while auth reconciles.
  if (studioDocument) return <div style={{ height: "100vh" }}>{isolatedPage}</div>;
  return readOnlyPage;
}

/** The page's blocks, read-only, or the look document's unplaced block or Layout. */
function PageContent({ camoxApp, input }: { camoxApp: CamoxApp; input: PageRenderInput }) {
  if (input.lookBlock) return <UnplacedBlockContent blockId={input.lookBlock} />;
  if (input.lookLayout)
    return <UnplacedLayoutContent camoxApp={camoxApp} lookLayout={input.lookLayout} />;
  if (input.derived) return <DerivedPageContent camoxApp={camoxApp} derived={input.derived} />;
  return <CuratedPageContent />;
}

function StudioLoadError() {
  return (
    <div role="alert" className="flex flex-1 flex-col items-start justify-center gap-3 p-6">
      <h1 className="text-lg font-semibold">Studio failed to load</h1>
      <p className="text-muted-foreground text-sm">
        Something went wrong while opening Studio. Reload the page to try again.
      </p>
      <button
        type="button"
        className="bg-accent text-accent-foreground rounded-md px-3 py-1.5 text-sm font-medium"
        onClick={() => window.location.reload()}
      >
        Reload Studio
      </button>
    </div>
  );
}
