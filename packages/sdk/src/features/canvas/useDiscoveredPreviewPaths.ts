import { useProjectUuid } from "../../lib/auth";
import { reads, useReadQueries } from "../../lib/studio-reads";
import { useCamoxApp } from "../provider/components/CamoxAppContext";

/** Each derived layout's first discovered page, keyed by layout id. */
export function useDiscoveredPreviewPaths(runtimeBasePath: string) {
  const projectUuid = useProjectUuid();
  const layouts = useCamoxApp()
    .getLayouts()
    .filter((layout) => layout._internal.kind === "derived" && layout._internal.routes);
  const ids = layouts.map(({ _internal: { id } }) => id);
  return useReadQueries(
    ids.map((layoutId) => reads.discoveredPath({ projectUuid, runtimeBasePath, layoutId })),
    // Without a discovered page, the frame asks for a path, as it does without routes.
    (results) =>
      new Map(results.flatMap(({ data }, index) => (data ? [[ids[index]!, data] as const] : []))),
  );
}
