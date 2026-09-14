import {
  HydrationBoundary,
  QueryClientProvider,
  type DehydratedState,
  type QueryClient,
} from "@tanstack/react-query";
import * as React from "react";

import type { CamoxApp } from "../../core/createApp";
import { useAuthState, useSignInRedirect } from "../../lib/auth";
import { DerivedPageContent } from "../page/DerivedPageContent";
import { PublishedPageExperience } from "../page/PublishedPageExperience";
import { Frame } from "../preview/components/Frame";
import { PreviewActivation } from "../preview/components/PreviewActivation";
import { CoreCamoxProvider, isLocalhostPreview } from "../provider/CoreCamoxProvider";
import { PageNavigationProvider } from "./pageNavigation";
import { PreviewDocumentContext } from "./PreviewDocumentContext";
import type { PageRenderInput } from "./runtime";
import { RuntimeChrome } from "./RuntimeChrome";

export function PageApp({
  camoxApp,
  input,
  queryClient,
}: {
  camoxApp: CamoxApp;
  input: PageRenderInput;
  queryClient: QueryClient;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <HydrationBoundary state={input.dehydratedState as DehydratedState}>
        <PageNavigationProvider initialInput={input} queryClient={queryClient}>
          {(currentInput) => (
            <CoreCamoxProvider
              camoxApp={camoxApp}
              authenticationUrl={input.authenticationUrl}
              apiUrl={input.apiUrl}
              projectSlug={input.projectSlug}
              environmentName={input.environmentName}
              initialAuthenticated={input.presentation === "studio"}
              initialProject={currentInput.project}
            >
              <PreviewDocumentContext.Provider value={currentInput.previewDocument}>
                <PageExperience
                  camoxApp={camoxApp}
                  input={currentInput}
                  queryClient={queryClient}
                  studioDocument={input.presentation === "studio"}
                />
              </PreviewDocumentContext.Provider>
            </CoreCamoxProvider>
          )}
        </PageNavigationProvider>
      </HydrationBoundary>
    </QueryClientProvider>
  );
}

const LazyEditablePageExperience = React.lazy(() =>
  import("../preview/EditablePageExperience").then((module) => ({
    default: module.EditablePageExperience,
  })),
);
const LazyLocalhostPreviewProvider = React.lazy(() =>
  import("../provider/LocalhostPreviewProvider").then((module) => ({
    default: module.LocalhostPreviewProvider,
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
  React.useEffect(() => {
    if (input.routeKind && !isAuthenticated && !isLoading) signIn();
  }, [input.routeKind, isAuthenticated, isLoading, signIn]);

  const published = input.routeKind ? (
    <div className="text-muted-foreground p-6 text-sm">Loading Studio…</div>
  ) : input.derived ? (
    <DerivedPageContent camoxApp={camoxApp} derived={input.derived} source={input.source} />
  ) : (
    <PublishedPageExperience source={input.source} />
  );

  const isolatedPage = <Frame>{published}</Frame>;
  const fallback = input.routeKind ? published : isolatedPage;
  if (isAuthenticated) {
    const editor = hasHydrated ? (
      <LazyEditablePageExperience camoxApp={camoxApp} input={input} queryClient={queryClient} />
    ) : null;

    return (
      <RuntimeChrome input={input}>
        <EditingActivationBoundary fallback={fallback}>
          {input.routeKind ? (
            <React.Suspense fallback={fallback}>{editor ?? fallback}</React.Suspense>
          ) : (
            <PreviewActivation
              fallback={<Frame serverOnly={!!input.previewDocument}>{published}</Frame>}
            >
              {editor}
            </PreviewActivation>
          )}
        </EditingActivationBoundary>
      </RuntimeChrome>
    );
  }
  if (input.routeKind) return null;
  if (hasHydrated && isLocalhostPreview()) {
    return (
      <React.Suspense fallback={published}>
        <LazyLocalhostPreviewProvider>{published}</LazyLocalhostPreviewProvider>
      </React.Suspense>
    );
  }
  // After sign-out, the containing document still belongs to studio. Do not
  // suddenly put site markup under its styles or theme while auth reconciles.
  if (studioDocument) return <div style={{ height: "100vh" }}>{isolatedPage}</div>;
  return published;
}
