import { routeSegments } from "../../core/derivedRoutes";
import { useProjectUuid } from "../../lib/auth";
import { useLayoutDefinitions } from "../../lib/studio-definitions";
import { reads, useReadQueries } from "../../lib/studio-reads";

/**
 * Each derived layout's first discovered page, keyed by layout id. Only a layout with params
 * needs one. Whether it discovers pages is its code's to say: the runtime runs it, and answers
 * no page for a layout without routes.
 */
export function useDiscoveredPreviewPaths(runtimeBasePath: string) {
  const projectUuid = useProjectUuid();
  const ids = useLayoutDefinitions()
    .filter(
      (layout) =>
        layout.kind === "derived" &&
        routeSegments(layout.id).some((segment) => segment.startsWith("$")),
    )
    .map(({ id }) => id);
  return useReadQueries(
    ids.map((layoutId) => reads.discoveredPath({ projectUuid, runtimeBasePath, layoutId })),
    // Without a discovered page, the frame asks for a path, as it does without routes.
    (results) =>
      new Map(results.flatMap(({ data }, index) => (data ? [[ids[index]!, data] as const] : []))),
  );
}
