import { queryKeys } from "@camox/api-contract/query-keys";

import { type ApiClient, getOrpc } from "./api-client";

export type Page = Awaited<ReturnType<ApiClient["pages"]["list"]>>[number];

export const viewPageQueries = {
  list: (projectId: number) => ({
    ...getOrpc().pages.list.queryOptions({ input: { projectId }, staleTime: Infinity }),
    queryKey: queryKeys.pages.list,
  }),
};

export const viewProjectQueries = {
  getBySlug: (slug: string) => ({
    ...getOrpc().projects.getBySlug.queryOptions({ input: { slug }, staleTime: Infinity }),
  }),
};

export const viewBlockQueries = {
  get: (id: string) => ({
    ...getOrpc().blocks.get.queryOptions({ input: { id }, staleTime: Infinity }),
    queryKey: queryKeys.blocks.get(id),
  }),
};
