import type { ReportOutcome } from "@camox/api-contract/patrol";
import { eq, sql } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { record } from "../../lib/journal";
import type * as overlay from "../drafts/overlay";
import type { Patroller } from "./patrollers";
import { patrolChecks, reports, type StoredSummary } from "./schema";
import { patrolDraftRow, patrolScopeOf } from "./scopes";

// The one write of reports (ADR 0024): every patroller reports through it when its work settles.
// Beside it, the one write of when a patroller last checked a scope (ADR 0034).

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
 * Writes a patroller's record in a scope with `write`, and refreshes the Patrol of its scope: as
 * a report, unless it's findings. A draft that ended meanwhile has nowhere to hold it: nothing is
 * written. The catch-up draft's work is Live's in the Patrol, so it refreshes Live's.
 */
export const writeInScope = Effect.fn("patrol.writeInScope")(function* (
  db: Database,
  { projectId, draftId }: { projectId: number; draftId: string | null },
  write: () => Promise<unknown>,
  kind: "report" | "findings" = "report",
) {
  const draftOf = () =>
    draftId === null ? Effect.succeed(null) : Effect.orDie(patrolDraftRow(db, draftId));
  const draft = yield* draftOf();
  if (draft === undefined) return;
  const written = yield* Effect.tryPromise(write).pipe(
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
    kind,
    projectId,
    draftId: draft === null ? null : patrolScopeOf(draft),
  });
});

/**
 * Writes a patroller's report, or updates the one of the same key with a new time, and refreshes
 * the Patrol of its scope.
 */
export const writeReport = Effect.fn("patrol.writeReport")(function* (
  db: Database,
  patroller: Patroller,
  report: Report,
) {
  const { projectId, draftId, key, summary, outcome } = report;
  const at = Date.now();
  yield* writeInScope(db, report, () =>
    db
      .insert(reports)
      .values({ projectId, draftId, patroller: patroller.id, key, summary, outcome, at })
      .onConflictDoUpdate({ ...conflictTarget(draftId), set: { summary, outcome, at } }),
  );
});

/**
 * Keeps the time a patroller finished a check in a scope, a draft or Live (`draftId` null),
 * whether it found anything or not, and refreshes the Patrol of its scope.
 */
export const writeCheck = Effect.fn("patrol.writeCheck")(function* (
  db: Database,
  patroller: Patroller,
  scope: { projectId: number; draftId: string | null },
  /** The fingerprint of the draft's changes the check read, if it read them. */
  fingerprint: string | null = null,
) {
  const { projectId, draftId } = scope;
  const checkedAt = Date.now();
  yield* writeInScope(db, scope, () =>
    db
      .insert(patrolChecks)
      .values({ projectId, draftId, patroller: patroller.id, checkedAt, fingerprint })
      .onConflictDoUpdate(
        draftId === null
          ? {
              target: [patrolChecks.projectId, patrolChecks.patroller],
              targetWhere: sql`${patrolChecks.draftId} is null`,
              set: { checkedAt, fingerprint },
            }
          : {
              target: [patrolChecks.draftId, patrolChecks.patroller],
              targetWhere: sql`${patrolChecks.draftId} is not null`,
              set: { checkedAt, fingerprint },
            },
      ),
  );
});

/** Publishing or deleting a draft ends its reports and its checks. */
export function endStatements(db: Database, draftId: string): overlay.BatchItem[] {
  return [
    db.delete(reports).where(eq(reports.draftId, draftId)),
    db.delete(patrolChecks).where(eq(patrolChecks.draftId, draftId)),
  ];
}
