import {
  HydrationBoundary,
  QueryClientProvider,
  type DehydratedState,
  type QueryClient,
} from "@tanstack/react-query";
import * as React from "react";

import type { CamoxApp } from "../../core/createApp";
import { useAuthState } from "../../lib/auth";
import { DerivedPageContent } from "../page/DerivedPageContent";
import { PublishedPageExperience } from "../page/PublishedPageExperience";
import { CoreCamoxProvider, isLocalhostPreview } from "../provider/CoreCamoxProvider";
import { PageNavigationProvider } from "./pageNavigation";
import type { PageRenderInput } from "./runtime";

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
          <CoreCamoxProvider
            camoxApp={camoxApp}
            authenticationUrl={input.authenticationUrl}
            apiUrl={input.apiUrl}
            projectSlug={input.projectSlug}
            environmentName={input.environmentName}
          >
            <PageExperience camoxApp={camoxApp} input={input} queryClient={queryClient} />
          </CoreCamoxProvider>
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
    console.error(
      "Camox editing runtime failed to load; keeping the published page visible.",
      error,
    );
  }

  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

const subscribeToHydration = () => () => {};

function PageExperience({
  camoxApp,
  input,
  queryClient,
}: {
  camoxApp: CamoxApp;
  input: PageRenderInput;
  queryClient: QueryClient;
}) {
  const { isAuthenticated } = useAuthState();
  const hasHydrated = React.useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const [hasOtt] = React.useState(() => {
    if (typeof window === "undefined") return false;
    return new URL(window.location.href).searchParams.has("ott");
  });
  const local = isLocalhostPreview();
  const shouldActivateEditing = isAuthenticated || input.source === "draft" || hasOtt;
  const published = input.derived ? (
    <DerivedPageContent camoxApp={camoxApp} derived={input.derived} source={input.source} />
  ) : (
    <PublishedPageExperience source={input.source} />
  );

  // SSR and the first client render must share the same tree. Studio activation
  // (including the localhost shell) happens only after hydration completes.
  if (!hasHydrated) return published;

  if (shouldActivateEditing) {
    return (
      <EditingActivationBoundary fallback={published}>
        <React.Suspense fallback={published}>
          <LazyEditablePageExperience camoxApp={camoxApp} input={input} queryClient={queryClient} />
        </React.Suspense>
      </EditingActivationBoundary>
    );
  }

  if (local) {
    return (
      <EditingActivationBoundary fallback={published}>
        <React.Suspense fallback={published}>
          <LazyLocalhostPreviewProvider>{published}</LazyLocalhostPreviewProvider>
        </React.Suspense>
      </EditingActivationBoundary>
    );
  }

  return published;
}
