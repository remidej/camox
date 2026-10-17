import { useProjectSlug } from "./auth";
import type { Page } from "./queries";
import { reads, useReadQuery } from "./studio-reads";

/**
 * The site's pages, to resolve links. Every page render seeds them, so the list is read from the
 * cache. Only a member, whose project the Studio caches, refetches it after a change.
 */
export function useViewPages(): Page[] | undefined {
  const projectSlug = useProjectSlug();
  // Cache only: an anonymous visitor may not read the project, so fetching it would fail.
  const { data: project } = useReadQuery(reads.project({ slug: projectSlug }), { enabled: false });
  const { data: pages } = useReadQuery(reads.pageList({ projectSlug }), { enabled: !!project });
  return pages;
}
