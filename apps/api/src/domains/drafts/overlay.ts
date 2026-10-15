import type { DraftOutcome } from "@camox/api-contract/drafts";
import {
  and,
  eq,
  getTableColumns,
  getTableName,
  inArray,
  is,
  isNull,
  or,
  SQL,
  sql,
} from "drizzle-orm";
import {
  SQLiteAsyncDialect,
  type AnySQLiteColumn,
  type SQLiteTable,
} from "drizzle-orm/sqlite-core";
import { Effect } from "effect";

import type { Database } from "../../db";
import { blocks, sharedContents } from "../blocks/schema";
import { comments } from "../comments/schema";
import { layouts } from "../layouts/schema";
import { pages } from "../pages/schema";
import { environments } from "../projects/schema";
import { repeatableItems } from "../repeatable-items/schema";
import { drafts, endedDrafts } from "./schema";
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
  firstPublishedAt: AnySQLiteColumn;
  publishedAt: AnySQLiteColumn;
  publishedBy: AnySQLiteColumn;
  // On a tombstone, when the draft deleted the entity.
  updatedAt: AnySQLiteColumn;
};

export type ContentTable = SQLiteTable & ContentColumns;

type Row<T extends ContentTable> = T["$inferSelect"];
type Values<T extends ContentTable> = T["$inferInsert"];
/** The overlay's own bookkeeping columns, which publishing sets rather than copies. */
const bookkeeping = [
  "rowId",
  "id",
  "draftId",
  "version",
  "baseVersion",
  "deleted",
  "firstPublishedAt",
  "publishedAt",
  "publishedBy",
] as const;
/** The columns a write may set: everything but the overlay's own bookkeeping. */
type Patch<T extends ContentTable> = Partial<Omit<Values<T>, (typeof bookkeeping)[number]>>;

/**
 * A column naming the entity's parent: `key` on the parent's table, also matching every
 * `within` pair (child column, parent column). The parent's table is a registered content
 * table, read through the draft, or a Live-only one.
 */
type ParentRelation = {
  column: AnySQLiteColumn;
  key: AnySQLiteColumn;
  within?: [child: AnySQLiteColumn, parent: AnySQLiteColumn][];
};

/**
 * A Live-only table whose rows belong to the entity through `column`. Publishing a deletion
 * deletes them (`delete`) or clears their pointer (`detach`) once nothing holds the entity.
 */
type Dependent = { onDelete: "delete" | "detach"; column: AnySQLiteColumn };

export type ContentTableRegistration = {
  /** What the entity is called in changes, conflicts and publish tokens. */
  entity: string;
  /**
   * The columns naming the entity's parent. A change whose parent is gone is lost, and
   * publishing deletes Live entities whose parent nothing holds any more: descendants of what
   * the draft deleted.
   */
  parents: ParentRelation[];
  /** The columns a change on another entity can rewrite, copying this one into the draft. */
  rewritable: AnySQLiteColumn[];
  dependents: Dependent[];
  /**
   * The comment column anchoring comments to the entity. Deleting the entity deletes the
   * scope's comments on it, and publishing a deletion deletes Live's (#241).
   */
  commentAnchor?: AnySQLiteColumn;
  /** The table's rows in a project, Live's and every draft's, as a condition on the table. */
  inProject: (projectId: number) => SQL;
};

const registrations = new Map<ContentTable, ContentTableRegistration>();

/**
 * Declares a content table to the overlay. Only registered tables can be read or written.
 * Register parents before their children: publishing deletes descendants in this order.
 */
export function registerContentTable(table: ContentTable, registration: ContentTableRegistration) {
  registrations.set(table, registration);
}

/** A registered content table's declaration. */
export function registrationOf(table: ContentTable): ContentTableRegistration {
  const registration = registrations.get(table);
  if (!registration) throw new Error("This table isn't registered with the draft overlay.");
  return registration;
}

/** The ids of a project's environments, as a subquery. */
const environmentsOf = (projectId: number) =>
  sql`(select ${environments.id} from ${environments} where ${environments.projectId} = ${projectId})`;

