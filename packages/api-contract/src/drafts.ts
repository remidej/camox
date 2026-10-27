import type { Router } from "./router.ts";

/** Request header naming the draft a request reads and writes (ADR 0011). Absent means Live. */
export const DRAFT_HEADER = "x-camox-draft";

/**
 * Request header naming, by its tag, the locale a request reads and writes content in (ADR
 * 0015). Absent means the project's default locale.
 */
export const LOCALE_HEADER = "x-camox-locale";

/**
 * Request header the Worker a publish with code uploaded sends on its public reads, naming
 * the draft it publishes (spec #560, section 13). While that draft is in its publishing state, a
 * read naming it sees Live overlaid with the draft, with no session, so the new code serves the
 * content it was previewed with from its first request. Once the draft has ended, or if it isn't
 * publishing, the read is Live's. A request naming a draft with `DRAFT_HEADER` ignores it.
 */
export const PUBLISHING_DRAFT_HEADER = "x-camox-publishing-draft";

/**
 * The Worker variable carrying the publishing draft's ID, which the publish sets on the Worker it
 * uploads (apps/api/src/domains/publishes/scripts.ts). The website's Worker sends it as
 * `PUBLISHING_DRAFT_HEADER`.
 */
export const PUBLISHING_DRAFT_VAR = "CAMOX_PUBLISHING_DRAFT";

/**
 * Request header asking the API to create the draft named by `DRAFT_HEADER` if it doesn't
 * exist yet. Its value is `"1"`.
 */
export const DRAFT_CREATE_HEADER = "x-camox-draft-create";

/** URL search param carrying the current draft's id in the studio and the rendered site. */
export const DRAFT_SEARCH_PARAM = "camox-draft";

/** How a draft ended. */
export type DraftOutcome = "published" | "deleted";

/** Who ended a draft, how and when, from its ended-drafts record (ADR 0009, ADR 0011). */
export type EndedDraft = {
  draftId: string;
  outcome: DraftOutcome;
  endedBy: { id: string; name: string };
  endedAt: number;
};

/**
 * The oRPC error code a request naming an ended draft fails with. Its `data` is an `EndedDraft`,
 * so a page can render Live and say who published or deleted the draft.
 */
export const DRAFT_ENDED_ERROR_CODE = "DRAFT_ENDED";

/**
 * oRPC error code for a publish whose token no longer matches Live: Live changed since the
 * preview, so nothing was applied and the caller reviews the new preview.
 */
export const CONFLICTS_CHANGED_ERROR = "CONFLICTS_CHANGED";

/**
 * oRPC error code for a publish of a draft with code whose revision isn't the one the review
 * showed: the agent left a newer one, or the draft is already publishing. The caller reviews
 * the new preview.
 */
export const REVISION_CHANGED_ERROR = "REVISION_CHANGED";

/**
 * Why a publish with code went back to the review instead of landing: the agent left a revision
 * after the one the review showed, Live's conflicts changed, the draft got a blocker, Live's code
 * moved and the draft's merge of it clashed (the "doesn't merge with Live's" blocker, which
 * Camox's turn fixes), Live's code moved and the draft took too long to merge it, or the publish
 * failed on Camox's side.
 */
export const PUBLISH_ABORT_REASONS = [
  "revisionChanged",
  "conflictsChanged",
  "blocked",
  "codeDoesNotMerge",
  "liveCodeMoved",
  "failed",
] as const;

export type PublishAbortReason = (typeof PUBLISH_ABORT_REASONS)[number];

/** oRPC error code for a publish refused because the draft still has blockers. */
export const PUBLISH_BLOCKED_ERROR = "PUBLISH_BLOCKED";

/**
 * oRPC error code for a publish refused because the draft still has pending translations: every
 * locale goes live together, unless the caller publishes anyway (ADR 0017).
 */
export const TRANSLATIONS_PENDING_ERROR = "TRANSLATIONS_PENDING";

/**
 * Why the publish tool published nothing of a draft with changes, and returned a fresh preview to
 * review again, by the error code of each: Live changed since the preview, the draft has blockers,
 * translations are still running, or the draft's code changed since the preview.
 */
