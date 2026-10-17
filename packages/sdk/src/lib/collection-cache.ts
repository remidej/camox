import { queryKeys } from "@camox/api-contract/query-keys";

import type { StudioCache } from "./studio-reads";

/**
 * Refreshes a collection's records in every placement, in every scope, as the API's broadcast
 * after a record edit does, so the edit shows even without a realtime connection.
 */
export function invalidateCollectionRecordViews(
  studioCache: StudioCache,
  projectSlug: string,
  collectionId: string,
) {
  return studioCache.receive(
    {
      type: "invalidate",
      // A Live change: other drafts read the records Live shows wherever they change none.
      draftId: null,
      targets: [
        queryKeys.collections.records(projectSlug, collectionId),
        ["camox", "blocks"],
        queryKeys.pages.getByPathAll,
        queryKeys.pages.list,
        queryKeys.layouts.all,
      ],
    },
    0,
  );
}
