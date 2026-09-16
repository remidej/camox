import { queryKeys } from "@camox/api-contract/query-keys";
import { useQuery } from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";
import type { ReactNode } from "react";
import studioCssUrl from "virtual:camox-studio-css";

import { getApiClient } from "../../lib/api-client";
import { PreviewToolbar } from "../preview/components/PreviewToolbar";
import { previewStore, selectPreviewSource } from "../preview/previewStore";
import type { PageStructure } from "../routes/pageRuntime";
import { Navbar } from "../studio/components/Navbar";
import type { PageRenderInput } from "./runtime";
import { SharedChromeContext } from "./SharedChromeContext";

export function RuntimeChrome({
  input,
  children,
}: {
  input: PageRenderInput;
  children: ReactNode;
}) {
  const preview = !input.routeKind;
  const hidden = useSelector(previewStore, (state) => state.context.isToolbarHidden);
  const source = useSelector(previewStore, selectPreviewSource);
  const { data: page } = useQuery<PageStructure>({
    queryKey: queryKeys.pages.getByPath(input.pathname, source),
    // A passive observer still needs a real queryFn: Suspense may start fetching
    // this shared query before the preview's observer has committed its options.
    queryFn: () =>
      getApiClient().pages.getStructure({
        path: input.pathname,
        projectSlug: input.projectSlug,
        source,
      }),
    enabled: false,
  });

  return (
    <SharedChromeContext.Provider value={true}>
      <link rel="stylesheet" href={studioCssUrl} data-camox-studio />
      <div className="bg-background flex h-screen flex-col overflow-hidden">
        <div className={preview ? "max-md:hidden" : undefined} hidden={preview && hidden}>
          <Navbar isPreview={preview} />
        </div>
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col overflow-auto">{children}</div>
          {/* Kept at a stable position, outside route Suspense and editor imports. */}
          <div hidden={!preview} className={input.derived ? undefined : "max-md:hidden"}>
            <PreviewToolbar
              pageStatus={preview && !input.derived ? page?.page.status : undefined}
              hasLiveVersion={!!page?.page.livePublishedCheckpointId}
            />
          </div>
        </div>
      </div>
    </SharedChromeContext.Provider>
  );
}
