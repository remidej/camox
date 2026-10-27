import type { PatrollerId } from "@camox/api-contract/patrol";

// The patroller contract (ADR 0024). Patrollers share a contract, not a runtime: each runs
// however suits its work (today's run as AI jobs), and declares:
// - its identity: a stable id and its role name, here. The avatar is the studio's concern.
// - its reports, written through `writeReport` when its work settles: only when it wrote
//   something or failed, never when it changed nothing.
// The registry is fixed: every project has every patroller, and no setting switches one off.

/** A patroller's identity. */
export type Patroller = { id: PatrollerId; role: string };

/** Keeps every locale translated from the default locale: translations and catch-up drafts. */
export const translator: Patroller = { id: "translator", role: "Translator" };

/** Writes what search engines read: pages' SEO, and files' alt text and filenames. */
export const seoManager: Patroller = { id: "seoManager", role: "SEO manager" };

/** Every patroller, in the order the Patrol lists those that never worked. */
export const PATROLLERS: readonly Patroller[] = [translator, seoManager];
