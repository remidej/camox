import { useMemo } from "react";

import { getPageDestinations } from "../core/pageDestinations";
import { useCamoxApp } from "../features/provider/components/CamoxAppContext";
import { useProjectSlug } from "../lib/auth";
import { reads, useReadQuery } from "../lib/studio-reads";

export function usePageDestinations() {
  const app = useCamoxApp();
  const projectSlug = useProjectSlug();
  const { data: project } = useReadQuery(reads.project({ slug: projectSlug }));
  const { data: pages } = useReadQuery(reads.pageList({ projectSlug }), {
    enabled: !!project,
  });
  return useMemo(() => getPageDestinations(pages ?? [], app.getLayouts()), [app, pages]);
}
