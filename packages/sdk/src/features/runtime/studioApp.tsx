import type { QueryClient } from "@tanstack/react-query";

import type { CamoxApp } from "../../core/createApp";
import { PageApp } from "./pageApp";
import type { PageRenderInput } from "./runtime";

// Both document entry points hydrate the same app so navigation can cross the
// preview/studio boundary without replacing providers or the navbar.
export type StudioRenderInput = PageRenderInput;

export function StudioApp(props: {
  camoxApp: CamoxApp;
  input: StudioRenderInput;
  queryClient: QueryClient;
}) {
  return <PageApp {...props} />;
}
