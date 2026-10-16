import type { Comment } from "@camox/api-contract";
import { DEVELOPMENT_DRAFT } from "@camox/api-contract/drafts";
import { queryKeys } from "@camox/api-contract/query-keys";
import { useQuery } from "@tanstack/react-query";

import { getCurrentDraftId } from "@/lib/studio-draft";

type AddressedIn = NonNullable<Comment["addressedIn"]>;

/**
 * Whether a comment needs no more attention where the studio is: resolved, or a Live comment
 * resolved from this very draft, which publishing it will resolve (#241).
 */
export function isSettledIn(
  comment: Pick<Comment, "resolved" | "addressedIn">,
  draftId: string | null,
): boolean {
  if (comment.resolved) return true;
  return draftId !== null && comment.addressedIn?.draftId === draftId;
}

/**
 * The id of the draft the studio is in, as comments name it. Dev mode is in `development`, which
 * comments name by its development draft's id: the studio's provider loads that draft
 * (`draftQueries.get`), and this reads it from the cache.
 */
export function useCommentDraftId(): string | null {
  const draftId = getCurrentDraftId();
  const developmentDraft = useQuery<{ id: string }>({
    queryKey: [...queryKeys.drafts.get, DEVELOPMENT_DRAFT],
    enabled: false,
  });
  if (draftId !== DEVELOPMENT_DRAFT) return draftId;
  return developmentDraft.data?.id ?? null;
}

/** A draft's name, or its creator and creation date when it has none (e.g. "Rémi, Oct 13"). */
export function draftLabel(draft: Pick<AddressedIn, "name" | "createdBy" | "createdAt">): string {
  if (draft.name) return draft.name;
  const date = new Date(draft.createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `${draft.createdBy.name}, ${date}`;
}
