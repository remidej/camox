import { useMemo } from "react";

import { getPageDestinations } from "../core/pageDestinations";
import { useCamoxApp } from "../features/provider/components/CamoxAppContext";
import { useProjectSlug } from "../lib/auth";
import { linkablePages, useLinkablePages } from "../lib/link-pages";
import { reads, useReadQuery } from "../lib/studio-reads";

/** The pages of the locale viewed, which the studio navigates to. */
export function usePageDestinations() {
  const app = useCamoxApp();
  const projectSlug = useProjectSlug();
  const { data: project } = useReadQuery(reads.project({ slug: projectSlug }));
  const { data: pages } = useReadQuery(reads.pageList({ projectSlug }), {
    enabled: !!project,
  });
  return useMemo(() => getPageDestinations(pages ?? [], app.getLayouts()), [app, pages]);
}

/**
 * The pages a link picker offers in the locale viewed: the locale's own, then the default
 * locale's pages it misses, which links to them lead to (see `linkablePages`).
 */
export function useLinkDestinations() {
  const app = useCamoxApp();
  const { pages, fallbackPages } = useLinkablePages(useProjectSlug(), { fetchProject: true });
  return useMemo(
    () =>
      getPageDestinations(
        linkablePages(pages ?? [], fallbackPages).map(({ page }) => page),
        app.getLayouts(),
      ),
    [app, pages, fallbackPages],
  );
}
