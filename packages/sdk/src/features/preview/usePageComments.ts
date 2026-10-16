import { useQuery } from "@tanstack/react-query";

import { commentQueries } from "@/lib/queries";

export function usePageComments(pageId: string | undefined) {
  return useQuery({
    ...commentQueries.list(pageId ?? ""),
    enabled: pageId != null,
  });
}
