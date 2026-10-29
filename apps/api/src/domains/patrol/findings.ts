import type { FindingAbout, FindingFix, ReportEntity } from "@camox/api-contract/patrol";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { Effect } from "effect";

import type { Database } from "../../db";
import { record } from "../../lib/journal";
import type * as overlay from "../drafts/overlay";
import type { Patroller } from "./patrollers";
import { subjectKey, writeInScope } from "./reports";
import { findingDismissals, findings } from "./schema";

// The one write of findings (ADR 0034), beside reports': every patroller raises and resolves its
// findings through `writeFindings` when a check settles, and dismissals go through `dismiss`.
// Dismissals are the project's: no finding of a dismissed identity is raised, in any scope.

/** A finding as a check raises it, in the content of one subject, locale and field. */
export type RaisedFinding = {
  entity: ReportEntity;
  id: string;
  /** The tag of the locale the content is in. */
  locale: string;
  field: string;
  /**
   * What a dismissal names, as its patroller tells findings apart: a link checker's is the URL,
   * project-wide.
   */
  identity: string;
  about: FindingAbout;
  fix: FindingFix | null;
};

/** A scope findings are in: a draft, or Live (`draftId` null). */
export type FindingScope = { projectId: number; draftId: string | null };

/** One subject in one locale a check read. */
export type CheckedSubject = { entity: ReportEntity; id: string; locale: string };

/**
 * What a check read: everything its patroller checks in the scope, or only some subjects. Its
 * open findings elsewhere stay as they are.
 */
export type Checked = "everything" | readonly CheckedSubject[];

export type FindingRow = typeof findings.$inferSelect;

/** A finding's key in its scope: its subject, field and identity. */
const keyOf = (finding: RaisedFinding) =>
  `${subjectKey(finding.entity, finding.id, finding.locale)}:${finding.field}:${finding.identity}`;

const inScope = ({ projectId, draftId }: FindingScope) =>
  and(
    eq(findings.projectId, projectId),
    draftId === null ? isNull(findings.draftId) : eq(findings.draftId, draftId),
  );

/** The identities of a patroller's findings the project dismissed. */
export const dismissedIdentities = Effect.fn("patrol.dismissedIdentities")(function* (
  db: Database,
  projectId: number,
  patroller: Patroller,
) {
  const rows = yield* Effect.promise(() =>
    db
      .select({ identity: findingDismissals.identity })
      .from(findingDismissals)
      .where(
        and(
          eq(findingDismissals.projectId, projectId),
          eq(findingDismissals.patroller, patroller.id),
        ),
      ),
  );
  return new Set(rows.map((row) => row.identity));
});

// D1 binds at most 100 parameters per statement.
const CHUNK = 90;

/**
 * Settles a patroller's check in a scope: raises what it `found`, except dismissed identities,
 * keeping when a finding still open was first raised, and resolves its open findings in what it
 * `checked` that it no longer found. Refreshes the Patrol of the scope. A draft that ended
 * meanwhile holds none.
 */
export const writeFindings = Effect.fn("patrol.writeFindings")(function* (
  db: Database,
  patroller: Patroller,
  scope: FindingScope,
  found: readonly RaisedFinding[],
  checked: Checked = "everything",
) {
  const dismissed = yield* dismissedIdentities(db, scope.projectId, patroller);
  const raised = new Map(
    found
      .filter((finding) => !dismissed.has(finding.identity))
      .map((finding) => [keyOf(finding), finding]),
  );
  const covers = (row: Pick<FindingRow, "entity" | "entityId" | "locale">) =>
    checked === "everything" ||
    checked.some(
      (subject) =>
        subject.entity === row.entity &&
        subject.id === row.entityId &&
        subject.locale === row.locale,
    );
  const raisedAt = Date.now();

  yield* writeInScope(
    db,
    scope,
    async () => {
      const open = await db
        .select({
          rowId: findings.rowId,
          key: findings.key,
          entity: findings.entity,
          entityId: findings.entityId,
          locale: findings.locale,
        })
        .from(findings)
        .where(and(inScope(scope), eq(findings.patroller, patroller.id)));
      const resolved = open.filter((row) => covers(row) && !raised.has(row.key));
      const statements: BatchItem<"sqlite">[] = [];
      for (let start = 0; start < resolved.length; start += CHUNK) {
        const rowIds = resolved.slice(start, start + CHUNK).map((row) => row.rowId);
        statements.push(db.delete(findings).where(inArray(findings.rowId, rowIds)));
      }
      for (const [key, finding] of raised) {
        const { entity, id, locale, field, identity, about, fix } = finding;
        statements.push(
          db
            .insert(findings)
            .values({
              ...scope,
              patroller: patroller.id,
              key,
              entity,
              entityId: id,
              locale,
              field,
              identity,
              about,
              fix,
              raisedAt,
            })
            .onConflictDoUpdate({
              ...(scope.draftId === null
                ? {
                    target: [findings.projectId, findings.patroller, findings.key],
                    targetWhere: sql`${findings.draftId} is null`,
                  }
                : {
                    target: [findings.draftId, findings.patroller, findings.key],
                    targetWhere: sql`${findings.draftId} is not null`,
                  }),
              set: { about, fix },
            }),
        );
      }
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
    },
    "findings",
  );
});

/** Resolves one open finding, as a fix applied to it does. */
export const resolveFinding = Effect.fn("patrol.resolveFinding")(function* (
  db: Database,
  finding: FindingRow,
) {
  yield* writeInScope(
    db,
    finding,
    () => db.delete(findings).where(eq(findings.rowId, finding.rowId)),
    "findings",
  );
});

/**
 * Dismisses a finding's identity for the project, as `by`: every open finding of it, in every
 * scope, is resolved at once, and none is raised again, even once the draft it was in ended.
 */
export const dismiss = Effect.fn("patrol.dismiss")(function* (
  db: Database,
  finding: FindingRow,
  by: string,
) {
  const { projectId, patroller, identity, about } = finding;
  yield* Effect.promise(() =>
    db.batch([
      db
        .insert(findingDismissals)
        .values({ projectId, patroller, identity, about, dismissedBy: by, dismissedAt: Date.now() })
        .onConflictDoNothing(),
      db
        .delete(findings)
        .where(
          and(
            eq(findings.projectId, projectId),
            eq(findings.patroller, patroller),
            eq(findings.identity, identity),
          ),
        ),
    ]),
  );
  // Dismissals show in every scope's Patrol: Live's refresh reaches every draft's.
  yield* record(db, { kind: "findings", projectId, draftId: null });
});

/** Publishing or deleting a draft ends its findings. Dismissals made in it stay. */
export function endStatements(db: Database, draftId: string): overlay.BatchItem[] {
  return [db.delete(findings).where(eq(findings.draftId, draftId))];
}
