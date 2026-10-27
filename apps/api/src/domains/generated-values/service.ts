import { and, eq, inArray, isNull, or, type SQL, sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { Effect } from "effect";

import type { Database } from "../../db";
import { record } from "../../lib/journal";
import { readInChunks } from "../content/chunks";
import * as overlay from "../drafts/overlay";
import { drafts } from "../drafts/schema";
import { draftIn, type Draft, type ReadScope } from "../drafts/scope";
import { defaultLocaleOf } from "../locales/default-locale";
import { locales } from "../locales/schema";
import {
  generatedValues,
  LOCALIZED,
  type GeneratedEntity,
  type GeneratedType,
  type GeneratedValues,
} from "./schema";

// Generated values sit beside content (ADR 0012). A draft reads its own value and falls back to
// Live's. Values are per locale, like content (ADR 0015), except summaries, which are generated
// in the default locale only: every locale reads the default locale's. Jobs are keyed by entity,
// type, locale, and Live or draft; requesting one marks the value pending until a job of that key
// finishes.

/**
 * Where a value is stored: Live (`draftId` null) or one draft, in a project, in a locale named by
 * its tag, or without one in the default locale.
 */
export type ValueHome = { projectId: number; draftId: string | null; locale?: string };

export type ValueKey<T extends GeneratedType = GeneratedType> = {
  entity: GeneratedEntity;
  entityId: string;
  type: T;
};

/** A value as a scope reads it: null when nothing was generated yet. */
export type ShownValue<T extends GeneratedType> = {
  value: GeneratedValues[T] | null;
  /** Whether a job is requested and hasn't finished. */
  pending: boolean;
};

/** Where a scope stores its values: its draft or Live, in its locale. */
export const homeOf = (scope: ReadScope, projectId: number): ValueHome => {
  const locale = scope?.locale;
  return { projectId, draftId: draftIn(scope)?.id ?? null, ...(locale ? { locale } : {}) };
};

/**
 * The tag of the locale a value of `type` is stored in, as SQL: the locale named, or the
 * project's default locale. A value that isn't localized is only ever in the default locale.
 */
const valueLocale = (
  type: GeneratedType,
  locale: string | undefined,
  projectId: SQL | AnySQLiteColumn | number,
): SQL => (!LOCALIZED[type] || locale === undefined ? defaultLocaleOf(projectId) : sql`${locale}`);

// D1 binds at most 100 parameters per statement.
const CHUNK = 90;

/** The values of entities as a scope reads them, by entity id. Missing ids have no value. */
export const readValues = Effect.fn("generatedValues.read")(function* <T extends GeneratedType>(
  db: Database,
  scope: ReadScope,
  entity: GeneratedEntity,
  type: T,
  ids: readonly string[],
) {
  const shown = yield* readValuesOf(db, scope, type, { [entity]: ids });
  return shown.get(entity) ?? new Map<string, ShownValue<T>>();
});

/**
 * The values of entities of several kinds as a scope reads them, by kind then entity id, in one
 * query per chunk of ids, read at once. Missing ids have no value.
 */
export const readValuesOf = Effect.fn("generatedValues.readOf")(function* <T extends GeneratedType>(
  db: Database,
  scope: ReadScope,
  type: T,
  idsByEntity: Partial<Record<GeneratedEntity, readonly string[]>>,
) {
  const shown = new Map<GeneratedEntity, Map<string, ShownValue<T>>>();
  const wanted = (Object.entries(idsByEntity) as [GeneratedEntity, readonly string[]][]).flatMap(
    ([entity, ids]) => [...new Set(ids)].map((id) => ({ entity, id })),
  );
  const keyOf = (entity: string, id: string) => `${entity}\u0000${id}`;
  // A scope reads its draft's values over Live's, in its locale.
  const draft = draftIn(scope);
  const locale = sql`${generatedValues.locale} = ${valueLocale(type, scope?.locale, generatedValues.projectId)}`;
  const asked = new Set(wanted.map(({ entity, id }) => keyOf(entity, id)));
  const rows = yield* readInChunks(
    wanted,
    (chunk) =>
      Effect.promise(() =>
        db
          .select()
          .from(generatedValues)
          .where(
            and(
              inArray(generatedValues.entity, [...new Set(chunk.map(({ entity }) => entity))]),
              eq(generatedValues.type, type),
              inArray(generatedValues.entityId, [...new Set(chunk.map(({ id }) => id))]),
              draft
                ? or(isNull(generatedValues.draftId), eq(generatedValues.draftId, draft.id))
                : isNull(generatedValues.draftId),
              locale,
            ),
          ),
      ),
    CHUNK,
  );
  const relevant = rows.filter((row) => asked.has(keyOf(row.entity, row.entityId)));
  const live = new Map(
    relevant.filter((r) => r.draftId === null).map((r) => [keyOf(r.entity, r.entityId), r]),
  );
  const own = new Map(
    relevant.filter((r) => r.draftId !== null).map((r) => [keyOf(r.entity, r.entityId), r]),
  );
  for (const row of relevant) {
    const key = keyOf(row.entity, row.entityId);
    const draftRow = own.get(key);
    const liveRow = live.get(key);
    // A draft that hasn't generated its own value yet still shows Live's meanwhile.
    const value = (draftRow?.value ?? liveRow?.value ?? null) as GeneratedValues[T] | null;
    const pending = (draftRow ?? liveRow)?.requestedAt != null;
    const byId = shown.get(row.entity) ?? new Map<string, ShownValue<T>>();
    byId.set(row.entityId, { value, pending });
    shown.set(row.entity, byId);
  }
  return shown;
});

/** One entity's value as a scope reads it. */
export const readValue = Effect.fn("generatedValues.readOne")(function* <T extends GeneratedType>(
  db: Database,
  scope: ReadScope,
  key: ValueKey<T>,
) {
  const shown = yield* readValues(db, scope, key.entity, key.type, [key.entityId]);
  return shown.get(key.entityId) ?? { value: null, pending: false };
});

const conflictTarget = (draftId: string | null) =>
  draftId === null
    ? {
        target: [
          generatedValues.entity,
          generatedValues.entityId,
          generatedValues.type,
          generatedValues.locale,
        ],
        targetWhere: sql`${generatedValues.draftId} is null`,
      }
    : {
        target: [
          generatedValues.draftId,
          generatedValues.entity,
          generatedValues.entityId,
          generatedValues.type,
          generatedValues.locale,
        ],
        targetWhere: sql`${generatedValues.draftId} is not null`,
      };

/** Clears the pending mark unless a job was requested after this one started. */
const settled = (startedAt: number) =>
  sql`case when ${generatedValues.requestedAt} <= ${startedAt} then null else ${generatedValues.requestedAt} end`;

/** Records that a value, or whether it's pending, changed: it shows with its entity. */
const recordValue = (db: Database, home: ValueHome, key: ValueKey) =>
  record(db, {
    kind: "generated",
    entity: key.entity,
    id: key.entityId,
    type: key.type,
    projectId: home.projectId,
    draftId: home.draftId,
  });

/**
 * Upserts a value row. A draft that ended meanwhile has no row to hold it: nothing is written,
 * as for any job whose draft ended. Any other failure fails the write.
 */
const upsert = (
  db: Database,
  home: ValueHome,
  key: ValueKey,
  insert: {
    value?: GeneratedValues[GeneratedType] | null;
    requestedAt?: number | null;
    generatedAt?: number;
  },
  set: Record<string, unknown>,
) =>
  Effect.tryPromise(() =>
    db
      .insert(generatedValues)
      .values({
        projectId: home.projectId,
        draftId: home.draftId,
        ...key,
        locale: valueLocale(key.type, home.locale, home.projectId),
        ...insert,
      })
      .onConflictDoUpdate({ ...conflictTarget(home.draftId), set }),
  ).pipe(
    Effect.as(true),
    Effect.catch((error) =>
      Effect.flatMap(draftEnded(db, home.draftId), (ended) =>
        ended ? Effect.succeed(false) : Effect.die(error),
      ),
    ),
    Effect.flatMap((written) => (written ? recordValue(db, home, key) : Effect.void)),
  );

/** Whether a value's draft has ended: Live never does. */
const draftEnded = (db: Database, draftId: string | null) =>
  draftId === null
    ? Effect.succeed(false)
    : Effect.map(
        Effect.promise(() =>
          db.select({ id: drafts.id }).from(drafts).where(eq(drafts.id, draftId)).get(),
        ),
        (draft) => draft === undefined,
      );

/**
 * Stores a job's value where it was scheduled from, settling the job unless another one was
 * requested since it started.
 */
export const saveValue = <T extends GeneratedType>(
  db: Database,
  home: ValueHome,
  key: ValueKey<T>,
  value: GeneratedValues[T],
  startedAt: number,
) => {
  const now = Date.now();
  return upsert(
    db,
    home,
    key,
    { value, requestedAt: null, generatedAt: now },
    { value, generatedAt: now, requestedAt: settled(startedAt) },
  );
};

const keyIn = (draftId: string | null, locale: string | undefined, key: ValueKey) =>
  and(
    eq(generatedValues.entity, key.entity),
    eq(generatedValues.entityId, key.entityId),
    eq(generatedValues.type, key.type),
    draftId === null ? isNull(generatedValues.draftId) : eq(generatedValues.draftId, draftId),
    sql`${generatedValues.locale} = ${valueLocale(key.type, locale, generatedValues.projectId)}`,
  );

/**
 * Where a job's value is stored: its project, the tag of its locale, and when it was last
 * generated. Undefined when the value has no row, as when its draft ended.
 */
export const storedValue = (
  db: Database,
  draftId: string | null,
  locale: string | undefined,
  key: ValueKey,
) =>
  Effect.promise(() =>
    db
      .select({
        projectId: generatedValues.projectId,
        locale: generatedValues.locale,
        generatedAt: generatedValues.generatedAt,
      })
      .from(generatedValues)
      .where(keyIn(draftId, locale, key))
      .get(),
  );

/** Settles a job that generated nothing, e.g. because its group is manual. */
export const settleRequest = (db: Database, home: ValueHome, key: ValueKey, startedAt: number) =>
  Effect.andThen(
    Effect.promise(() =>
      db
        .update(generatedValues)
        .set({ requestedAt: settled(startedAt) })
        .where(keyIn(home.draftId, home.locale, key)),
    ),
    recordValue(db, home, key),
  );

/**
 * Settles a job that failed for good, so its value stops showing as pending: the value stays as
 * it was. The job doesn't know its project; the value's row does.
 */
export const settleFailedRequest = Effect.fn("generatedValues.settleFailed")(function* (
  db: Database,
  draftId: string | null,
  locale: string | undefined,
  key: ValueKey,
  startedAt: number,
) {
  const rows = yield* Effect.promise(() =>
    db
      .update(generatedValues)
      .set({ requestedAt: settled(startedAt) })
      .where(keyIn(draftId, locale, key))
      .returning({ projectId: generatedValues.projectId }),
  );
  for (const { projectId } of rows) yield* recordValue(db, { projectId, draftId }, key);
});

/** Marks a value pending: generation was requested and hasn't finished since `requestedAt`. */
export const markRequested = (db: Database, home: ValueHome, key: ValueKey, requestedAt: number) =>
  upsert(db, home, key, { requestedAt }, { requestedAt });

const GENERATED_ENTITIES: GeneratedEntity[] = [
  "block",
  "sharedContent",
  "repeatableItem",
  "page",
  "file",
];

/** Copies a value to another entity in the same scope, e.g. onto a duplicate. */
export const copyValue = Effect.fn("generatedValues.copy")(function* (
  db: Database,
  scope: ReadScope,
  home: ValueHome,
  from: ValueKey,
  toEntityId: string,
) {
  const shown = yield* readValue(db, scope, from);
  if (!shown.value) return;
  const key = { ...from, entityId: toEntityId };
  yield* upsert(db, home, key, { value: shown.value }, { value: shown.value });
});

// --- Publishing and deleting (ADR 0012) ---

/**
 * Run once Live holds what the publish leaves: copies the draft's values over Live's, then drops
 * Live's values of entities Live doesn't hold in their locale (what the draft deleted, the
 * descendants deleted with it, changes dropped as lost, and the localizations of a removed
 * locale) and of files in locales Live doesn't have, and deletes the draft's own, also when a
 * development draft stays.
 */
export function publishStatements(db: Database, scope: Draft): overlay.BatchItem[] {
  const entities = new Set<string>(GENERATED_ENTITIES);
  const liveLocales = sql`select ${locales.tag} from ${locales} where ${locales.projectId} = ${scope.projectId} and ${locales.draftId} is null`;
  const heldByLive = sql.join(
    overlay
      .liveKeys()
      .filter(({ entity }) => entities.has(entity))
      .map(({ entity, keys, localized }) =>
        localized
          ? sql`("v"."entity" = ${entity} and ("v"."entity_id", "v"."locale") in (${keys}))`
          : sql`("v"."entity" = ${entity} and "v"."entity_id" in (${keys}) and "v"."locale" in (${liveLocales}))`,
      ),
    sql` or `,
  );
  return [
    sql`insert into ${generatedValues} (project_id, draft_id, entity, entity_id, type, locale, value, requested_at, generated_at)
      select "d"."project_id", null, "d"."entity", "d"."entity_id", "d"."type", "d"."locale", "d"."value", null, "d"."generated_at"
      from ${generatedValues} as "d"
      where "d"."draft_id" = ${scope.id} and "d"."value" is not null
      on conflict (entity, entity_id, type, locale) where draft_id is null
      do update set value = excluded.value, generated_at = excluded.generated_at`,
    sql`delete from ${generatedValues} as "v"
      where "v"."draft_id" is null and "v"."project_id" = ${scope.projectId} and not (${heldByLive})`,
    db.delete(generatedValues).where(eq(generatedValues.draftId, scope.id)),
  ];
}

/**
 * Renames a locale's tag on every value in a project, on Live and in every draft, along with the
 * content naming it (ADR 0015).
 */
export function retagStatements(
  db: Database,
  projectId: number,
  from: string,
  to: string,
): overlay.BatchItem[] {
  return [
    db
      .update(generatedValues)
      .set({ locale: to })
      .where(and(eq(generatedValues.projectId, projectId), eq(generatedValues.locale, from))),
  ];
}

/** Deleting deletes the draft's values, also when a development draft stays. */
export function deleteStatements(db: Database, draftId: string): overlay.BatchItem[] {
  return [db.delete(generatedValues).where(eq(generatedValues.draftId, draftId))];
}
