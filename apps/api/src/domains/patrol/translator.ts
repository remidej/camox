import type { ReportOutcome } from "@camox/api-contract/patrol";
import { Effect } from "effect";

import type { Database } from "../../db";
import type { TranslationJob } from "../../lib/ai-job-queue";
import type { Draft } from "../drafts/scope";
import { translator } from "./patrollers";
import { subjectKey, writeReport } from "./reports";

// The Translator (ADR 0024) runs as translation jobs (ADR 0015), whatever they translate from:
// the default locale, code-owned defaults, or Live's localization to merge with (ADR 0016). They
// only ever run in a draft; the catch-up draft's count as Live's (ADR 0017).

/**
 * Reports a translation job that settled in its draft, about its subject in its locale: done
 * when it wrote the localization, failed when it failed. Redoing it, from any source, updates the
 * same report. A merge with Live's localization reads as a translation.
 */
export const reportTranslation = Effect.fn("translator.reportTranslation")(function* (
  db: Database,
  draft: Draft,
  job: TranslationJob,
  outcome: ReportOutcome,
) {
  yield* writeReport(db, translator, {
    projectId: draft.projectId,
    draftId: draft.id,
    key: subjectKey(job.entity, job.entityId, job.locale),
    summary: {
      kind: "structured",
      verb: job.source === "live" ? "mergedWithLive" : "translated",
      subject: { entity: job.entity, id: job.entityId },
      locale: job.locale,
    },
    outcome,
  });
});

/**
 * Reports on Live that Camox published a catch-up draft: Live's translations caught up. Keyed by
 * the draft, its run: each catch-up draft published has its own report, about no subject.
 */
export const reportCatchUpPublished = Effect.fn("translator.reportCatchUpPublished")(function* (
  db: Database,
  catchUp: Draft,
) {
  yield* writeReport(db, translator, {
    projectId: catchUp.projectId,
    draftId: null,
    key: `catchUp:${catchUp.id}`,
    summary: { kind: "structured", verb: "publishedCatchUp", subject: null, locale: null },
    outcome: "done",
  });
});