export const NOT_PUBLISHED_CODES = {
  conflictsChanged: CONFLICTS_CHANGED_ERROR,
  blocked: PUBLISH_BLOCKED_ERROR,
  translating: TRANSLATIONS_PENDING_ERROR,
  revisionChanged: REVISION_CHANGED_ERROR,
} as const;

export type NotPublishedReason = keyof typeof NOT_PUBLISHED_CODES;

/**
 * Who Camox's own work is by: the creator of the drafts it opens to catch translations up, their
 * publisher on Live, and who ended them. Shown as "Camox".
 */
export const CAMOX_ACTOR = "camox";

/** The name Camox's own work shows under. */
export const CAMOX_NAME = "Camox";

/**
 * oRPC error code for a content write that names no draft. Live is read-only (ADR 0003): content
 * changes reach it only by publishing a draft, or through a release.
 */
export const LIVE_READ_ONLY_ERROR = "LIVE_READ_ONLY";

// Whether each procedure of a router that follows drafts writes content. Live is read-only
// (ADR 0003), so the API rejects a content write naming no draft, and the studio starts a draft
// for one on Live. Every procedure is listed, so a new one fails the type check until it's
// classified and can't be forgotten. Procedures that only fill a generated value (ADR 0012),
// like `generateSummary`, write no content. A synced block's shared content is written through
// `blocks` and `repeatableItems`. Releases aren't listed.
const BLOCK_WRITES: Record<keyof Router["blocks"], boolean> = {
  get: false,
  getPageMarkdown: false,
  getLayoutMarkdown: false,
  getUsageCounts: false,
  getPagesUsing: false,
  getSyncedContent: false,
  create: true,
  updateContent: true,
  updateSettings: true,
  updatePosition: true,
  delete: true,
  deleteMany: true,
  generateSummary: false,
  duplicate: true,
};

const COLLECTION_WRITES: Record<keyof Router["collectionDefinitions"], boolean> = {
  list: false,
  get: false,
  listRecords: false,
  getRecord: false,
  getRecordUsageCount: false,
  findRecordsByField: false,
  listRecordPageValues: false,
  recordMarkdown: false,
  createRecord: true,
  editRecord: true,
  deleteRecord: true,
};

// Uploads and replacements are content writes too, outside oRPC.
const FILE_WRITES: Record<keyof Router["files"], boolean> = {
  list: false,
  get: false,
  getUsageCount: false,
  setAlt: true,
  setFilename: true,
  delete: true,
  deleteMany: true,
  // Switching AI metadata on or off changes content (ADR 0012); generating only fills it.
  setAiMetadata: true,
  generateMetadata: false,
};

const PAGE_WRITES: Record<keyof Router["pages"], boolean> = {
  getByPath: false,
  getStructure: false,
  getMarkdown: false,
  list: false,
  listBySlug: false,
  get: false,
  create: true,
  update: true,
  delete: true,
  // Switching AI SEO on or off changes content (ADR 0012), like writing either field.
  setSeo: true,
  setLayout: true,
  generateSeo: false,
};

const ITEM_WRITES: Record<keyof Router["repeatableItems"], boolean> = {
  get: false,
  create: true,
  updateContent: true,
  updateSettings: true,
  updatePosition: true,
  duplicate: true,
  generateSummary: false,
  delete: true,
};

// Correcting the default locale's tag changes no content, so it needs no draft (ADR 0015).
const LOCALE_WRITES: Record<keyof Router["locales"], boolean> = {
  list: false,
  add: true,
  remove: true,
  setDefaultTag: false,
  listMissing: false,
  addBack: true,
};

// `definitions` is absent: its sync is a release, never a studio content write.
const CONTENT_WRITES: Partial<Record<keyof Router, Record<string, boolean>>> = {
  blocks: BLOCK_WRITES,
  locales: LOCALE_WRITES,
  collectionDefinitions: COLLECTION_WRITES,
  files: FILE_WRITES,
  pages: PAGE_WRITES,
  repeatableItems: ITEM_WRITES,
};

/** Whether the procedure at `path` (`[router, procedure]`) writes content. */
export function isContentWrite(path: readonly string[]): boolean {
  if (path.length !== 2) return false;
  return CONTENT_WRITES[path[0] as keyof Router]?.[path[1]] === true;
}
