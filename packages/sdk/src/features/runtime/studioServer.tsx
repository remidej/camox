import { type DehydratedState, QueryClient, hydrate } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";

import type { CamoxApp } from "../../core/createApp";
import { createDraftScope } from "../../lib/draft-scope";
import { loadRuntimeChrome } from "./runtimeChromeLoader";
import { StudioApp, type StudioRenderInput } from "./studioApp";

export async function renderStudioWithApp(input: StudioRenderInput & { camoxApp: CamoxApp }) {
  const queryClient = new QueryClient();
  hydrate(queryClient, input.dehydratedState as DehydratedState);
  if (input.presentation === "studio") await loadRuntimeChrome();

  // Each request renders in its own draft scope, so its queries read the keys it seeded.
  const draftScope = createDraftScope({ queryClient });
  return renderToString(
    <StudioApp
      camoxApp={input.camoxApp}
      draftScope={draftScope}
      input={input}
      queryClient={queryClient}
    />,
  );
}
