import { useQuery } from "@tanstack/react-query";

import { commentQueries } from "@/lib/queries";

export function usePageComments(pageId: number | undefined) {
  return useQuery({
    ...commentQueries.list(pageId ?? 0),
    enabled: pageId != null,
  });
}
