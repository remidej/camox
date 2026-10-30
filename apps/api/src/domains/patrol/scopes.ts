import { and, eq, isNull, sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { Effect } from "effect";

import type { Database } from "../../db";
import { catchUpDraftOf, isCatchUpDraft } from "../drafts/catch-up";
import { type CamoxDraftPurpose, drafts } from "../drafts/schema";

// Which scope a patroller's work shows in, in the Patrol (ADR 0024). Work in a draft is the
// draft's, except the catch-up draft's, which is Live's: that draft exists only to bring Live's
// translations up to date (ADR 0017). This is the one place that knows it.

/** A scope a patroller works in: a draft, or Live (`draftId` null). */
export type WorkScope = { projectId: number; draftId: string | null };

/** A table of patrollers' records, each in a scope. */
type ScopedTable = { projectId: AnySQLiteColumn; draftId: AnySQLiteColumn };

/** A table's rows in a scope. */
export const inWorkScope = (table: ScopedTable, { projectId, draftId }: WorkScope) =>
  and(
    eq(table.projectId, projectId),
    draftId === null ? isNull(table.draftId) : eq(table.draftId, draftId),
  );

/**
 * What a row keyed by `key` in a scope conflicts on: Live's rows are unique per project, a
 * draft's per draft, each by its own partial index.
 */
export const conflictInScope = (
  table: ScopedTable,
  draftId: string | null,
  key: AnySQLiteColumn[],
) =>
  draftId === null
    ? { target: [table.projectId, ...key], targetWhere: sql`${table.draftId} is null` }
    : { target: [table.draftId, ...key], targetWhere: sql`${table.draftId} is not null` };

/** The Patrol scope of work done in a draft: Live (null) for the catch-up draft, else its own. */
export const patrolScopeOf = (draft: { id: string; purpose: CamoxDraftPurpose | null }) =>
  isCatchUpDraft(draft) ? null : draft.id;

/**
 * The scopes whose work shows as Live's: Live's own and, while one is open, the catch-up
 * draft's, with its row.
 */
export const liveWorkScopes = Effect.fn("patrol.liveWorkScopes")(function* (
  db: Database,
  projectId: number,
) {
  const catchUp = yield* catchUpDraftOf(db, projectId);
  return { catchUp, scopes: [null, ...(catchUp ? [catchUp.id] : [])] as (string | null)[] };
});

/**
 * The project's open Patrol Draft's row, if any: the draft Camox opened to fix Live's findings
 * (`patrol-draft.ts`), whose agent works on them.
 */
export const patrolDraftOf = (db: Database, projectId: number) =>
  Effect.promise(() =>
    db
      .select()
      .from(drafts)
      .where(and(eq(drafts.projectId, projectId), eq(drafts.purpose, "patrol")))
      .get(),
  );

/** A draft's purpose, by which the Patrol tells its scope, or undefined once the draft ended. */
export const draftPurposeOf = (db: Database, draftId: string) =>
  Effect.tryPromise(() =>
    db
      .select({ id: drafts.id, purpose: drafts.purpose })
      .from(drafts)
      .where(eq(drafts.id, draftId))
      .get(),
  );

/**
 * Tells whether work in a draft counts as Live's, asking the database once per draft. A draft
 * that ended since, as a catch-up draft just published or deleted, may have been the catch-up
 * draft: its work counts as Live's too, so that Live's Patrol refreshes.
 */
export function countsAsLiveIn(db: Database) {
  const known = new Map<string, boolean>();
  return (draftId: string) =>
    Effect.gen(function* () {
      const cached = known.get(draftId);
      if (cached !== undefined) return cached;
      const row = yield* draftPurposeOf(db, draftId).pipe(Effect.orElseSucceed(() => undefined));
      const live = row === undefined || patrolScopeOf(row) === null;
      known.set(draftId, live);
      return live;
    });
}

/** Whether work in a draft counts as Live's in the Patrol. */
export type CountsAsLive = ReturnType<typeof countsAsLiveIn>;
