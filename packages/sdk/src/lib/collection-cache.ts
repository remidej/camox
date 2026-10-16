import type { QueryClient } from "@tanstack/react-query";

import { collectionQueries } from "./queries";

/** Refresh a collection's records in every placement, even without a realtime connection. */
export async function invalidateCollectionRecordViews(
  queryClient: QueryClient,
  projectSlug: string,
  collectionId: string,
) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: collectionQueries.records(projectSlug, collectionId).queryKey,
    }),
    queryClient.invalidateQueries({
      predicate: ({ queryKey }) =>
        queryKey[0] === "camox" && ["blocks", "pages", "layouts"].includes(String(queryKey[1])),
    }),
  ]);
}
