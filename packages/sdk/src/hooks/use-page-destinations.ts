import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { getPageDestinations } from "../core/pageDestinations";
import { useCamoxApp } from "../features/provider/components/CamoxAppContext";
import { useProjectSlug } from "../lib/auth";
import { pageQueries, projectQueries } from "../lib/queries";

export function usePageDestinations() {
  const app = useCamoxApp();
  const projectSlug = useProjectSlug();
  const { data: project } = useQuery(projectQueries.getBySlug(projectSlug));
  const { data: pages } = useQuery({
    ...pageQueries.list(project?.id ?? 0),
    enabled: !!project,
  });
  return useMemo(() => getPageDestinations(pages ?? [], app.getLayouts()), [app, pages]);
}
