import { eq } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { catchUpDraftOf, isCatchUpDraft } from "../drafts/catch-up";
import { drafts } from "../drafts/schema";

// Which scope a patroller's work shows in, in the Patrol (ADR 0024). Work in a draft is the
// draft's, except the catch-up draft's, which is Live's: that draft exists only to bring Live's
// translations up to date (ADR 0017). This is the one place that knows it.

/** The Patrol scope of work done in a draft: Live (null) for the catch-up draft, else its own. */
export const patrolScopeOf = (draft: { id: string; createdBy: string }) =>
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

/** A draft's row as the Patrol tells its scope, or undefined once the draft ended. */
export const patrolDraftRow = (db: Database, draftId: string) =>
  Effect.tryPromise(() =>
    db
      .select({ id: drafts.id, createdBy: drafts.createdBy })
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
      const row = yield* patrolDraftRow(db, draftId).pipe(Effect.orElseSucceed(() => undefined));
      const live = row === undefined || patrolScopeOf(row) === null;
      known.set(draftId, live);
      return live;
    });
}

/** Whether work in a draft counts as Live's in the Patrol. */
export type CountsAsLive = ReturnType<typeof countsAsLiveIn>;
