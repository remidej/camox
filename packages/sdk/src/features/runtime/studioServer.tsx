import { type DehydratedState, QueryClient, hydrate } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";

import type { CamoxApp } from "../../core/createApp";
import { StudioApp, type StudioRenderInput } from "./studioApp";

export async function renderStudioWithApp(input: StudioRenderInput & { camoxApp: CamoxApp }) {
  const queryClient = new QueryClient();
  hydrate(queryClient, input.dehydratedState as DehydratedState);

  return renderToString(
    <StudioApp camoxApp={input.camoxApp} input={input} queryClient={queryClient} />,
  );
}
