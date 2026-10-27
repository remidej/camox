import type { ReportOutcome } from "@camox/api-contract/patrol";
import { eq, sql } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { record } from "../../lib/journal";
import type * as overlay from "../drafts/overlay";
import type { Patroller } from "./patrollers";
import { reports, type StoredSummary } from "./schema";
import { patrolDraftRow, patrolScopeOf } from "./scopes";

// The one write of reports (ADR 0024): every patroller reports through it when its work settles.

/** A report, as its patroller writes it, in a draft or on Live (`draftId` null). */
export type Report = {
  projectId: number;
  draftId: string | null;
  /** What the work was on: its subject and locale, or a run. Redoing it updates the report. */
  key: string;
  summary: StoredSummary;
  outcome: ReportOutcome;
};

/** The key of a report about one subject in one locale. */
export const subjectKey = (entity: string, id: string, locale: string) =>
  `${entity}:${id}:${locale}`;

const conflictTarget = (draftId: string | null) =>
  draftId === null
    ? {
        target: [reports.projectId, reports.patroller, reports.key],
        targetWhere: sql`${reports.draftId} is null`,
      }
    : {
        target: [reports.draftId, reports.patroller, reports.key],
        targetWhere: sql`${reports.draftId} is not null`,
      };

/**
 * Writes a patroller's report, or updates the one of the same key with a new time, and refreshes
 * the Patrol of its scope. A draft that ended meanwhile has nowhere to hold it: nothing is
 * written. The catch-up draft's reports are Live's in the Patrol, so they refresh Live's.
 */
export const writeReport = Effect.fn("patrol.writeReport")(function* (
  db: Database,
  patroller: Patroller,
  report: Report,
) {
  const { projectId, draftId, key, summary, outcome } = report;
  const draftOf = () =>
    draftId === null ? Effect.succeed(null) : Effect.orDie(patrolDraftRow(db, draftId));
  const draft = yield* draftOf();
  if (draft === undefined) return;
  const at = Date.now();
  const written = yield* Effect.tryPromise(() =>
    db
      .insert(reports)
      .values({ projectId, draftId, patroller: patroller.id, key, summary, outcome, at })
      .onConflictDoUpdate({
        ...conflictTarget(draftId),
        set: { summary, outcome, at, attention: "none" },
      }),
  ).pipe(
    Effect.as(true),
    // Only a draft that ended since it was read fails the write; anything else fails it for good.
    Effect.catch((error) =>
      Effect.flatMap(draftOf(), (still) =>
        still === undefined ? Effect.succeed(false) : Effect.die(error),
      ),
    ),
  );
  if (!written) return;
  yield* record(db, {
    kind: "report",
    projectId,
    draftId: draft === null ? null : patrolScopeOf(draft),
  });
});

/** Publishing or deleting a draft ends its reports. */
export function endStatements(db: Database, draftId: string): overlay.BatchItem[] {
  return [db.delete(reports).where(eq(reports.draftId, draftId))];
}
