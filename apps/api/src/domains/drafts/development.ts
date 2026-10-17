import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { record } from "../../lib/journal";
import { drafts } from "./schema";

// Each member has one development draft per project, holding the definitions synced from their
// local code (ADR 0006). Dev mode's first sync after login creates it; nothing else does.

/** A member's development draft in a project, if dev mode created it. */
export const findDevelopmentDraft = Effect.fn("findDevelopmentDraft")(function* (
  db: Database,
  projectId: number,
  userId: string,
) {
  return yield* Effect.promise(() =>
    db
      .select()
      .from(drafts)
      .where(
        and(
          eq(drafts.projectId, projectId),
          eq(drafts.kind, "development"),
          eq(drafts.createdBy, userId),
        ),
      )
      .get(),
  );
});

/**
 * A member's development draft in a project, created by the first dev-mode sync after login
 * (`created`). Several checkouts syncing at once share it (ADR 0006).
 */
export const ensureDevelopmentDraft = Effect.fn("ensureDevelopmentDraft")(function* (
  db: Database,
  projectId: number,
  userId: string,
) {
  // The unique index on (project, creator) for development drafts keeps one when syncs race.
  const inserted = yield* Effect.promise(() =>
    db
      .insert(drafts)
      .values({ projectId, kind: "development", createdBy: userId, createdAt: Date.now() })
      .onConflictDoNothing()
      .returning()
      .get(),
  );
  if (inserted) {
    yield* record(db, { kind: "drafts", projectId });
    return { draft: inserted, created: true };
  }
  const existing = yield* findDevelopmentDraft(db, projectId, userId);
  return { draft: existing!, created: false };
});
