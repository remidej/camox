import type { Router } from "./index.ts";

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

/** Who ended a draft, how and when, from its ended-drafts record (ADR 0009, ADR 0011). */
export type EndedDraft = {
  draftId: string;
  outcome: DraftOutcome;
  endedBy: { id: string; name: string };
  endedAt: number;
};

/**
 * The oRPC error code a request naming an ended draft fails with. Its `data` is an `EndedDraft`,
 * so a page can render Live and say who published or discarded the draft.
 */
export const DRAFT_ENDED_ERROR_CODE = "DRAFT_ENDED";

/**
 * oRPC error code for a publish whose token no longer matches Live: Live changed since the
 * preview, so nothing was applied and the caller reviews the new preview.
 */
export const CONFLICTS_CHANGED_ERROR = "CONFLICTS_CHANGED";

/** oRPC error code for a publish refused because the draft still has blockers. */
export const PUBLISH_BLOCKED_ERROR = "PUBLISH_BLOCKED";

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
// `blocks` and `repeatableItems`. Comments are written where you are, Live included, so their
// router isn't listed; neither are releases and dev-mode sync.
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

// A release syncs collection definitions; it never runs in the studio.
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
  sync: false,
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
  list: false,
  listBySlug: false,
  get: false,
  create: true,
  update: true,
  delete: true,
  setAiSeo: true,
  setMetaTitle: true,
  setMetaDescription: true,
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

const CONTENT_WRITES: Partial<Record<keyof Router, Record<string, boolean>>> = {
  blocks: BLOCK_WRITES,
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
