import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { record } from "../../lib/journal";
import { scheduleAiJob } from "../../lib/schedule-ai-job";
import type { Bindings } from "../../types";
import * as overlay from "../drafts/overlay";
import type { DraftScope } from "../drafts/scope";
import {
  generatedValues,
  type GeneratedEntity,
  type GeneratedType,
  type GeneratedValues,
} from "./schema";

// Generated values sit beside content (ADR 0012). A draft reads its own value and falls back to
// Live's. Jobs are keyed by entity, type, and Live or draft; requesting one marks the value
// pending until a job of that key finishes.

/** Where a value is stored: Live (`draftId` null) or one draft, in a project. */
export type ValueHome = { projectId: number; draftId: string | null };

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

export const homeOf = (scope: DraftScope, projectId: number): ValueHome => ({
  projectId,
  draftId: scope?.id ?? null,
});

// D1 binds at most 100 parameters per statement.
const CHUNK = 90;

/** The values of entities as a scope reads them, by entity id. Missing ids have no value. */
export const readValues = Effect.fn("generatedValues.read")(function* <T extends GeneratedType>(
  db: Database,
  scope: DraftScope,
  entity: GeneratedEntity,
  type: T,
  ids: readonly string[],
) {
  const shown = yield* readValuesOf(db, scope, type, { [entity]: ids });
  return shown.get(entity) ?? new Map<string, ShownValue<T>>();
});

/**
 * The values of entities of several kinds as a scope reads them, by kind then entity id, in one
 * query per chunk of ids. Missing ids have no value.
 */
export const readValuesOf = Effect.fn("generatedValues.readOf")(function* <T extends GeneratedType>(
  db: Database,
  scope: DraftScope,
  type: T,
  idsByEntity: Partial<Record<GeneratedEntity, readonly string[]>>,
) {
  const shown = new Map<GeneratedEntity, Map<string, ShownValue<T>>>();
  const wanted = (Object.entries(idsByEntity) as [GeneratedEntity, readonly string[]][]).flatMap(
    ([entity, ids]) => [...new Set(ids)].map((id) => ({ entity, id })),
  );
  const keyOf = (entity: string, id: string) => `${entity}\u0000${id}`;
  const asked = new Set(wanted.map(({ entity, id }) => keyOf(entity, id)));
  for (let start = 0; start < wanted.length; start += CHUNK) {
    const chunk = wanted.slice(start, start + CHUNK);
    const rows = yield* Effect.promise(() =>
      db
        .select()
        .from(generatedValues)
        .where(
          and(
            inArray(generatedValues.entity, [...new Set(chunk.map(({ entity }) => entity))]),
            eq(generatedValues.type, type),
            inArray(generatedValues.entityId, [...new Set(chunk.map(({ id }) => id))]),
            scope
              ? or(isNull(generatedValues.draftId), eq(generatedValues.draftId, scope.id))
              : isNull(generatedValues.draftId),
          ),
        ),
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
  }
  return shown;
});

/** One entity's value as a scope reads it. */
export const readValue = Effect.fn("generatedValues.readOne")(function* <T extends GeneratedType>(
  db: Database,
  scope: DraftScope,
  key: ValueKey<T>,
) {
  const shown = yield* readValues(db, scope, key.entity, key.type, [key.entityId]);
  return shown.get(key.entityId) ?? { value: null, pending: false };
});

const conflictTarget = (draftId: string | null) =>
  draftId === null
    ? {
        target: [generatedValues.entity, generatedValues.entityId, generatedValues.type],
        targetWhere: sql`${generatedValues.draftId} is null`,
      }
    : {
        target: [
          generatedValues.draftId,
          generatedValues.entity,
          generatedValues.entityId,
          generatedValues.type,
        ],
        targetWhere: sql`${generatedValues.draftId} is not null`,
      };

/** Clears the pending mark unless a job was requested after this one started. */
const settled = (startedAt: number) =>
  sql`case when ${generatedValues.requestedAt} <= ${startedAt} then null else ${generatedValues.requestedAt} end`;

/** Records that a value, or whether it's pending, changed: it shows with its entity. */
const recordValue = (db: Database, home: ValueHome, key: ValueKey) =>
  record(db, { kind: "generated", entity: key.entity, id: key.entityId, ...home });

/**
 * Upserts a value row. A draft that ended meanwhile has no row to hold it: nothing is written,
 * as for any job whose draft ended.
 */
const upsert = (
  db: Database,
  home: ValueHome,
  key: ValueKey,
  insert: { value?: GeneratedValues[GeneratedType] | null; requestedAt?: number | null },
  set: Record<string, unknown>,
) =>
  Effect.tryPromise(() =>
    db
      .insert(generatedValues)
      .values({ ...home, ...key, ...insert })
      .onConflictDoUpdate({ ...conflictTarget(home.draftId), set }),
  ).pipe(
    Effect.andThen(() => recordValue(db, home, key)),
    Effect.ignore,
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
    { value, requestedAt: null },
    { value, generatedAt: now, requestedAt: settled(startedAt) },
  );
};

