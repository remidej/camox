import { and, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { Effect } from "effect";

import type { Database } from "../../db";
import { blocks } from "../blocks/schema";
import type { DraftScope } from "./scope";

// The draft overlay (ADR 0005) owns every draft-aware data operation on content tables, so
// domain services never filter on `draft_id` themselves. Live rows have no draft; a draft row
// is the draft's copy of an entity, an entity the draft created, or a tombstone.
//
// - A read in a draft takes the draft's row where there is one and Live's otherwise, minus
//   tombstones.
// - The first write in a draft copies the whole Live entity and records its version as
//   `base_version`. Later writes patch the copy; the last write wins.
// - A delete in a draft writes a tombstone for the entity only.
// - A write to Live counts a change on the row's `version`.

/** The columns every content table has for living beside Live. */
type ContentColumns = {
  rowId: AnySQLiteColumn;
  id: AnySQLiteColumn;
  draftId: AnySQLiteColumn;
  version: AnySQLiteColumn;
  baseVersion: AnySQLiteColumn;
  deleted: AnySQLiteColumn;
};

export type ContentTable = SQLiteTable & ContentColumns;

type Row<T extends ContentTable> = T["$inferSelect"];
type Values<T extends ContentTable> = T["$inferInsert"];
/** The columns a write may set: everything but the overlay's own bookkeeping. */
type Patch<T extends ContentTable> = Partial<
  Omit<Values<T>, "rowId" | "id" | "draftId" | "version" | "baseVersion" | "deleted">
>;

export type ContentTableRegistration = {
  /** The columns naming the entity's parent, whose deletion deletes it on publish. */
  parent: AnySQLiteColumn[];
  /** The columns a change on another entity can rewrite, copying this one into the draft. */
  rewritable: AnySQLiteColumn[];
};

const registrations = new Map<ContentTable, ContentTableRegistration>();

/** Declares a content table to the overlay. Only registered tables can be read or written. */
export function registerContentTable(table: ContentTable, registration: ContentTableRegistration) {
  registrations.set(table, registration);
}

/** A registered content table's declaration. */
export function registrationOf(table: ContentTable): ContentTableRegistration {
  const registration = registrations.get(table);
  if (!registration) throw new Error("This table isn't registered with the draft overlay.");
  return registration;
}

registerContentTable(blocks, {
  parent: [blocks.pageId, blocks.layoutId],
  rewritable: [blocks.content],
});

/** The rows stored in a scope itself: Live's rows, or one draft's rows including tombstones. */
export function storedIn(table: ContentTable, scope: DraftScope): SQL {
  registrationOf(table);
  return scope ? eq(table.draftId, scope.id) : isNull(table.draftId);
}

/**
 * The rows a draft id can name before the draft is checked: Live's rows and that draft's own,
 * tombstones included. Finds which project an entity belongs to for a request naming a draft.
 */
export function storedInLiveOrDraft(table: ContentTable, draftId: string): SQL {
  registrationOf(table);
  return or(isNull(table.draftId), eq(table.draftId, draftId))!;
}

/** Whether a draft stores any row, copy or tombstone, in any content table. */
export function storesAnything(scope: NonNullable<DraftScope>): SQL {
  const stored = [...registrations.keys()].map(
    (table) => sql`exists (select 1 from ${table} where ${table.draftId} = ${scope.id})`,
  );
  return or(...stored)!;
}

/**
 * The rows a scope reads, as a condition usable in any query on the table: Live's rows, or a
 * draft's own rows plus the Live rows it hasn't copied, minus its tombstones.
 */
export function visibleIn(table: ContentTable, scope: DraftScope): SQL {
  registrationOf(table);
  if (!scope) return isNull(table.draftId);
  const copied = sql`exists (select 1 from ${table} as "draft_row" where "draft_row"."draft_id" = ${scope.id} and "draft_row"."id" = ${table.id})`;
  return and(
    eq(table.deleted, false),
    sql`(${table.draftId} = ${scope.id} or (${table.draftId} is null and not ${copied}))`,
  )!;
}

/** The rows a scope reads, matching an optional condition. */
export const select = Effect.fn("overlay.select")(function* <T extends ContentTable>(
  db: Database,
  scope: DraftScope,
  table: T,
  where?: SQL,
) {
  return (yield* Effect.promise(() =>
    db
      .select()
      .from(table as SQLiteTable)
      .where(and(visibleIn(table, scope), where)),
  )) as Row<T>[];
});

/** The entity with this id as the scope reads it, or undefined when it has none. */
export const get = Effect.fn("overlay.get")(function* <T extends ContentTable>(
  db: Database,
  scope: DraftScope,
  table: T,
  id: string,
) {
  return (yield* Effect.promise(() =>
    db
      .select()
      .from(table as SQLiteTable)
      .where(and(visibleIn(table, scope), eq(table.id, id)))
      .get(),
  )) as Row<T> | undefined;
});

const getStored = (db: Database, scope: DraftScope, table: ContentTable, id: string) =>
  Effect.promise(
    () =>
      db
        .select()
        .from(table as SQLiteTable)
        .where(and(storedIn(table, scope), eq(table.id, id)))
        .get() as Promise<Row<ContentTable> | undefined>,
  );

/**
 * Creates an entity in the scope. Undefined when the scope already reads an entity with this
 * id, or a draft deleted it.
 */
export const insert = Effect.fn("overlay.insert")(function* <T extends ContentTable>(
  db: Database,
  scope: DraftScope,
  table: T,
  values: Patch<T> & { id?: string },
) {
  if (scope && values.id !== undefined) {
    const taken = yield* getStored(db, null, table, values.id);
    if (taken) return undefined;
  }
  const row = { ...values, draftId: scope?.id ?? null, baseVersion: null, deleted: false };
  return (yield* Effect.promise(() =>
    db
      .insert(table as SQLiteTable)
      .values(row as Values<T>)
      .onConflictDoNothing()
      .returning()
      .get(),
  )) as Row<T> | undefined;
});

/**
 * Changes an entity as the scope reads it. On Live, counts a change. In a draft, the first
 * write copies the whole Live entity, recording the version it copied. Undefined when the scope
 * reads no entity with this id.
 */
export const update = Effect.fn("overlay.update")(function* <T extends ContentTable>(
  db: Database,
  scope: DraftScope,
  table: T,
  id: string,
  patch: Patch<T>,
) {
  if (!scope) {
    return (yield* Effect.promise(() =>
      db
        .update(table as SQLiteTable)
        .set({ ...patch, version: sql`${table.version} + 1` } as Partial<Values<T>>)
        .where(and(storedIn(table, null), eq(table.id, id)))
        .returning()
        .get(),
    )) as Row<T> | undefined;
  }
  const stored = yield* getStored(db, scope, table, id);
  if (stored?.deleted) return undefined;
  if (!stored) {
    const copy = yield* copyIntoDraft(db, scope, table, id, patch);
    if (!copy.taken) return copy.row as Row<T> | undefined;
  }
  return (yield* Effect.promise(() =>
    db
      .update(table as SQLiteTable)
      .set(patch as Partial<Values<T>>)
      .where(and(storedIn(table, scope), eq(table.id, id), eq(table.deleted, false)))
      .returning()
      .get(),
  )) as Row<T> | undefined;
});

/**
 * Copies a Live entity into a draft with changes applied: the copy, or no row when Live has no
 * such entity. `taken` when a concurrent write copied it first, so the caller patches that copy.
 */
const copyIntoDraft = Effect.fn("overlay.copyIntoDraft")(function* (
  db: Database,
  scope: NonNullable<DraftScope>,
  table: ContentTable,
  id: string,
  changes: Record<string, unknown>,
): Effect.fn.Return<{ taken: true } | { taken: false; row: Row<ContentTable> | undefined }> {
  const live = yield* getStored(db, null, table, id);
  if (!live) return { taken: false, row: undefined };
  const { rowId: _rowId, ...entity } = live as Record<string, unknown>;
  const copy = yield* Effect.promise(() =>
    db
      .insert(table as SQLiteTable)
      .values({
        ...entity,
        ...changes,
        draftId: scope.id,
        baseVersion: live.version,
      } as Values<ContentTable>)
      .onConflictDoNothing()
      .returning()
      .get(),
  );
  if (!copy) return { taken: true };
  return { taken: false, row: copy as Row<ContentTable> };
});

/**
 * Deletes an entity as the scope reads it, returning the row the scope read. On Live the row is
 * deleted. In a draft, an entity the draft created is deleted and any other gets a tombstone.
 */
export const remove = Effect.fn("overlay.remove")(function* <T extends ContentTable>(
  db: Database,
  scope: DraftScope,
  table: T,
  id: string,
) {
  const shown = yield* get(db, scope, table, id);
  if (!shown) return undefined;
  const createdByDraft = scope != null && shown.draftId === scope.id && shown.baseVersion == null;
  if (!scope || createdByDraft) {
    yield* Effect.promise(() =>
      db.delete(table as SQLiteTable).where(and(storedIn(table, scope), eq(table.id, id))),
    );
    return shown;
  }
  if (shown.draftId === scope.id) {
    yield* Effect.promise(() =>
      db
        .update(table as SQLiteTable)
        .set({ deleted: true } as Partial<Values<T>>)
        .where(and(storedIn(table, scope), eq(table.id, id))),
    );
    return shown;
  }
  yield* copyIntoDraft(db, scope, table, id, { deleted: true });
  // A concurrent write may have copied it first.
  yield* Effect.promise(() =>
    db
      .update(table as SQLiteTable)
      .set({ deleted: true } as Partial<Values<T>>)
      .where(and(storedIn(table, scope), eq(table.id, id))),
  );
  return shown;
});

/**
 * Writes values onto an entity only where the scope already stores it, never copying it and
 * never counting a change: the path for generated values (ADR 0012). Undefined when the scope
 * stores no such entity.
 */
export const updateExisting = Effect.fn("overlay.updateExisting")(function* <
  T extends ContentTable,
>(db: Database, scope: DraftScope, table: T, id: string, values: Patch<T>) {
  return (yield* Effect.promise(() =>
    db
      .update(table as SQLiteTable)
      .set(values as Partial<Values<T>>)
      .where(and(storedIn(table, scope), eq(table.id, id), eq(table.deleted, false)))
      .returning()
      .get(),
  )) as Row<T> | undefined;
});

/**
 * Orders by fractional position, then by id: positions picked in different drafts can collide
 * (ADR 0005).
 */
export function compareByPosition(
  a: { position: string; id: string },
  b: { position: string; id: string },
): number {
  if (a.position !== b.position) return a.position < b.position ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** Sorts in place by position, then id. */
export function sortByPosition<T extends { position: string; id: string }>(rows: T[]): T[] {
  return rows.sort(compareByPosition);
}
