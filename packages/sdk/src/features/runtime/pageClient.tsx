import { QueryClient } from "@tanstack/react-query";
import { hydrateRoot } from "react-dom/client";

import type { CamoxApp } from "../../core/createApp";
import { restoreArtifactSources } from "./artifactSources";
import { readHydrationData } from "./hydrationData";
import { PageApp } from "./pageApp";
import { getPageBlockTypes } from "./pageBlockTypes";
import type { PageRenderInput } from "./runtime";

export async function hydratePageWithApp(camoxApp: CamoxApp) {
  const root = document.getElementById("root");
  if (!root) throw new Error("Camox runtime root element was not found.");

  const queryClient = new QueryClient();
  const hydrationData = readHydrationData<PageRenderInput>();
  const input = {
    ...hydrationData,
    dehydratedState: restoreArtifactSources(hydrationData.dehydratedState, root),
  };
  // The server preloads these modules, so this rarely waits on the network. A block that
  // failed to load retries as it renders, and its error boundary contains a second failure.
  await camoxApp
    .loadBlocks(getPageBlockTypes(input.dehydratedState))
    .catch((error) => console.error("Camox: a block of this page failed to load.", error));

  hydrateRoot(root, <PageApp camoxApp={camoxApp} input={input} queryClient={queryClient} />);
}