/** Settles a job that generated nothing, e.g. because its group is manual. */
export const settleRequest = (db: Database, home: ValueHome, key: ValueKey, startedAt: number) =>
  Effect.andThen(
    Effect.promise(() =>
      db
        .update(generatedValues)
        .set({ requestedAt: settled(startedAt) })
        .where(
          and(
            eq(generatedValues.entity, key.entity),
            eq(generatedValues.entityId, key.entityId),
            eq(generatedValues.type, key.type),
            home.draftId === null
              ? isNull(generatedValues.draftId)
              : eq(generatedValues.draftId, home.draftId),
          ),
        ),
    ),
    recordValue(db, home, key),
  );

const GENERATED_ENTITIES: GeneratedEntity[] = [
  "block",
  "sharedContent",
  "repeatableItem",
  "page",
  "file",
];

const ENTITY_TABLES = {
  block: "blocks",
  repeatableItem: "repeatableItems",
  page: "pages",
  file: "files",
} as const;

/** The entities a job runs on: a synced block's summary is generated through a placement. */
export type JobEntity = keyof typeof ENTITY_TABLES;

const JOB_TYPES = {
  block: "summary",
  repeatableItem: "summary",
  page: "seo",
  file: "fileMetadata",
} as const satisfies Record<JobEntity, GeneratedType>;

export type GenerationDeps = {
  db: Database;
  env: Pick<Bindings, "AI_JOB_SCHEDULER">;
  waitUntil: (promise: Promise<unknown>) => void;
};

/**
 * Requests a value's generation in a scope: marks it pending and schedules the job keyed by
 * entity, type, and Live or draft. A newer request for the same key replaces the job.
 */
export const requestGeneration = Effect.fn("generatedValues.request")(function* (
  deps: GenerationDeps,
  home: ValueHome,
  job: { entity: JobEntity; entityId: string; delayMs: number },
) {
  const now = Date.now();
  const key: ValueKey = { entity: job.entity, entityId: job.entityId, type: JOB_TYPES[job.entity] };
  yield* upsert(deps.db, home, key, { requestedAt: now }, { requestedAt: now });
  deps.waitUntil(
    scheduleAiJob(deps.env.AI_JOB_SCHEDULER, {
      entityTable: ENTITY_TABLES[job.entity],
      entityId: job.entityId,
      type: key.type,
      delayMs: job.delayMs,
      draftId: home.draftId,
    }),
  );
});

/** Copies a value to another entity in the same scope, e.g. onto a duplicate. */
export const copyValue = Effect.fn("generatedValues.copy")(function* (
  db: Database,
  scope: DraftScope,
  home: ValueHome,
  from: ValueKey,
  toEntityId: string,
) {
  const shown = yield* readValue(db, scope, from);
  if (!shown.value) return;
  const key = { ...from, entityId: toEntityId };
  yield* upsert(db, home, key, { value: shown.value }, { value: shown.value });
});

// --- Publishing and discarding (ADR 0012) ---

/**
 * Run once Live holds what the publish leaves: copies the draft's values over Live's, then drops
 * Live's values of entities Live doesn't hold (what the draft deleted, the descendants deleted
 * with it, and changes dropped as lost), and deletes the draft's own, also when a development
 * draft stays.
 */
export function publishStatements(
  db: Database,
  scope: NonNullable<DraftScope>,
): overlay.BatchItem[] {
  const entities = new Set<string>(GENERATED_ENTITIES);
  const heldByLive = sql.join(
    overlay
      .liveIds()
      .filter(({ entity }) => entities.has(entity))
      .map(({ entity, ids }) => sql`("v"."entity" = ${entity} and "v"."entity_id" in (${ids}))`),
    sql` or `,
  );
  return [
    sql`insert into ${generatedValues} (project_id, draft_id, entity, entity_id, type, value, requested_at, generated_at)
      select "d"."project_id", null, "d"."entity", "d"."entity_id", "d"."type", "d"."value", null, "d"."generated_at"
      from ${generatedValues} as "d"
      where "d"."draft_id" = ${scope.id} and "d"."value" is not null
      on conflict (entity, entity_id, type) where draft_id is null
      do update set value = excluded.value, generated_at = excluded.generated_at`,
    sql`delete from ${generatedValues} as "v"
      where "v"."draft_id" is null and "v"."project_id" = ${scope.projectId} and not (${heldByLive})`,
    db.delete(generatedValues).where(eq(generatedValues.draftId, scope.id)),
  ];
}

/** Discarding deletes the draft's values, also when a development draft stays. */
export function discardStatements(db: Database, draftId: string): overlay.BatchItem[] {
  return [db.delete(generatedValues).where(eq(generatedValues.draftId, draftId))];
}
