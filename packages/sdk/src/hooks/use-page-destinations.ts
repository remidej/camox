import { useMemo } from "react";

import { getPageDestinations } from "../core/pageDestinations";
import { useProjectUuid } from "../lib/auth";
import { linkablePages, useLinkablePages } from "../lib/link-pages";
import { useRoutableLayouts } from "../lib/studio-definitions";
import { reads, useReadQuery } from "../lib/studio-reads";

/** The pages of the locale viewed, which the studio navigates to. */
export function usePageDestinations() {
  const layouts = useRoutableLayouts();
  const projectUuid = useProjectUuid();
  const { data: project } = useReadQuery(reads.project({ projectUuid }));
  const { data: pages } = useReadQuery(reads.pageList({ projectUuid }), {
    enabled: !!project,
  });
  return useMemo(() => getPageDestinations(pages ?? [], layouts), [layouts, pages]);
}

/**
 * The pages a link picker offers in the locale viewed: the locale's own, then the default
 * locale's pages it misses, which links to them lead to (see `linkablePages`).
 */
export function useLinkDestinations() {
  const layouts = useRoutableLayouts();
  const { pages, fallbackPages } = useLinkablePages(useProjectUuid(), { fetchProject: true });
  return useMemo(
    () =>
      getPageDestinations(
        linkablePages(pages ?? [], fallbackPages).map(({ page }) => page),
        layouts,
      ),
    [layouts, pages, fallbackPages],
  );
}
