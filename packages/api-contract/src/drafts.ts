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
 * Request header carrying a look token (ADR 0032): a short-lived, read-only credential the API
 * signs for the agent's `look` tool, naming one project and one draft. A request carrying a valid
 * one reads that draft's content, named with `DRAFT_HEADER`, as a member would, without a session.
 * It writes nothing, reads no other draft, and reads none of Live's private data.
 */
export const LOOK_TOKEN_HEADER = "x-camox-look-token";

/**
 * The cookie the browser `look` drives carries the look token in, set for the website's host
 * only, so third-party requests never see it. The website forwards it as `LOOK_TOKEN_HEADER`.
 */
export const LOOK_TOKEN_COOKIE = "camox_look";

/**
 * The website's lightweight document the browser `look` drives loads (the SDK runtime's
 * `RUNTIME_ROUTE_PATHS.look`): one page of the draft `DRAFT_SEARCH_PARAM` names, at the path
 * `LOOK_PATH_PARAM` gives in the locale `LOOK_LOCALE_PARAM` names, its Default Locale without.
 */
export const LOOK_DOCUMENT_PATH = "/_camox/look";
export const LOOK_PATH_PARAM = "path";
export const LOOK_LOCALE_PARAM = "locale";

/**
 * The look document's Block Definition mode: instead of a page, the block of the Block Definition
 * `LOOK_BLOCK_DEFINITION_PARAM` names, alone in the site's shell, with its default content and
 * Block Settings and the overrides `LOOK_CONTENT_PARAM` and `LOOK_SETTINGS_PARAM` give as JSON, in
 * the shape the content tools take.
 */
export const LOOK_BLOCK_DEFINITION_PARAM = "blockDefinition";
export const LOOK_CONTENT_PARAM = "content";
export const LOOK_SETTINGS_PARAM = "settings";

/**
 * The id of a block shown without being placed, as the look document's Block Definition mode
 * shows it: never a stored block's, which are UUIDs. Its element is
 * `[data-camox-viewport-block="unplaced"]`.
 */
export const UNPLACED_BLOCK_ID = "unplaced";

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
 * locale goes live together, and there is no publishing anyway (ADR 0033).
 */
export const TRANSLATIONS_PENDING_ERROR = "TRANSLATIONS_PENDING";

/**
 * oRPC error code for a publish refused because the draft has open findings, each to fix or for a
 * member to dismiss: there is no publishing past them (ADR 0033).
 */
export const FINDINGS_OPEN_ERROR = "FINDINGS_OPEN";

/**
 * oRPC error code for a publish refused because a patroller's check at publish hasn't read the
 * draft's latest changes yet: publishing waits for it (ADR 0033).
 */
export const CHECKS_RUNNING_ERROR = "CHECKS_RUNNING";

/**
 * Why the publish tool published nothing of a draft with changes, and returned a fresh preview to
 * review again, by the error code of each: Live changed since the preview, the draft has blockers,
 * translations are still running, the draft has open findings, a check at publish is still
 * running, or the draft's code changed since the preview.
 */
export const NOT_PUBLISHED_CODES = {
  conflictsChanged: CONFLICTS_CHANGED_ERROR,
  blocked: PUBLISH_BLOCKED_ERROR,
  translating: TRANSLATIONS_PENDING_ERROR,
  findings: FINDINGS_OPEN_ERROR,
  checking: CHECKS_RUNNING_ERROR,
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
  getUnplaced: false,
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

// Applying a finding's fix edits content as the member would; dismissing one is the project's,
// never content (ADR 0034).
const PATROL_WRITES: Record<keyof Router["patrol"], boolean> = {
  get: false,
  applyFix: true,
  dismissFinding: false,
};

// `definitions` is absent: its sync is a release, never a studio content write.
const CONTENT_WRITES: Partial<Record<keyof Router, Record<string, boolean>>> = {
  blocks: BLOCK_WRITES,
  locales: LOCALE_WRITES,
  collectionDefinitions: COLLECTION_WRITES,
  files: FILE_WRITES,
  pages: PAGE_WRITES,
  patrol: PATROL_WRITES,
  repeatableItems: ITEM_WRITES,
};

/** Whether the procedure at `path` (`[router, procedure]`) writes content. */
export function isContentWrite(path: readonly string[]): boolean {
  if (path.length !== 2) return false;
  return CONTENT_WRITES[path[0] as keyof Router]?.[path[1]] === true;
}
