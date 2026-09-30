import { queryKeys } from "@camox/api-contract/query-keys";
import type { QueryClient } from "@tanstack/react-query";

import { collectionQueries } from "./queries";

/** Refresh source drafts in every placement, even without a realtime connection.
 * Live caches stay untouched until an explicit publication operation.
 */
export async function invalidateCollectionRecordViews(
  queryClient: QueryClient,
  projectSlug: string,
  collectionId: string,
) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: collectionQueries.records(projectSlug, collectionId).queryKey,
    }),
    queryClient.invalidateQueries({ queryKey: queryKeys.pages.list }),
    queryClient.invalidateQueries({
      predicate: ({ queryKey }) =>
        queryKey[0] === "camox" &&
        ["blocks", "pages", "layouts"].includes(String(queryKey[1])) &&
        queryKey.at(-1) === "draft",
    }),
  ]);
}
