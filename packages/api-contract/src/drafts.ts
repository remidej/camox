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
