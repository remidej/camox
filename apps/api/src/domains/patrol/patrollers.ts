import type { PatrollerDuty, PatrollerId, ReportVerb } from "@camox/api-contract/patrol";
import type { Effect } from "effect";

import type { Database } from "../../db";
import type { AiModel } from "../../lib/ai-model";
import type { Journal } from "../../lib/journal";
import type { Draft } from "../drafts/scope";
import type { GeneratedType } from "../generated-values/schema";
import type { Checked, CheckedSubject, RaisedFinding } from "./findings";
import { checkLinks, patrolLinks } from "./link-checker";
import {
  checkSpelling,
  pendingProofreading,
  proofreadLive,
  requestProofreading,
  settleProofreading,
} from "./proofreader";
import {
  noPendingWork,
  pendingGeneratedValues,
  pendingTranslations,
  type PendingWorkOf,
} from "./working";

// The patroller contract (ADR 0024). Patrollers share a contract, not a runtime: each runs
// however suits its work (today's run as AI jobs), and declares:
// - its identity: a stable id and its role name, here. The avatar is the studio's concern.
// - its duty, in drafts and on Live (ADR 0034): where it works as you go, checks at publish, or
//   is off. A patroller off on Live still works there for the catch-up draft (`dutyOnLive`).
// - its working state: the work pending in a scope, read from its own pending records, from
//   the moment it's requested until it settles.
// - its reports, written through `writeReport` when its work settles: only when it wrote
//   something or failed, never when it changed nothing.
// - its findings (ADR 0034): problems it found in content, raised and resolved through
//   `writeFindings` when a check settles. A patroller that checks drafts at publish declares its
//   `check`, which `checks.ts` runs once a draft is idle and when its review opens. One that
//   patrols Live declares its `patrol`, which `live-patrol.ts` runs every 6 hours.
// The registry is fixed: every project has every patroller, and no setting switches one off.

/** Where a patroller is on duty: in drafts, and on Live. */
export type Duty = { drafts: PatrollerDuty; live: PatrollerDuty };

/**
 * What a check of a draft found, and what it read: its open findings elsewhere stay. A check
 * that couldn't read everything it had to, such as when the model failed, isn't `complete`: the
 * draft's review requests it again. With `recheckInMs`, it needs checking again that soon to
 * settle, such as a link that failed once, and isn't up to date meanwhile.
 */
export type CheckResult = {
  found: RaisedFinding[];
  checked: Checked;
  complete?: boolean;
  recheckInMs?: number;
};

/** A patroller's check of a draft at publish. */
export type Checker = (
  db: Database,
  draft: Draft,
) => Effect.Effect<CheckResult, never, AiModel | Journal>;

/**
 * What a patrol of Live found, and what it read (everything, unless it says): Live's open findings
 * in what it read that it didn't find again are resolved.
 */
export type PatrolResult = { found: RaisedFinding[]; checked?: Checked };

/**
 * A patroller's patrol of a project's Live content (ADR 0034), every 6 hours. One with nothing to
 * read there this time patrols nothing (`null`): it doesn't count as a check.
 */
export type LivePatrol = (
  db: Database,
  projectId: number,
) => Effect.Effect<PatrolResult | null, never, AiModel | Journal>;

/**
 * What a check is requested for: the subjects a unit of work wrote in the draft, or `stale`, when
 * the draft's review opened on changes its last check didn't read.
 */
export type CheckRequest = readonly CheckedSubject[] | "stale";

/**
 * A patroller that checks only what changed since its last check keeps what to read next:
 * `request` records it before its check is scheduled, and `settle` ends what a check read once
 * it's done, even when it failed.
 */
export type CheckRequests = {
  request: (
    db: Database,
    draft: Draft,
    request: CheckRequest,
  ) => Effect.Effect<void, never, Journal>;
  settle: (db: Database, draft: Draft) => Effect.Effect<void, never, Journal>;
};

/**
 * A patroller's identity, its duty, how it tells what it's working on, its check of drafts, and
 * its patrol of Live.
 */
export type Patroller = {
  id: PatrollerId;
  role: string;
  duty: Duty;
  pending: PendingWorkOf;
  check?: Checker;
  patrol?: LivePatrol;
  requests?: CheckRequests;
};

/** Content only changes in drafts: patrollers that write it are off on Live. */
const WRITES_CONTENT: Duty = { drafts: "asYouGo", live: "off" };

/** Keeps every locale translated from the default locale: translations and catch-up drafts. */
export const translator: Patroller = {
  id: "translator",
  role: "Translator",
  duty: WRITES_CONTENT,
  pending: pendingTranslations,
};

/**
 * The generated values the SEO manager covers, what search engines read, and what it reports of
 * each.
 */
export const SEO_MANAGER_VERBS = {
  seo: "wroteSeo",
  fileMetadata: "describedFile",
} as const satisfies Partial<Record<GeneratedType, ReportVerb>>;

/** The generated values the SEO manager covers. */
export const SEO_MANAGER_TYPES = Object.keys(SEO_MANAGER_VERBS) as readonly GeneratedType[];

/** Writes what search engines read: pages' SEO, and files' alt text and filenames. */
export const seoManager: Patroller = {
  id: "seoManager",
  role: "SEO manager",
  duty: WRITES_CONTENT,
  pending: pendingGeneratedValues(SEO_MANAGER_TYPES),
};

/**
 * Finds links that don't work. In drafts it checks at publish; on Live it patrols (ADR 0034).
 * Fixing a link reports what it did.
 */
export const linkChecker: Patroller = {
  id: "linkChecker",
  role: "Link checker",
  duty: { drafts: "atPublish", live: "asYouGo" },
  pending: noPendingWork,
  check: checkLinks,
  patrol: patrolLinks,
};

/**
 * Finds spelling and clear grammar mistakes in text people wrote, each with its fix. In drafts it
 * checks at publish, reading what changed since its last check. It's off on Live, even while a
 * catch-up draft translates there, but for its one-off readings (ADR 0034): what a release no
 * draft published wrote, and all of Live when it first arrives in a project.
 */
export const proofreader: Patroller = {
  id: "proofreader",
  role: "Proofreader",
  duty: { drafts: "atPublish", live: "off" },
  pending: pendingProofreading,
  check: checkSpelling,
  patrol: proofreadLive,
  requests: { request: requestProofreading, settle: settleProofreading },
};

/** Every patroller, in the order the Patrol lists those that never worked. */
export const PATROLLERS: readonly Patroller[] = [translator, seoManager, linkChecker, proofreader];

/** The patroller of an id: the registry has every one. */
export const patrollerById = (id: PatrollerId): Patroller =>
  PATROLLERS.find((patroller) => patroller.id === id)!;

/**
 * A patroller's duty on Live. While a catch-up draft is open, its work is Live's (ADR 0017), so a
 * patroller writing content, off on Live, is on duty there as it is in drafts. One checking at
 * publish stays off: the catch-up draft holds the Translator's text, which it doesn't read.
 */
export const dutyOnLive = (patroller: Patroller, catchingUp: boolean): PatrollerDuty =>
  catchingUp && patroller.duty.live === "off" && patroller.duty.drafts === "asYouGo"
    ? patroller.duty.drafts
    : patroller.duty.live;
