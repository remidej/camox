import type { PatrollerId } from "@camox/api-contract/patrol";

import type { GeneratedType } from "../generated-values/schema";
import { pendingGeneratedValues, pendingTranslations, type PendingWorkOf } from "./working";

// The patroller contract (ADR 0024). Patrollers share a contract, not a runtime: each runs
// however suits its work (today's run as AI jobs), and declares:
// - its identity: a stable id and its role name, here. The avatar is the studio's concern.
// - its working state: the work pending in a scope, read from its own pending records, from
//   the moment it's requested until it settles.
// - its reports, written through `writeReport` when its work settles: only when it wrote
//   something or failed, never when it changed nothing.
// The registry is fixed: every project has every patroller, and no setting switches one off.

/** A patroller's identity, and how it tells what it's working on. */
export type Patroller = { id: PatrollerId; role: string; pending: PendingWorkOf };

/** Keeps every locale translated from the default locale: translations and catch-up drafts. */
export const translator: Patroller = {
  id: "translator",
  role: "Translator",
  pending: pendingTranslations,
};

/** The generated values the SEO manager covers: what search engines read. */
export const SEO_MANAGER_TYPES: readonly GeneratedType[] = ["seo", "fileMetadata"];

/** Writes what search engines read: pages' SEO, and files' alt text and filenames. */
export const seoManager: Patroller = {
  id: "seoManager",
  role: "SEO manager",
  pending: pendingGeneratedValues(SEO_MANAGER_TYPES),
};

/** Every patroller, in the order the Patrol lists those that never worked. */
export const PATROLLERS: readonly Patroller[] = [translator, seoManager];
