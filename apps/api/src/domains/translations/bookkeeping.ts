import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { TRANSLATED_ENTITIES, type TranslatedEntity } from "../../lib/ai-job-queue";
import * as overlay from "../drafts/overlay";
import type { Draft, DraftInLocale } from "../drafts/scope";
import { translationBookkeeping } from "./schema";

// A localization's bookkeeping: what it was last translated from, and what Camox wrote from
// that. It sits beside content like generated values (ADR 0012): a draft reads its own over
// Live's, writing it never touches content, and publishing copies the draft's to Live.

/** A localization's columns, with its content and settings, as bookkeeping holds them. */
export type Values = Record<string, unknown>;

export type Bookkeeping = { source: Values; output: Values };

/** A localization's bookkeeping as a draft in its locale reads it: the draft's own, or Live's. */
export const readBookkeeping = Effect.fn("translation.readBookkeeping")(function* (
  db: Database,
  target: DraftInLocale,
  entity: TranslatedEntity,
  entityId: string,
) {
  const row = yield* Effect.promise(() =>
    db
      .select({ source: translationBookkeeping.source, output: translationBookkeeping.output })
      .from(translationBookkeeping)
      .where(
        and(
          eq(translationBookkeeping.entity, entity),
          eq(translationBookkeeping.entityId, entityId),
          eq(translationBookkeeping.locale, target.locale),
          or(eq(translationBookkeeping.draftId, target.id), isNull(translationBookkeeping.draftId)),
        ),
      )
      // The draft's own first: nulls sort first ascending, last descending.
      .orderBy(desc(translationBookkeeping.draftId))
      .get(),
  );
  return row;
});

/** Ids per query, under D1's limit of bound parameters. */
const IDS_PER_READ = 90;

/** The bookkeeping of several localizations of one kind, by id, as `readBookkeeping` reads each. */
export const readBookkeepings = Effect.fn("translation.readBookkeepings")(function* (
  db: Database,
  target: DraftInLocale,
  entity: TranslatedEntity,
  entityIds: readonly string[],
) {
  const found = new Map<string, Bookkeeping>();
  for (let start = 0; start < entityIds.length; start += IDS_PER_READ) {
    const rows = yield* Effect.promise(() =>
      db
        .select({
          entityId: translationBookkeeping.entityId,
          draftId: translationBookkeeping.draftId,
          source: translationBookkeeping.source,
          output: translationBookkeeping.output,
        })
        .from(translationBookkeeping)
        .where(
          and(
            eq(translationBookkeeping.entity, entity),
            inArray(translationBookkeeping.entityId, entityIds.slice(start, start + IDS_PER_READ)),
            eq(translationBookkeeping.locale, target.locale),
            or(
              eq(translationBookkeeping.draftId, target.id),
              isNull(translationBookkeeping.draftId),
            ),
          ),
        ),
    );
    // The draft's own over Live's.
    for (const { entityId, draftId, source, output } of rows) {
      if (draftId !== null || !found.has(entityId)) found.set(entityId, { source, output });
    }
  }
  return found;
});

/** Stores a localization's bookkeeping in its draft. */
export const writeBookkeeping = Effect.fn("translation.writeBookkeeping")(function* (
  db: Database,
  target: DraftInLocale,
  entity: TranslatedEntity,
  entityId: string,
  bookkeeping: Bookkeeping,
) {
  yield* Effect.promise(() =>
    db
      .insert(translationBookkeeping)
      .values({
        projectId: target.projectId,
        draftId: target.id,
        entity,
        entityId,
        locale: target.locale,
        ...bookkeeping,
      })
      .onConflictDoUpdate({
        target: [
          translationBookkeeping.draftId,
          translationBookkeeping.entity,
          translationBookkeeping.entityId,
          translationBookkeeping.locale,
        ],
        targetWhere: sql`${translationBookkeeping.draftId} is not null`,
        set: { source: bookkeeping.source, output: bookkeeping.output },
      }),
  );
});

/**
 * Run once Live holds what the publish leaves: copies the draft's bookkeeping over Live's, then
 * drops Live's bookkeeping of localizations Live doesn't hold. The draft's own is deleted with
 * its pending translations (`endStatements`).
 */
export function publishStatements(scope: Draft): overlay.BatchItem[] {
  const entities = new Set<string>(TRANSLATED_ENTITIES);
  const heldByLive = sql.join(
    overlay
      .liveKeys()
      .filter(({ entity }) => entities.has(entity))
      .map(
        ({ entity, keys }) =>
          sql`("b"."entity" = ${entity} and ("b"."entity_id", "b"."locale") in (${keys}))`,
      ),
    sql` or `,
  );
  return [
    sql`insert into ${translationBookkeeping} (project_id, draft_id, entity, entity_id, locale, source, output)
      select "d"."project_id", null, "d"."entity", "d"."entity_id", "d"."locale", "d"."source", "d"."output"
      from ${translationBookkeeping} as "d"
      where "d"."draft_id" = ${scope.id}
      on conflict (entity, entity_id, locale) where draft_id is null
      do update set source = excluded.source, output = excluded.output`,
    sql`delete from ${translationBookkeeping} as "b"
      where "b"."draft_id" is null and "b"."project_id" = ${scope.projectId} and not (${heldByLive})`,
  ];
}
