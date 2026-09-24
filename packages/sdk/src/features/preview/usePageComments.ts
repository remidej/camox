import { useQuery } from "@tanstack/react-query";

import { commentQueries } from "@/lib/queries";

import { areCommentsEnabled } from "./commentsEnabled";

export function usePageComments(pageId: number | undefined) {
  return useQuery({
    ...commentQueries.list(pageId ?? 0),
    enabled: areCommentsEnabled() && pageId != null,
  });
}
