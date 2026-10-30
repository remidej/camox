import type { PatrollerDuty, PatrollerId, ReportVerb } from "@camox/api-contract/patrol";
import type { Effect } from "effect";

import type { Database } from "../../db";
import type { AiModel } from "../../lib/ai-model";
import type { Journal } from "../../lib/journal";
import type { Draft } from "../drafts/scope";
import type { GeneratedType } from "../generated-values/schema";
import type { Checked, CheckedSubject, RaisedFinding } from "./findings";
import { checkLinks } from "./link-checker";
import {
  checkSpelling,
  pendingProofreading,
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
//   `check`, which `checks.ts` runs once a draft is idle and when its review opens.
// The registry is fixed: every project has every patroller, and no setting switches one off.

/** Where a patroller is on duty: in drafts, and on Live. */
export type Duty = { drafts: PatrollerDuty; live: PatrollerDuty };

/**
 * What a check of a draft found, and what it read: its open findings elsewhere stay. A check
 * that couldn't read everything it had to, such as when the model failed, isn't `complete`: the
 * draft's review requests it again.
 */
export type CheckResult = { found: RaisedFinding[]; checked: Checked; complete?: boolean };

/** A patroller's check of a draft at publish. */
export type Checker = (
  db: Database,
  draft: Draft,
) => Effect.Effect<CheckResult, never, AiModel | Journal>;

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

/** A patroller's identity, its duty, how it tells what it's working on, and its check. */
export type Patroller = {
  id: PatrollerId;
  role: string;
  duty: Duty;
  pending: PendingWorkOf;
  check?: Checker;
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
};

/**
 * Finds spelling and clear grammar mistakes in text people wrote, each with its fix. In drafts it
 * checks at publish, reading what changed since its last check; it's off on Live (ADR 0034).
 */
export const proofreader: Patroller = {
  id: "proofreader",
  role: "Proofreader",
  duty: { drafts: "atPublish", live: "off" },
  pending: pendingProofreading,
  check: checkSpelling,
  requests: { request: requestProofreading, settle: settleProofreading },
};

/** Every patroller, in the order the Patrol lists those that never worked. */
export const PATROLLERS: readonly Patroller[] = [translator, seoManager, linkChecker, proofreader];

/**
 * A patroller's duty on Live. While a catch-up draft is open, its work is Live's (ADR 0017), so a
 * patroller off on Live is on duty there as it is in drafts.
 */
export const dutyOnLive = (patroller: Patroller, catchingUp: boolean): PatrollerDuty =>
  catchingUp && patroller.duty.live === "off" ? patroller.duty.drafts : patroller.duty.live;