registerContentTable(pages, {
  entity: "page",
  parents: [{ column: pages.parentPageId, key: pages.id }],
  // Renaming or moving a page rewrites the full path of every descendant page.
  rewritable: [pages.fullPath],
  dependents: [{ onDelete: "delete", column: comments.pageId }],
  commentAnchor: comments.pageId,
  inProject: (projectId) => eq(pages.projectId, projectId),
});

registerContentTable(blocks, {
  entity: "block",
  parents: [
    { column: blocks.pageId, key: pages.id },
    {
      column: blocks.layoutId,
      key: layouts.layoutId,
      within: [[blocks.environmentId, layouts.environmentId]],
    },
  ],
  rewritable: [],
  dependents: [{ onDelete: "detach", column: comments.blockId }],
  commentAnchor: comments.blockId,
  inProject: (projectId) => sql`${blocks.environmentId} in ${environmentsOf(projectId)}`,
});

registerContentTable(sharedContents, {
  entity: "sharedContent",
  parents: [],
  rewritable: [],
  dependents: [],
  inProject: (projectId) => sql`${sharedContents.environmentId} in ${environmentsOf(projectId)}`,
});

registerContentTable(repeatableItems, {
  entity: "repeatableItem",
  parents: [
    { column: repeatableItems.blockId, key: blocks.id },
    { column: repeatableItems.parentItemId, key: repeatableItems.id },
    {
      column: repeatableItems.sharedContentType,
      key: sharedContents.type,
      within: [[repeatableItems.environmentId, sharedContents.environmentId]],
    },
  ],
  rewritable: [],
  dependents: [{ onDelete: "detach", column: comments.itemId }],
  commentAnchor: comments.itemId,
  // An item's tree is rooted in a shared content of the environment, or in a block.
  inProject: (projectId) =>
    sql`(${repeatableItems.environmentId} in ${environmentsOf(projectId)} or ${repeatableItems.blockId} in (select "owner"."id" from ${blocks} as "owner" where "owner"."environment_id" in ${environmentsOf(projectId)}))`,
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

/**
 * The row a scope itself stores for an entity, tombstone included: unlike `get`, a draft finds
 * no row for an entity it reads from Live.
 */
export const getStored = <T extends ContentTable>(
  db: Database,
  scope: DraftScope,
  table: T,
  id: string,
) =>
  Effect.promise(
    () =>
      db
        .select()
        .from(table as SQLiteTable)
        .where(and(storedIn(table, scope), eq(table.id, id)))
        .get() as Promise<Row<T> | undefined>,
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
  yield* deleteCommentsOn(db, scope, table, id);
  const createdByDraft = scope != null && shown.draftId === scope.id && shown.baseVersion == null;
  if (!scope || createdByDraft) {
    yield* Effect.promise(() =>
      db.delete(table as SQLiteTable).where(and(storedIn(table, scope), eq(table.id, id))),
    );
    return shown;
  }
  if (shown.draftId !== scope.id) yield* copyIntoDraft(db, scope, table, id, { deleted: true });
  // Marks the draft's copy, also when a concurrent write copied it first. The time tells Live
  // descendants written since, which publishing loses, from older ones.
  yield* Effect.promise(() =>
    db
      .update(table as SQLiteTable)
      .set({ deleted: true, updatedAt: Date.now() } as Partial<Values<T>>)
      .where(and(storedIn(table, scope), eq(table.id, id))),
  );
  return shown;
});

/** Deletes the comments a scope wrote on an entity it deletes (#241). */
const deleteCommentsOn = (db: Database, scope: DraftScope, table: ContentTable, id: string) => {
  const anchor = registrationOf(table).commentAnchor;
  if (!anchor) return Effect.void;
  const writtenHere = scope ? eq(comments.draftId, scope.id) : isNull(comments.draftId);
  return Effect.promise(() => db.delete(comments).where(and(writtenHere, eq(anchor, id))));
};

/**
 * Whether a comment is anchored to an entity the draft deletes, through any registered table's
 * comment anchor. Comments on what that entity holds are anchored to it too: an item's comment
 * names its block, and a block's names its page.
 */
export function anchoredToDeletionIn(draftId: string): SQL {
  const checks = tables().flatMap((table) => {
    const anchor = registrationOf(table).commentAnchor;
    if (!anchor) return [];
    const t = sql.identifier(getTableName(table));
    return [
      sql`${anchor} in (select ${at("d", table.id)} from ${t} as "d" where ${at("d", table.draftId)} = ${draftId} and ${at("d", table.deleted)} = 1)`,
    ];
  });
  return checks.length ? or(...checks)! : sql`0`;
}

/**
 * The ids among `ids` that Live or any draft still holds as an entity, tombstones aside: what
 * points at these entities still has a reader, so it must stay.
 */
export const idsHeldAnywhere = Effect.fn("overlay.idsHeldAnywhere")(function* (
  db: Database,
  table: ContentTable,
  ids: string[],
) {
  registrationOf(table);
  if (ids.length === 0) return new Set<string>();
  const rows = yield* Effect.promise(
    () =>
      db
        .selectDistinct({ id: table.id })
        .from(table as SQLiteTable)
        .where(and(inArray(table.id, ids), eq(table.deleted, false))) as Promise<{ id: string }[]>,
  );
  return new Set(rows.map((row) => row.id));
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

// --- Releases (ADR 0006, ADR 0007) ---
//
// Besides publishing, a release is the only writer of Live. What it writes is published by no
// member, which the studio shows as "a release".

/** The bookkeeping of an entity a release adds to Live. */
export function releasedNew(now: number) {
  return { firstPublishedAt: now, publishedAt: now, publishedBy: null };
}

/**
 * The bookkeeping of a Live entity a release changes: a counted change, so drafts that copied
 * it see a conflict.
 */
export function releasedChange(table: ContentTable, now: number) {
  return { version: sql`${table.version} + 1`, publishedAt: now, publishedBy: null };
}

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

// --- Publishing and discarding (ADR 0009) ---
//
// A draft's rows are applied to Live with a fixed number of set-based statements per registered
// table, so one D1 `batch()` publishes a draft of any size atomically.

/** A conflict as shown to the caller and sent back to publish: entity, id, Live version. */
export type ConflictKey = [entity: string, id: string, liveVersion: number | null];

/** A statement of a publish or discard batch: raw SQL or a query builder. */
export type BatchItem = SQL | { toSQL(): { sql: string; params: unknown[] } };

const dialect = new SQLiteAsyncDialect();

/**
 * Runs statements as one D1 batch, atomically. Drizzle's own `batch()` can't bind raw SQL with
 * parameters, so the statements go to D1 directly.
 */
function runBatch(db: Database, statements: BatchItem[]) {
  const client = db.$client;
  const prepared = statements.map((statement) => {
    const query = is(statement, SQL) ? dialect.sqlToQuery(statement) : statement.toSQL();
    return client.prepare(query.sql).bind(...query.params);
  });
  return client.batch(prepared);
}

const tables = () => [...registrations.keys()];
const ident = (column: AnySQLiteColumn) => sql.identifier(column.name);
const tableOf = (column: AnySQLiteColumn) => sql.identifier(getTableName(column.table));
const at = (alias: string, column: AnySQLiteColumn) =>
  sql`${sql.identifier(alias)}.${ident(column)}`;

const registeredTableOf = (column: AnySQLiteColumn) =>
  tables().find((table) => getTableName(table) === getTableName(column.table));

/**
 * Where a row of the relation's parent table matches the entity at `alias`. A registered
 * parent counts when Live or the draft `draftId` holds it, tombstones aside; with `anywhere`,
 * when Live or any draft does.
 */
function parentRowMatches(
  relation: ParentRelation,
  alias: string,
  holder: { draftId: string } | "anywhere",
): SQL {
  const { column, key, within = [] } = relation;
  const matches = [
    sql`"parent".${ident(key)} = ${at(alias, column)}`,
    ...within.map(([child, parent]) => sql`"parent".${ident(parent)} = ${at(alias, child)}`),
  ];
  const parentTable = registeredTableOf(key);
  if (parentTable) {
    matches.push(sql`"parent".${ident(parentTable.deleted)} = 0`);
    if (holder !== "anywhere") {
      matches.push(
        sql`("parent".${ident(parentTable.draftId)} is null or "parent".${ident(parentTable.draftId)} = ${holder.draftId})`,
      );
    }
  }
  return sql`exists (select 1 from ${tableOf(key)} as "parent" where ${sql.join(matches, sql` and `)})`;
}

/** Whether the entity at `alias` has every parent it names, in Live or in the draft. */
function parentsExist(table: ContentTable, alias: string, draftId: string): SQL {
  const checks = registrationOf(table).parents.map(
    (relation) =>
      sql`(${at(alias, relation.column)} is null or ${parentRowMatches(relation, alias, { draftId })})`,
  );
  return checks.length ? sql.join(checks, sql` and `) : sql`1`;
}

/**
 * The draft's conflicts in one table: entities it copied or deleted whose Live version moved
 * past the copy's base, or that Live deleted. Lost changes, and deletions of what Live deleted
 * too, aren't conflicts.
 */
function conflictsIn(table: ContentTable, draftId: string): SQL {
  const { entity } = registrationOf(table);
  const t = sql.identifier(getTableName(table));
  return sql`select ${entity} as "entity", ${at("d", table.id)} as "id",
      ${at("l", table.version)} as "live_version",
      ${at("l", table.publishedAt)} as "published_at",
      ${at("l", table.publishedBy)} as "published_by"
    from ${t} as "d"
    left join ${t} as "l" on ${at("l", table.draftId)} is null and ${at("l", table.id)} = ${at("d", table.id)}
    where ${at("d", table.draftId)} = ${draftId}
      and ${at("d", table.baseVersion)} is not null
      and ${parentsExist(table, "d", draftId)}
      and ((${at("l", table.id)} is null and ${at("d", table.deleted)} = 0)
        or ${at("l", table.version)} != ${at("d", table.baseVersion)})`;
}

export type StoredChange = {
  table: ContentTable;
  entity: string;
  row: Row<ContentTable>;
  change: "created" | "changed" | "deleted";
};

/** Every entity a draft stores, as created, changed or deleted. */
export const changesOf = Effect.fn("overlay.changesOf")(function* (
  db: Database,
  scope: NonNullable<DraftScope>,
) {
  const changes: StoredChange[] = [];
  for (const table of tables()) {
    const rows = yield* Effect.promise(
      () =>
        db
          .select()
          .from(table as SQLiteTable)
          .where(storedIn(table, scope)) as Promise<Row<ContentTable>[]>,
    );
    const { entity } = registrationOf(table);
    for (const row of rows) {
      let change: StoredChange["change"] = "changed";
      if (row.deleted) change = "deleted";
      else if (row.baseVersion == null) change = "created";
      changes.push({ table, entity, row, change });
    }
  }
  return changes;
});

export type DraftActivity = { changeCount: number; lastChangedAt: number | null };

/**
 * How many entities each draft stores, the count `changesOf` lists, and when it last wrote one.
 * A draft storing nothing is missing from the map.
 */
export const activityOf = Effect.fn("overlay.activityOf")(function* (
  db: Database,
  draftIds: string[],
) {
  const activity = new Map<string, DraftActivity>();
  if (draftIds.length === 0) return activity;
  for (const table of tables()) {
    const rows = yield* Effect.promise(() =>
      db
        .select({
          draftId: sql<string>`${table.draftId}`,
          count: sql<number>`count(*)`,
          lastChangedAt: sql<number | null>`max(${table.updatedAt})`,
        })
        .from(table as SQLiteTable)
        .where(inArray(table.draftId, draftIds))
        .groupBy(table.draftId),
    );
    for (const row of rows) {
      const known = activity.get(row.draftId) ?? { changeCount: 0, lastChangedAt: null };
      activity.set(row.draftId, {
        changeCount: known.changeCount + row.count,
        lastChangedAt: Math.max(known.lastChangedAt ?? 0, row.lastChangedAt ?? 0) || null,
      });
    }
  }
  return activity;
});

/**
 * Who published Live's most recently published content in a project, and when: the latest
 * publish of any draft, development drafts included, or a release, which has no publisher.
 * Null when nothing was ever published.
 */
export const latestLivePublish = Effect.fn("overlay.latestLivePublish")(function* (
  db: Database,
  projectId: number,
) {
  let latest: { publishedBy: string | null; publishedAt: number } | null = null;
  for (const table of tables()) {
    const row = yield* Effect.promise(() =>
      db
        .select({
          publishedBy: sql<string | null>`${table.publishedBy}`,
          publishedAt: sql<number>`${table.publishedAt}`,
        })
        .from(table as SQLiteTable)
        .where(
          and(
            isNull(table.draftId),
            sql`${table.publishedAt} is not null`,
            registrationOf(table).inProject(projectId),
          ),
        )
        .orderBy(sql`${table.publishedAt} desc`)
        .limit(1)
        .get(),
    );
    if (row && (!latest || row.publishedAt > latest.publishedAt)) latest = row;
  }
  return latest;
});

export type StoredConflict = {
  entity: string;
  id: string;
  liveVersion: number | null;
  publishedAt: number | null;
  publishedBy: string | null;
};

/** The draft's conflicts, with who published Live's version and when. */
export const conflictsOf = Effect.fn("overlay.conflictsOf")(function* (
  db: Database,
  scope: NonNullable<DraftScope>,
) {
  const conflicts: StoredConflict[] = [];
  for (const table of tables()) {
    const rows = yield* Effect.promise(() =>
      db.all<{
        entity: string;
        id: string;
        live_version: number | null;
        published_at: number | null;
        published_by: string | null;
      }>(conflictsIn(table, scope.id)),
    );
    for (const row of rows) {
      conflicts.push({
        entity: row.entity,
        id: row.id,
        liveVersion: row.live_version,
        publishedAt: row.published_at,
        publishedBy: row.published_by,
      });
    }
  }
  return conflicts;
});

export type StoredLoss =
  | { reason: "parentGone"; entity: string; id: string }
  | {
      reason: "writtenAfterDeletion";
      entity: string;
      id: string;
      parent: { entity: string; id: string };
    };

/**
 * The changes publishing drops: entities the draft changed whose parent exists neither in Live
 * nor in the draft, and Live entities published under a parent after the draft deleted it.
 */
export const lostOf = Effect.fn("overlay.lostOf")(function* (
  db: Database,
  scope: NonNullable<DraftScope>,
) {
  const lost: StoredLoss[] = [];
  for (const table of tables()) {
    const { entity, parents } = registrationOf(table);
    const t = sql.identifier(getTableName(table));
    const orphans = yield* Effect.promise(() =>
      db.all<{ id: string }>(sql`select ${at("d", table.id)} as "id" from ${t} as "d"
        where ${at("d", table.draftId)} = ${scope.id} and ${at("d", table.deleted)} = 0
          and not (${parentsExist(table, "d", scope.id)})`),
    );
    for (const { id } of orphans) lost.push({ reason: "parentGone", entity, id });

    for (const relation of parents) {
      const parentTable = registeredTableOf(relation.key);
      if (!parentTable) continue;
      const { column, key, within = [] } = relation;
      const matches = [
        sql`${at("tomb", key)} = ${at("x", column)}`,
        ...within.map(([child, parent]) => sql`${at("tomb", parent)} = ${at("x", child)}`),
      ];
      const rows = yield* Effect.promise(() =>
        db.all<{ id: string; parent_id: string }>(sql`
          select ${at("x", table.id)} as "id", ${at("tomb", parentTable.id)} as "parent_id"
          from ${t} as "x"
          join ${sql.identifier(getTableName(parentTable))} as "tomb" on ${sql.join(matches, sql` and `)}
          where ${at("x", table.draftId)} is null
            and ${at("tomb", parentTable.draftId)} = ${scope.id}
            and ${at("tomb", parentTable.deleted)} = 1
            and max(${at("x", table.updatedAt)}, coalesce(${at("x", table.publishedAt)}, 0))
              >= ${at("tomb", parentTable.updatedAt)}`),
      );
      for (const row of rows) {
        lost.push({
          reason: "writtenAfterDeletion",
          entity,
          id: row.id,
          parent: { entity: registrationOf(parentTable).entity, id: row.parent_id },
        });
      }
    }
  }
  return lost;
});

/**
 * The batch's first statement: it aborts the batch unless the draft still exists and its
 * conflicts are exactly `shown`, with the same Live versions. `json()` of invalid JSON is the
 * error that aborts it.
 */
function guardStatement(draftId: string, shown: ConflictKey[]): BatchItem {
  const current = () =>
    sql.join(
      tables().map((table) => conflictsIn(table, draftId)),
      sql` union all `,
    );
  const shownJson = JSON.stringify(shown);
  return sql`select case when
      exists (select 1 from ${drafts} where ${drafts.id} = ${draftId})
      and (select count(*) from (${current()})) = json_array_length(${shownJson})
      and not exists (
        select 1 from json_each(${shownJson}) as "shown" where not exists (
          select 1 from (${current()}) as "current"
          where "current"."entity" = json_extract("shown"."value", '$[0]')
            and "current"."id" = json_extract("shown"."value", '$[1]')
            and "current"."live_version" is json_extract("shown"."value", '$[2]')))
    then 1 else json('the draft or its conflicts changed') end`;
}

/** The columns publishing copies from a draft row onto Live. */
function copiedColumns(table: ContentTable) {
  const skipped = new Set<string>(bookkeeping);
  return Object.entries(getTableColumns(table))
    .filter(([key]) => !skipped.has(key))
    .map(([, column]) => column as AnySQLiteColumn);
}

/** Statements applying one table's rows from a draft onto Live. */
function applyStatements(
  table: ContentTable,
  draftId: string,
  publishedBy: string,
  now: number,
): BatchItem[] {
  const t = sql.identifier(getTableName(table));
  const columns = copiedColumns(table);
  const d = (column: AnySQLiteColumn) => at("d", column);
  const live = (column: AnySQLiteColumn) => sql`${t}.${ident(column)}`;
  const applied = () =>
    sql`${d(table.draftId)} = ${draftId} and ${d(table.deleted)} = 0 and ${parentsExist(table, "d", draftId)}`;
  const tombstones = () =>
    sql`select ${d(table.id)} from ${t} as "d" where ${d(table.draftId)} = ${draftId} and ${d(table.deleted)} = 1`;

  return [
    // Copies the draft's version over the Live entities it changed.
    sql`update ${t} set
        ${sql.join(
          columns.map((column) => sql`${ident(column)} = ${d(column)}`),
          sql`, `,
        )},
        ${ident(table.version)} = ${live(table.version)} + 1,
        ${ident(table.publishedAt)} = ${now},
        ${ident(table.publishedBy)} = ${publishedBy},
        ${ident(table.firstPublishedAt)} = coalesce(${live(table.firstPublishedAt)}, ${now})
      from ${t} as "d"
      where ${applied()} and ${live(table.draftId)} is null and ${live(table.id)} = ${d(table.id)}`,
    // Adds what the draft created, and brings back what Live deleted after the draft copied it.
    sql`insert into ${t} (
        ${sql.join(columns.map(ident), sql`, `)},
        ${ident(table.id)}, ${ident(table.draftId)}, ${ident(table.version)},
        ${ident(table.baseVersion)}, ${ident(table.deleted)}, ${ident(table.firstPublishedAt)},
        ${ident(table.publishedAt)}, ${ident(table.publishedBy)})
      select ${sql.join(columns.map(d), sql`, `)},
        ${d(table.id)}, null, coalesce(${d(table.baseVersion)}, 0) + 1, null, 0,
        coalesce(${d(table.firstPublishedAt)}, ${now}), ${now}, ${publishedBy}
      from ${t} as "d"
      where ${applied()} and not exists (
        select 1 from ${t} as "l" where ${at("l", table.draftId)} is null and ${at("l", table.id)} = ${d(table.id)})`,
    // Deletes what the draft deleted.
    sql`delete from ${t} where ${live(table.draftId)} is null and ${live(table.id)} in (${tombstones()})`,
  ];
}

/**
 * A statement deleting one table's Live descendants of what is gone: Live entities whose parent
 * nothing holds any more, neither Live nor any draft, and, through a parent in the same table,
 * their descendants too. A parent a draft still holds keeps its Live descendants for that
 * draft. Run after the parents' own tables.
 */
function descendantsStatement(table: ContentTable): BatchItem | undefined {
  const { parents } = registrationOf(table);
  if (parents.length === 0) return undefined;
  const t = sql.identifier(getTableName(table));
  const orphaned = parents.map(
    (relation) =>
      sql`(${at("x", relation.column)} is not null and not ${parentRowMatches(relation, "x", "anywhere")})`,
  );
  const selfColumns = parents
    .filter((relation) => registeredTableOf(relation.key) === table && !relation.within?.length)
    .map((relation) => relation.column);
  const recursive = selfColumns.map(
    (column) => sql`union
      select ${at("c", table.id)} from ${t} as "c" join "doomed" on ${at("c", column)} = "doomed"."id"
      where ${at("c", table.draftId)} is null and not exists (
        select 1 from ${t} as "h" where ${at("h", table.id)} = ${at("c", column)}
          and ${at("h", table.draftId)} is not null and ${at("h", table.deleted)} = 0)`,
  );
  return sql`delete from ${t} where ${t}.${ident(table.draftId)} is null and ${t}.${ident(table.id)} in (
    with recursive "doomed"("id") as (
      select ${at("x", table.id)} from ${t} as "x"
      where ${at("x", table.draftId)} is null and (${sql.join(orphaned, sql` or `)})
      ${sql.join(recursive, sql` `)}
    ) select "id" from "doomed")`;
}

/**
 * Statements for one table's Live-only dependents: rows pointing at an entity that nothing holds
 * any more, neither Live nor any draft, are deleted or have their pointer cleared.
 */
function dependentStatements(table: ContentTable): BatchItem[] {
  const t = sql.identifier(getTableName(table));
  return registrationOf(table).dependents.map(({ onDelete, column }) => {
    const pointer = sql`${tableOf(column)}.${ident(column)}`;
    const unheld = sql`${pointer} is not null and not exists (select 1 from ${t} as "h" where ${at("h", table.id)} = ${pointer} and ${at("h", table.deleted)} = 0)`;
    return onDelete === "delete"
      ? sql`delete from ${tableOf(column)} where ${unheld}`
      : sql`update ${tableOf(column)} set ${ident(column)} = null where ${unheld}`;
  });
}

/** Statements deleting every row a draft stores, keeping the draft. */
function emptyStatements(db: Database, draftId: string): BatchItem[] {
  return tables().map((table) => db.delete(table as SQLiteTable).where(eq(table.draftId, draftId)));
}

/**
 * Statements ending a draft: a regular draft is deleted, its rows with it, and leaves its
 * ended-drafts record; a development draft is emptied and stays (ADR 0006).
 */
function endStatements(
  db: Database,
  scope: NonNullable<DraftScope>,
  outcome: DraftOutcome,
  endedBy: string,
  now: number,
): BatchItem[] {
  if (scope.kind === "development") return emptyStatements(db, scope.id);
  return [
    // The primary key fails the batch when a concurrent publish or discard ended it first.
    db.insert(endedDrafts).values({
      id: scope.id,
      projectId: scope.projectId,
      outcome,
      endedBy,
      endedAt: now,
    }),
    db.delete(drafts).where(eq(drafts.id, scope.id)),
  ];
}

/**
 * Publishes a draft in one batch: a guard that aborts unless the conflicts are still `shown`,
 * then each table's draft rows applied to Live (bumping versions and setting who published and
 * when), deletions with their Live descendants and dependents, lost changes dropped, and the
 * draft ended.
 * Fails when the batch aborted, having applied nothing.
 */
export const publish = (
  db: Database,
  scope: NonNullable<DraftScope>,
  {
    shown,
    publishedBy,
    now,
    alongside = [],
  }: {
    shown: ConflictKey[];
    publishedBy: string;
    now: number;
    /** Statements of other domains, run after the guard and before any row is applied. */
    alongside?: BatchItem[];
  },
) => {
  const statements = [
    guardStatement(scope.id, shown),
    ...alongside,
    ...tables().flatMap((table) => applyStatements(table, scope.id, publishedBy, now)),
    ...tables().flatMap((table) => descendantsStatement(table) ?? []),
    ...tables().flatMap(dependentStatements),
    ...endStatements(db, scope, "published", publishedBy, now),
  ];
  return Effect.tryPromise(() => runBatch(db, statements));
};

/** Discards a draft in one batch: one cascading delete, or emptying a development draft. */
export const discard = (
  db: Database,
  scope: NonNullable<DraftScope>,
  {
    discardedBy,
    now,
    alongside = [],
  }: { discardedBy: string; now: number; alongside?: BatchItem[] },
) => {
  const statements = [...alongside, ...endStatements(db, scope, "discarded", discardedBy, now)];
  return Effect.tryPromise(() => runBatch(db, statements));
};
