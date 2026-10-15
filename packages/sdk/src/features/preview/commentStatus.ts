import type { Comment } from "@camox/api-contract";

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

/** A draft's name, or its creator and creation date when it has none (e.g. "Rémi, Oct 13"). */
export function draftLabel(draft: Pick<AddressedIn, "name" | "createdBy" | "createdAt">): string {
  if (draft.name) return draft.name;
  const date = new Date(draft.createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `${draft.createdBy.name}, ${date}`;
}
