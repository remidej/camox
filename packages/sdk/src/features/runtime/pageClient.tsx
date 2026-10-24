import { QueryClient } from "@tanstack/react-query";
import { hydrateRoot } from "react-dom/client";

import type { CamoxApp } from "../../core/createApp";
import { createDraftScope } from "../../lib/draft-scope";
import { restoreArtifactSources } from "./artifactSources";
import { readHydrationData } from "./hydrationData";
import { PageApp } from "./pageApp";
import { getPageBlockTypes } from "./pageBlockTypes";
import type { PageRenderInput } from "./runtime";
import { loadRuntimeChrome } from "./runtimeChromeLoader";

export async function hydratePageWithApp(camoxApp: CamoxApp) {
  const root = document.getElementById("root");
  if (!root) throw new Error("Camox runtime root element was not found.");

  const queryClient = new QueryClient();
  const hydrationData = readHydrationData<PageRenderInput>();
  const input = {
    ...hydrationData,
    dehydratedState: restoreArtifactSources(hydrationData.dehydratedState, root),
  };
  // A member's document was rendered with the Studio chrome, and no block: hydrate it in place,
  // leaving the site's code to the renderer frame. A visitor's page loads its blocks first. The
  // server preloads these modules, so this rarely waits on the network. A block that failed to
  // load retries as it renders, and its error boundary contains a second failure.
  await (input.presentation === "studio"
    ? loadRuntimeChrome()
    : camoxApp
        .loadBlocks(getPageBlockTypes(input.dehydratedState))
        .catch((error) => console.error("Camox: a block of this page failed to load.", error)));

  const draftScope = createDraftScope({ queryClient, browser: window });
  hydrateRoot(
    root,
    <PageApp camoxApp={camoxApp} draftScope={draftScope} input={input} queryClient={queryClient} />,
  );
}
