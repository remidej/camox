/**
 * The Patrol (ADR 0024): every patroller of a project, the work each did as reports, as the
 * studio shows it at the top of the Agent Sidebar. The API reads it for one scope, a draft or
 * Live, and names each report's subject, so the studio needs no entity loaded to show it.
 */

/** Every patroller's stable id. The registry in the API lists them all. */
export const PATROLLER_IDS = ["translator", "seoManager", "linkChecker"] as const;

/** A patroller's stable id. */
export type PatrollerId = (typeof PATROLLER_IDS)[number];

/**
 * What a structured report says was done. Each has a failed form, by the report's outcome. A
 * merge with Live's localization reads as a translation.
 */
export type ReportVerb =
  | "translated"
  | "mergedWithLive"
  | "wroteSeo"
  | "describedFile"
  | "publishedCatchUp"
  | "removedLink";

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

/**
 * Where a patroller is on duty, in drafts or on Live: it works as you go, checks when you
 * publish, or is off there (ADR 0034).
 */
export type PatrollerDuty = "asYouGo" | "atPublish" | "off";

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

/**
 * What a finding is about (ADR 0034), by its kind:
 * - `missingPage`: a link to a page that doesn't exist, the page's name as it was last known.
 * - `brokenLink`: an external link that failed, and how.
 * - `misspelling`, `grammar`: the flagged text, in the sentence it's in.
 * A link's `url` is as content stores it: a page link's is `camox:page:<id>`, and `text` is what
 * the link reads.
 */
export type FindingAbout =
  | { kind: "missingPage"; url: string; text: string; page: string | null }
  | { kind: "brokenLink"; url: string; text: string; failure: LinkFailure }
  | { kind: "misspelling" | "grammar"; text: string; sentence: string };

/** How a link failed: an HTTP error status, no connection (DNS included), or no answer in time. */
export type LinkFailure =
  | { kind: "status"; status: number }
  | { kind: "unreachable" }
  | { kind: "timeout" };

export type FindingKind = FindingAbout["kind"];

/** The fix a finding suggests, which applying makes: removing the link, keeping its text. */
export type FindingFix = { kind: "removeLink" };

/** A finding, open, in the scope viewed. */
export type FindingView = {
  /** What applying or dismissing it names. */
  id: number;
  about: FindingAbout;
  /** The fix it suggests, if any. */
  fix: FindingFix | null;
  /** The content it's in, named in its locale. */
  subject: ReportSubject;
  /** The locale of the content it's in, by its tag. */
  locale: string;
  /** The content field it's in, by name. */
  field: string;
  /** When it was first raised, in milliseconds since the epoch. */
  raisedAt: number;
  /** Whether it's Live's. Live's are fixed in the Patrol Draft. */
  live: boolean;
  /** Where its content shows, as for reports. */
  place: ReportPlace | null;
};

/** A member's dismissal of what a finding was about: no finding like it is raised again. */
export type DismissalView = {
  id: number;
  about: FindingAbout;
  by: { id: string; name: string };
  /** When it was dismissed, in milliseconds since the epoch. */
  at: number;
};

/** What applying a finding's fix did: applied it, or found its content changed and rechecked. */
export type ApplyResult = { applied: boolean };

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
  /** Its duty in the scope viewed. Off there, it still has its reports. */
  duty: PatrollerDuty;
  /** Null when it isn't working in the scope. */
  working: PatrollerWorking | null;
  /**
   * When it last finished a check in the scope, whether it found anything or not, or null when it
   * never checked there.
   */
  lastCheckedAt: number | null;
  /**
   * Its latest activity in the scope: its last check, its newest report or when its pending work
   * started, whichever is later. Null when it never worked there.
   */
  lastActivityAt: number | null;
  /** Its newest reports, newest first. */
  reports: ReportView[];
  /** How many more reports it has than `reports` shows, per locale, the most first. */
  more: { locale: string | null; count: number }[];
  /** Its open findings in the scope viewed, the oldest first. Their count is the row's badge. */
  findings: FindingView[];
  /** The project's dismissals of its findings, the newest first. */
  dismissals: DismissalView[];
};

/** Every patroller of the registry, the latest activity first; never-worked ones last. */
export type PatrolView = { patrollers: PatrollerView[] };

/** How many reports the Patrol shows of each patroller; the rest are counted. */
export const REPORTS_SHOWN = 5;
