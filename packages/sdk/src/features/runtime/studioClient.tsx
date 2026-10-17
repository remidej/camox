import { QueryClient } from "@tanstack/react-query";
import { hydrateRoot } from "react-dom/client";

import type { CamoxApp } from "../../core/createApp";
import { readHydrationData } from "./hydrationData";
import { loadRuntimeChrome } from "./runtimeChromeLoader";
import { StudioApp, type StudioRenderInput } from "./studioApp";

export async function hydrateStudioWithApp(camoxApp: CamoxApp) {
  const root = document.getElementById("root");
  if (!root) throw new Error("Camox runtime root element was not found.");

  const queryClient = new QueryClient();
  const input = readHydrationData<StudioRenderInput>();
  // A member's document was rendered with the Studio chrome: hydrate it in place.
  if (input.presentation === "studio") await loadRuntimeChrome();
  hydrateRoot(root, <StudioApp camoxApp={camoxApp} input={input} queryClient={queryClient} />);
}
