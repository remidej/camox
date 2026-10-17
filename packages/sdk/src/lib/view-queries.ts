import { queryKeys } from "@camox/api-contract/query-keys";
import { useQuery } from "@tanstack/react-query";

import { type ApiClient, getOrpc } from "./api-client";
import { useProjectSlug } from "./auth";
import { useDraftScope, type DraftScope } from "./draft-scope";

export type Page = Awaited<ReturnType<ApiClient["pages"]["list"]>>[number];

export const viewPageQueries = {
  list: (scope: DraftScope, projectId: number) => ({
    ...getOrpc().pages.list.queryOptions({ input: { projectId }, staleTime: Infinity }),
    queryKey: scope.keyFor(queryKeys.pages.list),
  }),
};

export const viewProjectQueries = {
  getBySlug: (slug: string) => ({
    ...getOrpc().projects.getBySlug.queryOptions({ input: { slug }, staleTime: Infinity }),
  }),
};

export const viewBlockQueries = {
  get: (scope: DraftScope, id: string) => ({
    ...getOrpc().blocks.get.queryOptions({ input: { id }, staleTime: Infinity }),
    queryKey: scope.keyFor(queryKeys.blocks.get(id)),
  }),
};

/**
 * The site's pages, to resolve links. Every page render seeds them, so the list is read from the
 * cache. Only a member, whose project the Studio caches, refetches it after a change.
 */
export function useViewPages() {
  const draftScope = useDraftScope();
  const projectSlug = useProjectSlug();
  // Cache only: an anonymous visitor may not read the project, so fetching it would fail.
  const { data: project } = useQuery({
    ...viewProjectQueries.getBySlug(projectSlug),
    enabled: false,
  });
  const { data: pages } = useQuery({
    ...viewPageQueries.list(draftScope, project?.id ?? 0),
    enabled: !!project,
  });
  return pages as Page[] | undefined;
}
