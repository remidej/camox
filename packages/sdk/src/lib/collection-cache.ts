import { queryKeys } from "@camox/api-contract/query-keys";
import type { QueryClient } from "@tanstack/react-query";

/**
 * Refresh a collection's records in every placement, even without a realtime connection. Every
 * scope's list refetches: other drafts read the records Live shows wherever they change none.
 */
export async function invalidateCollectionRecordViews(
  queryClient: QueryClient,
  projectSlug: string,
  collectionId: string,
) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: queryKeys.collections.records(projectSlug, collectionId),
    }),
    queryClient.invalidateQueries({
      predicate: ({ queryKey }) =>
        queryKey[0] === "camox" && ["blocks", "pages", "layouts"].includes(String(queryKey[1])),
    }),
  ]);
}
