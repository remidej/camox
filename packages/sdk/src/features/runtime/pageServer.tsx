import { QueryClient, hydrate, dehydrate } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";

import type { CamoxApp } from "../../core/createApp";
import { prefetchIcons } from "../../core/lib/icons";
import { PageApp } from "./pageApp";
import type { PageRenderInput } from "./runtime";

export async function renderPageWithApp(input: PageRenderInput & { camoxApp: CamoxApp }) {
  const queryClient = new QueryClient();
  hydrate(queryClient, input.dehydratedState);
  await prefetchIcons(
    queryClient,
    input.dehydratedState,
    input.camoxApp.getSerializableDefinitions(),
  );
  // The runtime wrapper shallow-copies input. Preserve the shared state object
  // so the document serializer includes the SVGs fetched for this render.
  Object.assign(input.dehydratedState as object, dehydrate(queryClient));

  return renderToString(
    <PageApp camoxApp={input.camoxApp} input={input} queryClient={queryClient} />,
  );
}
