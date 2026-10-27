import type { ReportOutcome, ReportVerb } from "@camox/api-contract/patrol";
import { Effect } from "effect";

import type { Database } from "../../db";
import type { GenerationJob } from "../../lib/ai-job-queue";
import type { GeneratedType } from "../generated-values/schema";
import { storedValue, type ValueKey } from "../generated-values/service";
import { SEO_MANAGER_VERBS, seoManager } from "./patrollers";
import { subjectKey, writeReport } from "./reports";

// The SEO manager (ADR 0024) runs as generation jobs (ADR 0012): it covers the generated values
// search engines read, pages' SEO and files' alt text and filenames. Summaries aren't its own.

/** What the SEO manager reports of each type of value, none for those it doesn't cover. */
const VERBS: Partial<Record<GeneratedType, ReportVerb>> = SEO_MANAGER_VERBS;

/**
 * Reports a generation job that settled, about its subject in its locale: done when it wrote the
 * value since it started, failed when it failed. A job that wrote nothing, as one whose group is
 * manual, or whose value isn't the SEO manager's, leaves no report.
 */
export const reportGeneration = Effect.fn("seoManager.reportGeneration")(function* (
  db: Database,
  job: GenerationJob,
  key: ValueKey,
  outcome: ReportOutcome,
  startedAt: number,
) {
  const verb = VERBS[key.type];
  if (verb === undefined) return;
  const stored = yield* storedValue(db, job.draftId, job.locale, key);
  if (stored === undefined) return;
  if (outcome === "done" && (stored.generatedAt ?? 0) < startedAt) return;
  yield* writeReport(db, seoManager, {
    projectId: stored.projectId,
    draftId: job.draftId,
    key: subjectKey(key.entity, key.entityId, stored.locale),
    summary: {
      kind: "structured",
      verb,
      subject: { entity: key.entity, id: key.entityId },
      locale: stored.locale,
    },
    outcome,
  });
});
