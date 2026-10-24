/** The event a publish with code gets when the entry before it in its project's queue left. */
export const PUBLISH_TURN_EVENT = "publish-turn";

/**
 * The event a publish waiting for its draft's merge of `main` gets once the merge ended, landed
 * or clashed (`../revisions/merge.ts`).
 */
export const DRAFT_MERGED_EVENT = "draft-merged";
