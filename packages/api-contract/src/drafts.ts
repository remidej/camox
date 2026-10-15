/** Request header naming the draft a request reads and writes (ADR 0011). Absent means Live. */
export const DRAFT_HEADER = "x-camox-draft";

/**
 * Request header asking the API to create the draft named by `DRAFT_HEADER` if it doesn't
 * exist yet. Its value is `"1"`.
 */
export const DRAFT_CREATE_HEADER = "x-camox-draft-create";

/** URL search param carrying the current draft's id in the studio and the rendered site. */
export const DRAFT_SEARCH_PARAM = "camox-draft";

/** A regular draft is a named set of edits; a development draft backs a dev server. */
export type DraftKind = "regular" | "development";

/** How a regular draft ended. */
export type DraftOutcome = "published" | "discarded";

/**
 * A regular draft that was published or discarded: who ended it and when. Requests naming it
 * fail with `DRAFT_ENDED_ERROR_CODE` (status 410) carrying this as `data`.
 */
export type EndedDraft = {
  draftId: string;
  outcome: DraftOutcome;
  endedBy: { id: string; name: string };
  endedAt: number;
};

/** oRPC error code for a request naming a draft that was published or discarded. */
export const DRAFT_ENDED_ERROR_CODE = "DRAFT_ENDED";

/**
 * oRPC error code for a publish whose token no longer matches Live: Live changed since the
 * preview, so nothing was applied and the caller reviews the new preview.
 */
export const CONFLICTS_CHANGED_ERROR = "CONFLICTS_CHANGED";

/** oRPC error code for a publish refused because the draft still has blockers. */
export const PUBLISH_BLOCKED_ERROR = "PUBLISH_BLOCKED";
