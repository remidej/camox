/**
 * The Patrol (ADR 0024): every patroller of a project, the work each did as reports, as the
 * studio shows it at the top of the Agent Sidebar. The API reads it for one scope, a draft or
 * Live, and names each report's subject, so the studio needs no entity loaded to show it.
 */

/** A patroller's stable id. The registry in the API lists them all. */
export type PatrollerId = "translator" | "seoManager";

/**
 * What a structured report says was done. Each has a failed form, by the report's outcome. A
 * merge with Live's localization reads as a translation.
 */
export type ReportVerb =
  | "translated"
  | "mergedWithLive"
  | "wroteSeo"
  | "describedFile"
  | "publishedCatchUp";

/** What a report can be about. */
export type ReportEntity =
  | "page"
  | "block"
  | "sharedContent"
  | "repeatableItem"
  | "record"
  | "file";

/** A report's subject, named as the Canvas names it, read when the Patrol is. */
export type ReportSubject = { entity: ReportEntity; id: string; name: string };

/**
 * What a report says: structured facts the studio turns into a sentence, in the studio's
 * language, or text an AI wrote, shown as is. `locale` is a locale's tag.
 */
export type ReportSummary =
  | {
      kind: "structured";
      verb: ReportVerb;
      subject: ReportSubject | null;
      locale: string | null;
    }
  | { kind: "text"; text: string };

/** The locale a summary's work was in: a structured summary's, if any. A text summary has none. */
export const reportLocale = (
  summary: { kind: "structured"; locale: string | null } | { kind: "text" },
) => (summary.kind === "structured" ? summary.locale : null);

/** Whether the work was done, or failed. A failure shows in its report only. */
export type ReportOutcome = "done" | "failed";

/** Whether a report needs a human. Nothing raises one yet. */
export type AttentionLevel = "none" | "needed";

/**
 * Where the studio shows a report's subject: a page on the Canvas, with the block and repeatable
 * item to select on it, a collection record, or a file.
 */
export type ReportPlace =
  | { kind: "page"; pageId: string; blockId: string | null; itemId: string | null }
  | { kind: "record"; collectionId: string; recordId: string }
  | { kind: "file"; fileId: string };

export type ReportView = {
  /** Unique among the patroller's reports in the view. */
  id: string;
  summary: ReportSummary;
  outcome: ReportOutcome;
  attention: AttentionLevel;
  /** When the work last settled, in milliseconds since the epoch. */
  at: number;
  /** Whether the report is Live's, seen from a draft or from Live. */
  live: boolean;
  /**
   * Where its subject shows, in the report's scope and locale. Null without a subject, or for one
   * with no single place, such as a synced block's shared content or a layout's block.
   */
  place: ReportPlace | null;
};

/** How many subjects a patroller is on in one locale, a locale's tag. */
export type LocaleCount = { locale: string; count: number };

/**
 * What a patroller is on: the one subject when there's one, and how many subjects in each
 * locale, the most first. A subject in several locales counts in each.
 */
export type PatrollerWorking = {
  subject: ReportSubject | null;
  locales: LocaleCount[];
};

export type PatrollerView = {
  id: PatrollerId;
  /** Its role, as editors know it: "Translator", "SEO manager". */
  role: string;
  /** Null when it isn't working in the scope. */
  working: PatrollerWorking | null;
  /** Its latest activity in the scope, or null when it never worked there. */
  lastActivityAt: number | null;
  /** Its newest reports, newest first. */
  reports: ReportView[];
  /** How many more reports it has than `reports` shows, per locale, the most first. */
  more: { locale: string | null; count: number }[];
};

/** Every patroller of the registry, the latest activity first; never-worked ones last. */
export type PatrolView = { patrollers: PatrollerView[] };

/** How many reports the Patrol shows of each patroller; the rest are counted. */
export const REPORTS_SHOWN = 5;
