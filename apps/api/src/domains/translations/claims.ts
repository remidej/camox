import { and, eq, ne, sql } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import type { Draft } from "../drafts/scope";
import { translationClaims, translationRequests } from "./schema";

// Paths and record page values a translation job writes stay unique within the locale (ADR
// 0015). Jobs run concurrently, and each reads what's taken before it writes, so two jobs could
// pick the same value: each claims its value first, and the unique index lets only one win.

/** Where a value must be unique: a locale of a draft, among the values of one space. */
export type ClaimSpace = { draft: Draft; locale: string; space: string };

/**
 * The first of `candidate(1)`, `candidate(2)`, … that isn't `taken` and that `entityId` could
 * claim in the space, or already holds. The entity's claims on other values are released.
 */
export const claimUnique = Effect.fn("translations.claimUnique")(function* (
  db: Database,
  where: ClaimSpace,
  entityId: string,
  taken: ReadonlySet<string>,
  candidate: (n: number) => string,
) {
  const inSpace = and(
    eq(translationClaims.draftId, where.draft.id),
    eq(translationClaims.locale, where.locale),
    eq(translationClaims.space, where.space),
  );
  for (let n = 1; ; n++) {
    const value = candidate(n);
    if (taken.has(value)) continue;
    // A claim only holds while its job runs: once that job settled, what it wrote shows in
    // `taken`, and a value nobody shows any more is free again.
    yield* Effect.promise(() =>
      db
        .insert(translationClaims)
        .values({
          draftId: where.draft.id,
          locale: where.locale,
          space: where.space,
          value,
          entityId,
        })
        .onConflictDoUpdate({
          target: [
            translationClaims.draftId,
            translationClaims.locale,
            translationClaims.space,
            translationClaims.value,
          ],
          set: { entityId },
          setWhere: sql`not exists (select 1 from ${translationRequests}
            where ${translationRequests.draftId} = ${translationClaims.draftId}
              and ${translationRequests.locale} = ${translationClaims.locale}
              and ${translationRequests.entityId} = ${translationClaims.entityId})`,
        }),
    );
    const holder = yield* Effect.promise(() =>
      db
        .select({ entityId: translationClaims.entityId })
        .from(translationClaims)
        .where(and(inSpace, eq(translationClaims.value, value)))
        .get(),
    );
    if (holder?.entityId !== entityId) continue;
    yield* Effect.promise(() =>
      db
        .delete(translationClaims)
        .where(
          and(
            inSpace,
            eq(translationClaims.entityId, entityId),
            ne(translationClaims.value, value),
          ),
        ),
    );
    return value;
  }
});

/** Releases every claim of an entity in a locale of a draft, once the job deleted it there. */
export const releaseClaims = (db: Database, draft: Draft, locale: string, entityId: string) =>
  Effect.promise(() =>
    db
      .delete(translationClaims)
      .where(
        and(
          eq(translationClaims.draftId, draft.id),
          eq(translationClaims.locale, locale),
          eq(translationClaims.entityId, entityId),
        ),
      ),
  );
