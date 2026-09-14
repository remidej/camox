import { queryKeys } from "@camox/api-contract/query-keys";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";

import type { CamoxApp } from "../../core/createApp";
import { getApiClient } from "../../lib/api-client";
import { useIsAuthenticated, useProjectSlug } from "../../lib/auth";
import { seedBlockCaches } from "../../lib/normalized-data";
import { DerivedPageContent } from "../page/DerivedPageContent";
import type { PageRenderInput } from "../runtime/runtime";
import { PreviewShell } from "./CamoxPreview";
import { previewStore } from "./previewStore";

type DerivedPreviewProps = {
  camoxApp: CamoxApp;
  derived: NonNullable<PageRenderInput["derived"]>;
  source: PageRenderInput["source"];
};

export function DerivedPreview(props: DerivedPreviewProps) {
  const isAuthenticated = useIsAuthenticated();
  if (!isAuthenticated) return <DerivedPageContent {...props} />;
  return <AuthenticatedDerivedPreview {...props} />;
}

function AuthenticatedDerivedPreview({ camoxApp, derived, source }: DerivedPreviewProps) {
  const previewSource = useSelector(previewStore, (state) => state.context.previewSource);
  const projectSlug = useProjectSlug();
  const queryClient = useQueryClient();
  const { data: layout } = useSuspenseQuery({
    queryKey: [...queryKeys.layouts.all, "get", projectSlug, derived.layout.id, previewSource],
    queryFn: async () => {
      const result = await getApiClient().layouts.get({
        projectSlug,
        layoutId: derived.layoutId,
        source: previewSource,
      });
      seedBlockCaches(queryClient, result, previewSource);
      return result.layout;
    },
    // Only the SSR source has seeded block caches. Never seed a draft with live content.
    initialData: previewSource === source ? derived.layout : undefined,
    staleTime: 0,
  });

  return (
    <PreviewShell
      hasLiveVersion={layout.livePublishedCheckpointId != null}
      derivedLayoutId={derived.layoutId}
      derivedLayout={layout}
    >
      <DerivedPageContent
        camoxApp={camoxApp}
        derived={{ ...derived, layout }}
        source={previewSource}
      />
    </PreviewShell>
  );
}
