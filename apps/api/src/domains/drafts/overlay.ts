import type { DraftOutcome } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
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
import {
  bumpsForBlocks,
  bumpsForRepeatableItems,
  bumpsForSharedContents,
} from "../../lib/bump-content-updated-at";
import { record, type Change } from "../../lib/journal";
import { blocks, sharedContents } from "../blocks/schema";
import { collectionRecords } from "../collections/schema";
import { files } from "../files/schema";
import { layouts } from "../layouts/schema";
import { locales } from "../locales/schema";
import { pages } from "../pages/schema";
import { repeatableItems } from "../repeatable-items/schema";
import { localizationExclusions } from "../translations/schema";
import { drafts, endedDrafts } from "./schema";
import {
  draftIn,
  draftOf,
  readScopeOf,
  RELEASE,
  type Draft,
  type DraftScope,
  type ReadScope,
  type WriteTarget,
} from "./scope";

// The draft overlay (ADR 0005) owns every draft-aware data operation on content tables, so
// domain services never filter on `draft_id` themselves. Live rows have no draft; a draft row
// is the draft's copy of an entity, an entity the draft created, or a tombstone.
//
// - A read in a draft takes the draft's row where there is one and Live's otherwise, minus
//   tombstones.
// - The first write in a draft copies the whole Live entity and records its version as
//   `base_version`. Later writes patch the copy; the last write wins.
// - A delete in a draft writes a tombstone for the entity only.
//
// Writes target a draft, or Live for a release. Publishing a draft and releases are Live's only
// writers (ADR 0006, ADR 0009), and both run each table's Live follow-ups.
//
// Localized tables, every content table but files and locales, store each entity once per
// locale (ADR 0015): an entity is its id and its locale on Live, and its draft, id and locale in
// a draft. The overlay matches on the locale wherever it matches on the id. Reads and writes act
// in the locale their scope names, or in the project's default locale; publishing, discarding,
// changes, conflicts and lost changes span every locale.

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
/**
 * The overlay's own bookkeeping columns, which publishing sets rather than copies. A localized
 * table's `locale` is part of the entity's identity, which no write changes.
 */
const bookkeeping = [
  "rowId",
  "id",
  "locale",
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

/** The kinds of entity drafts hold: what changes, conflicts and publish tokens name. */
export const ENTITY_KINDS = [
  "locale",
  "page",
  "block",
  "sharedContent",
  "repeatableItem",
  "file",
  "record",
  "exclusion",
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export type ContentTableRegistration = {
  /** What the entity is called in changes, conflicts and publish tokens. */
  entity: EntityKind;
  /**
   * The columns naming the entity's parent. A change whose parent is gone is lost, and
   * publishing deletes Live entities whose parent nothing holds any more: descendants of what
   * the draft deleted.
   */
  parents: ParentRelation[];
  /**
   * Columns only Live's writers maintain, which publishing keeps on a Live entity rather than
   * overwriting with the draft's copy.
   */
  liveColumns?: AnySQLiteColumn[];
  /**
   * Statements keeping Live in step after Live's writers change some of the table's entities.
   * `changed` selects rows describing them, as they were or as they are; the statements run
   * both before and after the change, so they must be idempotent.
   */
  afterLiveChange?: (changed: SQL, now: number) => SQL[];
  /** The table's rows in a project, Live's and every draft's, as a condition on the table. */
  inProject: (projectId: number) => SQL;
  /** The project a row belongs to, as an expression on the table's own columns. */
  project: SQL | AnySQLiteColumn;
};

const registrations = new Map<ContentTable, ContentTableRegistration>();

/**
 * Declares a content table to the overlay. Only registered tables can be read or written.
 * Register parents before their children: publishing deletes descendants in this order.
 */
export function registerContentTable(table: ContentTable, registration: ContentTableRegistration) {
  registrations.set(table, registration);
}

/** The registered content table holding an entity kind. */
export function contentTableOf(entity: EntityKind): ContentTable {
  for (const [table, registration] of registrations) {
    if (registration.entity === entity) return table;
  }
  throw new Error(`No content table holds ${entity} entities.`);
}

/** A registered content table's declaration. */
export function registrationOf(table: ContentTable): ContentTableRegistration {
  const registration = registrations.get(table);
  if (!registration) throw new Error("This table isn't registered with the draft overlay.");
  return registration;
}

// A locale has no parent. Content names its locale by tag: the locale is the parent of every
// page, block, shared content and record in it, so removing a locale takes its content with it
// (ADR 0015). Items follow their block or shared content.
registerContentTable(locales, {
  entity: "locale",
  parents: [],
  inProject: (projectId) => eq(locales.projectId, projectId),
  project: locales.projectId,
});

registerContentTable(pages, {
  entity: "page",
  parents: [
    { column: pages.parentPageId, key: pages.id },
    {
      column: pages.locale,
      key: locales.tag,
      within: [[pages.projectId, locales.projectId]],
    },
  ],
  // Bumped by Live's writers whenever the page's blocks change on Live.
  liveColumns: [pages.contentUpdatedAt],
  inProject: (projectId) => eq(pages.projectId, projectId),
  project: pages.projectId,
});

registerContentTable(blocks, {
  entity: "block",
  parents: [
    { column: blocks.pageId, key: pages.id },
    {
      column: blocks.layoutId,
      key: layouts.layoutId,
      within: [[blocks.projectId, layouts.projectId]],
    },
    {
      column: blocks.locale,
      key: locales.tag,
      within: [[blocks.projectId, locales.projectId]],
    },
  ],
  afterLiveChange: bumpsForBlocks,
  inProject: (projectId) => eq(blocks.projectId, projectId),
  project: blocks.projectId,
});

registerContentTable(sharedContents, {
  entity: "sharedContent",
  parents: [
    {
      column: sharedContents.locale,
      key: locales.tag,
      within: [[sharedContents.projectId, locales.projectId]],
    },
  ],
  afterLiveChange: bumpsForSharedContents,
  inProject: (projectId) => eq(sharedContents.projectId, projectId),
  project: sharedContents.projectId,
});

registerContentTable(repeatableItems, {
  entity: "repeatableItem",
  parents: [
    { column: repeatableItems.blockId, key: blocks.id },
    { column: repeatableItems.parentItemId, key: repeatableItems.id },
    {
      column: repeatableItems.sharedContentType,
      key: sharedContents.type,
      within: [[repeatableItems.projectId, sharedContents.projectId]],
    },
  ],
  afterLiveChange: bumpsForRepeatableItems,
  // An item's tree is rooted in a shared content of the project, or in a block.
  inProject: (projectId) =>
    sql`(${repeatableItems.projectId} = ${projectId} or ${repeatableItems.blockId} in (select "owner"."id" from ${blocks} as "owner" where "owner"."project_id" = ${projectId}))`,
  // Every row of a block belongs to the same project, whichever scope stores it.
  project: sql`coalesce(${repeatableItems.projectId}, (select "owner"."project_id" from ${blocks} as "owner" where "owner"."id" = ${repeatableItems.blockId} limit 1))`,
});

// A file belongs to its project only; content points at it by `_fileId`, which publishing checks.
registerContentTable(files, {
  entity: "file",
  parents: [],
  inProject: (projectId) => eq(files.projectId, projectId),
  project: files.projectId,
});

// A record names its collection, a definition, which no draft deletes: its only parent is its
// locale. Records of a removed collection stay stored, hidden (ADR 0007).
registerContentTable(collectionRecords, {
  entity: "record",
  parents: [
    {
      column: collectionRecords.locale,
      key: locales.tag,
      within: [[collectionRecords.projectId, locales.projectId]],
    },
  ],
  inProject: (projectId) => eq(collectionRecords.projectId, projectId),
  project: collectionRecords.projectId,
});

// An exclusion names the locale a localization was deleted from: removing the locale takes its
// exclusions with it. It names its entity by id only: ids are never reused (ADR 0004).
registerContentTable(localizationExclusions, {
  entity: "exclusion",
  parents: [
    {
      column: localizationExclusions.locale,
      key: locales.tag,
      within: [[localizationExclusions.projectId, locales.projectId]],
    },
  ],
  inProject: (projectId) => eq(localizationExclusions.projectId, projectId),
  project: localizationExclusions.projectId,
});

/** A localized table's `locale` column; files and locales have none. */
function localeColumn(table: ContentTable): AnySQLiteColumn | undefined {
  return (getTableColumns(table) as Record<string, AnySQLiteColumn | undefined>).locale;
}

/**
 * The default locale's tag in a project, as a scalar subquery: Live's, or as a draft reads its
 * locales.
 */
function defaultLocaleOf(project: SQL | AnySQLiteColumn | number, draft: Draft | null): SQL {
  return sql`(select ${locales.tag} from ${locales} where ${locales.projectId} = ${project} and ${locales.isDefault} = 1 and ${visibleIn(locales, draft)})`;
}

/**
 * The tag of the locale a scope reads and writes, as a value for rows of `table` in a query on
 * the table itself: the locale the scope names, or its project's default locale. Live naming no
 * locale reads each row's project's default locale.
 */
function localeOf(table: ContentTable, scope: ReadScope): SQL {
  if (scope?.locale !== undefined) return sql`${scope.locale}`;
  const draft = draftIn(scope);
  return defaultLocaleOf(draft ? draft.projectId : registrationOf(table).project, draft);
}

/** The rows of a localized table in the locale a scope reads; undefined for other tables. */
function inLocaleOf(table: ContentTable, scope: ReadScope): SQL | undefined {
  const column = localeColumn(table);
  return column ? sql`${column} = ${localeOf(table, scope)}` : undefined;
}

/**
 * Conditions that rows at two aliases are in the same locale: one when both tables are
 * localized, none otherwise.
 */
function sameLocale(
  a: { alias: string; table: ContentTable | undefined },
  b: { alias: string; table: ContentTable | undefined },
): SQL[] {
  const left = a.table && localeColumn(a.table);
  const right = b.table && localeColumn(b.table);
  return left && right ? [sql`${at(a.alias, left)} = ${at(b.alias, right)}`] : [];
}

/** Conditions that rows of one table at two aliases are the same entity: id and locale. */
function sameEntity(table: ContentTable, a: string, b: string): SQL {
  return sql.join(
    [
      sql`${at(a, table.id)} = ${at(b, table.id)}`,
      ...sameLocale({ alias: a, table }, { alias: b, table }),
    ],
    sql` and `,
  );
}

/** The columns identifying a row at an alias, for a select list: its id, and its locale. */
function keyColumns(alias: string, table: ContentTable): SQL {
  const locale = localeColumn(table);
  return locale ? sql`${at(alias, table.id)}, ${at(alias, locale)}` : at(alias, table.id);
}

/** What identifies a row at an alias, as a value to match with `in`: its id, or a row value. */
function keyAt(alias: string, table: ContentTable): SQL {
  return localeColumn(table) ? sql`(${keyColumns(alias, table)})` : at(alias, table.id);
}

/** A row's locale at an alias, or null for a table without locales. */
function localeAt(alias: string, table: ContentTable): SQL {
  const column = localeColumn(table);
  return column ? at(alias, column) : sql`null`;
}

/**
 * The rows stored in a scope itself, in every locale: Live's rows, or one draft's rows including
 * tombstones.
 */
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
export function storesAnything(scope: Pick<Draft, "id">): SQL {
  const stored = [...registrations.keys()].map(
    (table) => sql`exists (select 1 from ${table} where ${table.draftId} = ${scope.id})`,
  );
  return or(...stored)!;
}

/**
 * The rows a scope reads, as a condition usable in any query on the table: Live's rows, or a
 * draft's own rows plus the Live rows it hasn't copied, minus its tombstones. In a localized
 * table, only the rows in the scope's locale.
 */
export function visibleIn(table: ContentTable, scope: ReadScope): SQL {
  registrationOf(table);
  const locale = inLocaleOf(table, scope);
  const draft = draftIn(scope);
  if (!draft) return and(isNull(table.draftId), locale)!;
  const column = localeColumn(table);
  const copiedLocale = column ? sql` and "draft_row".${ident(column)} = ${column}` : sql``;
  const copied = sql`exists (select 1 from ${table} as "draft_row" where "draft_row"."draft_id" = ${draft.id} and "draft_row"."id" = ${table.id}${copiedLocale})`;
  return and(
    eq(table.deleted, false),
    sql`(${table.draftId} = ${draft.id} or (${table.draftId} is null and not ${copied}))`,
    locale,
  )!;
}

/** The rows a scope reads, matching an optional condition. */
export const select = Effect.fn("overlay.select")(function* <T extends ContentTable>(
  db: Database,
  scope: ReadScope,
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
  scope: ReadScope,
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
 * The row a scope itself stores for an entity in its locale, tombstone included: unlike `get`, a
 * draft finds no row for an entity it reads from Live.
 */
export const getStored = <T extends ContentTable>(
  db: Database,
  scope: ReadScope,
  table: T,
  id: string,
) => storedRow(db, draftIn(scope), scope, table, id);

/** The row `stored` stores for an entity, in the locale `localeScope` reads. */
const storedRow = <T extends ContentTable>(
  db: Database,
  stored: DraftScope,
  localeScope: ReadScope,
  table: T,
  id: string,
) =>
  Effect.promise(
    () =>
      db
        .select()
        .from(table as SQLiteTable)
        .where(and(storedIn(table, stored), eq(table.id, id), inLocaleOf(table, localeScope)))
        .get() as Promise<Row<T> | undefined>,
  );

/** The Live row a draft reads for an entity it doesn't store, in the draft's locale. */
export const liveRowFor = <T extends ContentTable>(
  db: Database,
  draft: Draft,
  table: T,
  id: string,
) => storedRow(db, null, draft, table, id);

/**
 * The statements running a table's Live follow-ups for one Live entity, as it is when they run:
 * planned before a release changes it, and again after.
 */
function liveFollowUps(table: ContentTable, id: string): BatchItem[] {
  const { afterLiveChange } = registrationOf(table);
  if (!afterLiveChange) return [];
  // A release writes in the default locale.
  const changed = sql`select * from ${table} where ${and(storedIn(table, null), eq(table.id, id), inLocaleOf(table, null))}`;
  return afterLiveChange(changed, Date.now());
}

/** The project a Live row belongs to: its own, or for an item, its block's. */
const projectOfLive = Effect.fn("overlay.projectOfLive")(function* (
  db: Database,
  row: Record<string, unknown>,
) {
  if (typeof row.projectId === "number") return row.projectId;
  if (typeof row.blockId !== "string") return undefined;
  const block = yield* getStored(db, null, blocks, row.blockId);
  return block?.projectId;
});

/**
 * The project a written entity belongs to: the draft's, or for a release, the one `projectId`
 * names, else the Live row's own. Undefined for a Live item whose block is gone.
 */
const projectOfWrite = (
  db: Database,
  target: WriteTarget,
  row: Record<string, unknown>,
  projectId?: number,
): Effect.Effect<number | undefined> => {
  if (target !== RELEASE) return Effect.succeed(target.projectId);
  if (projectId !== undefined) return Effect.succeed(projectId);
  return projectOfLive(db, row);
};

/**
 * What the journal records for a write: the entity as written, or as it was before its deletion.
 * Every overlay write records itself, so that what changed reaches the project's viewers.
 */
function contentChanges(
  target: WriteTarget,
  projectId: number | undefined,
  table: ContentTable,
  written: object,
  change: Extract<Change, { kind: "content" }>["change"],
  columns?: string[],
): Change[] {
  // A Live item whose block is gone shows nowhere: no project's viewers read it.
  if (projectId === undefined) return [];
  const row = written as Record<string, unknown> & { id: string };
  const { entity } = registrationOf(table);
  const draftId = target === RELEASE ? null : target.id;
  const changes: Change[] = [
    { kind: "content", entity, id: row.id, projectId, draftId, change, row, columns },
  ];
  // Every write of a localized entity, whatever wrote it: one in the default locale is
  // translated into the draft's other locales, or a release's into Live's (ADR 0015).
  if (typeof row.locale === "string") {
    changes.push({
      kind: "localizedWrite",
      entity,
      id: row.id,
      projectId,
      draftId,
      locale: row.locale,
    });
  }
  return changes;
}

/** Records a write in the journal, as `contentChanges` describes it. */
const journalWrite = Effect.fn("overlay.journalWrite")(function* (
  db: Database,
  target: WriteTarget,
  table: ContentTable,
  written: object,
  change: Extract<Change, { kind: "content" }>["change"],
) {
  const projectId = yield* projectOfWrite(db, target, written as Record<string, unknown>);
  for (const entry of contentChanges(target, projectId, table, written, change)) {
    yield* record(db, entry);
  }
});

// --- Planned writes ---
//
// A write is planned before it runs: its reads happen while planning, and it comes out as the
// statements to run, what the journal records once they ran, and what the write returns. Ids
// are picked while planning, so a later statement can name a row an earlier one creates.
// Running several planned writes as one batch makes them atomic, the way publishing is. Since
// no statement runs before the batch does, each write is planned from the state before the
// batch: a plan doesn't see its own writes. `insert`, `update` and `remove` plan one write and
// run it at once.

/** A write planned but not run yet. */
type Planned<A> = {
  /** The statements to run, in order, as one batch or as part of a larger one. */
  statements: BatchItem[];
  /** What the journal records once the statements ran. */
  changes: Change[];
  /** What the write returns, as planned: rows with the ids they get, but no `rowId`. */
  result: A;
};

/** A plan writing nothing. */
export const nothingPlanned = <A>(result: A): Planned<A> => ({
  statements: [],
  changes: [],
  result,
});

/** A plan of statements that write no content entity, so the journal records nothing for them. */
export const plannedStatements = (...statements: BatchItem[]): Planned<void> => ({
  statements,
  changes: [],
  result: undefined,
});

/**
 * Collects planned writes into one plan, in order: `add` takes a write's statements and changes
 * and returns its result, `done` closes the plan with its own result.
 */
export function planner() {
  const statements: BatchItem[] = [];
  const changes: Change[] = [];
  return {
    add<A>(planned: Planned<A>): A {
      statements.push(...planned.statements);
      changes.push(...planned.changes);
      return planned.result;
    },
    done<A>(result: A): Planned<A> {
      return { statements, changes, result };
    },
  };
}

/** Runs a plan's statements as one batch, then records its changes. Returns its result. */
export const runPlanned = Effect.fn("overlay.runPlanned")(function* <A>(
  db: Database,
  planned: Planned<A>,
) {
  if (planned.statements.length > 0) yield* runStatements(db, planned.statements);
  for (const change of planned.changes) yield* record(db, change);
  return planned.result;
});

/** The default locale's tag in a project, as Live or a draft reads its locales. */
const defaultLocaleTag = Effect.fn("overlay.defaultLocaleTag")(function* (
  db: Database,
  projectId: number,
  draft: Draft | null,
) {
  const row = yield* Effect.promise(() =>
    db
      .select({ tag: locales.tag })
      .from(locales)
      .where(
        and(
          eq(locales.projectId, projectId),
          eq(locales.isDefault, true),
          visibleIn(locales, draft),
        ),
      )
      .get(),
  );
  if (!row) return yield* Effect.die(new Error(`Project ${projectId} has no default locale.`));
  return row.tag;
});

/**
 * The locale a new entity of a localized table is created in, as insert values: the draft's
 * locale, or the default locale of the entity's project. Empty for other tables, and for a Live
 * item whose block is gone, which keeps the column's default.
 */
const localeOfWrite = Effect.fn("overlay.localeOfWrite")(function* (
  db: Database,
  target: WriteTarget,
  table: ContentTable,
  projectId: number | undefined,
): Effect.fn.Return<{ locale?: string }> {
  if (!localeColumn(table)) return {};
  if (target !== RELEASE) {
    return { locale: target.locale ?? (yield* defaultLocaleTag(db, target.projectId, target)) };
  }
  if (projectId === undefined) return {};
  return { locale: yield* defaultLocaleTag(db, projectId, null) };
});

/** The row a scope stores for an entity in a locale, tombstone included. */
const storedInLocale = <T extends ContentTable>(
  db: Database,
  stored: DraftScope,
  table: T,
  id: string,
  locale: string | null,
) => {
  const column = localeColumn(table);
  const inLocale = column && locale !== null ? eq(column, locale) : undefined;
  return Effect.promise(
    () =>
      db
        .select()
        .from(table as SQLiteTable)
        .where(and(storedIn(table, stored), eq(table.id, id), inLocale))
        .get() as Promise<Row<T> | undefined>,
  );
};

/** The row a planned write stores, read back once it ran. */
const storedAfter = <T extends ContentTable>(
  db: Database,
  target: WriteTarget,
  table: T,
  planned: Row<T>,
) => storedInLocale(db, readScopeOf(target), table, planned.id, localeOfRow(planned));

/**
 * Plans creating an entity in the target, in its locale, with a fresh id unless `values` names
 * one. Plans nothing, returning undefined, when the target already reads an entity with this id,
 * or a draft deleted it. A release's entity is published by no member, now. A release finds the
 * entity's project in its values, or for an item in its block: `projectId` names it when the
 * block is created in the same batch.
 */
export const planInsert = Effect.fn("overlay.planInsert")(function* <T extends ContentTable>(
  db: Database,
  target: WriteTarget,
  table: T,
  values: Patch<T> & { id?: string },
  options: { projectId?: number } = {},
) {
  const projectId = yield* projectOfWrite(db, target, values, options.projectId);
  const locale = yield* localeOfWrite(db, target, table, projectId);
  if (values.id !== undefined) {
    const tag = locale.locale ?? null;
    const stored = yield* storedInLocale(db, readScopeOf(target), table, values.id, tag);
    const live =
      target === RELEASE ? undefined : yield* storedInLocale(db, null, table, values.id, tag);
    if (stored || live) return nothingPlanned<Row<T> | undefined>(undefined);
  }
  const now = Date.now();
  const bookkept =
    target === RELEASE
      ? {
          draftId: null,
          baseVersion: null,
          deleted: false,
          firstPublishedAt: now,
          publishedAt: now,
          publishedBy: null,
        }
      : { draftId: target.id, baseVersion: null, deleted: false };
  const row = { ...values, id: values.id ?? generateUuidv7(), ...locale, ...bookkept };
  const statements: BatchItem[] = [
    db
      .insert(table as SQLiteTable)
      .values(row as Values<T>)
      .onConflictDoNothing(),
  ];
  if (target === RELEASE) statements.push(...liveFollowUps(table, row.id));
  const planned = { version: 1, ...row } as unknown as Row<T>;
  return {
    statements,
    changes: contentChanges(target, projectId, table, planned, "created"),
    result: planned as Row<T> | undefined,
  } satisfies Planned<Row<T> | undefined>;
});

/**
 * Creates an entity in the target, in its locale. Undefined when the target already reads an
 * entity with this id, or a draft deleted it. A release's entity is published by no member, now.
 */
export const insert = Effect.fn("overlay.insert")(function* <T extends ContentTable>(
  db: Database,
  target: WriteTarget,
  table: T,
  values: Patch<T> & { id?: string },
) {
  const planned = yield* planInsert(db, target, table, values);
  if (!planned.result) return undefined;
  yield* runPlanned(db, planned);
  return yield* storedAfter(db, target, table, planned.result);
});

/**
 * Plans changing an entity as the target reads it. A release counts a change on Live's
 * `version`, so drafts that copied the entity see a conflict. In a draft, the first write copies
 * the whole Live entity, recording the version it copied. Plans nothing, returning undefined,
 * when the target reads no entity with this id.
 */
export const planUpdate = Effect.fn("overlay.planUpdate")(function* <T extends ContentTable>(
  db: Database,
  target: WriteTarget,
  table: T,
  id: string,
  patch: Patch<T>,
) {
  const columns = Object.keys(patch);
  if (target === RELEASE) {
    const current = yield* getStored(db, null, table, id);
    if (!current) return nothingPlanned<Row<T> | undefined>(undefined);
    const now = Date.now();
    const statements: BatchItem[] = [
      ...liveFollowUps(table, id),
      db
        .update(table as SQLiteTable)
        .set({
          ...patch,
          version: sql`${table.version} + 1`,
          publishedAt: now,
          publishedBy: null,
        } as Partial<Values<T>>)
        .where(and(storedIn(table, null), eq(table.id, id), inLocaleOf(table, null))),
      ...liveFollowUps(table, id),
    ];
    const row = {
      ...current,
      ...patch,
      version: current.version + 1,
      publishedAt: now,
      publishedBy: null,
    } as Row<T>;
    const projectId = yield* projectOfLive(db, row);
    return {
      statements,
      changes: contentChanges(target, projectId, table, row, "changed", columns),
      result: row as Row<T> | undefined,
    } satisfies Planned<Row<T> | undefined>;
  }
  const stored = yield* getStored(db, target, table, id);
  if (stored?.deleted) return nothingPlanned<Row<T> | undefined>(undefined);
  const statements: BatchItem[] = [];
  let row: Row<T>;
  if (stored) {
    row = { ...stored, ...patch } as Row<T>;
  } else {
    const live = yield* liveRowFor(db, target, table, id);
    if (!live) return nothingPlanned<Row<T> | undefined>(undefined);
    const copy = copyIntoDraft(db, target, table, live, patch);
    statements.push(copy.statement);
    row = copy.row as Row<T>;
  }
  // Patches the draft's copy, also when a concurrent write copied it first.
  if (columns.length > 0) {
    statements.push(
      db
        .update(table as SQLiteTable)
        .set(patch as Partial<Values<T>>)
        .where(
          and(
            storedIn(table, target),
            eq(table.id, id),
            inLocaleOf(table, target),
            eq(table.deleted, false),
          ),
        ),
    );
  }
  return {
    statements,
    changes: contentChanges(target, target.projectId, table, row, "changed", columns),
    result: row as Row<T> | undefined,
  } satisfies Planned<Row<T> | undefined>;
});

/**
 * Changes an entity as the target reads it. A release counts a change on Live's `version`, so
 * drafts that copied the entity see a conflict. In a draft, the first write copies the whole Live
 * entity, recording the version it copied. Undefined when the target reads no entity with this
 * id.
 */
export const update = Effect.fn("overlay.update")(function* <T extends ContentTable>(
  db: Database,
  target: WriteTarget,
  table: T,
  id: string,
  patch: Patch<T>,
) {
  const planned = yield* planUpdate(db, target, table, id, patch);
  if (!planned.result) return undefined;
  yield* runPlanned(db, planned);
  return yield* storedAfter(db, target, table, planned.result);
});

/**
 * The statement copying a Live entity into a draft with changes applied, and the copy as
 * planned. A concurrent write that copied it first keeps its own copy.
 */
function copyIntoDraft<T extends ContentTable>(
  db: Database,
  draft: Draft,
  table: T,
  live: Row<T>,
  changes: Record<string, unknown>,
) {
  const { rowId: _rowId, ...entity } = live as Record<string, unknown>;
  const row = { ...entity, ...changes, draftId: draft.id, baseVersion: live.version };
  const statement = db
    .insert(table as SQLiteTable)
    .values(row as Values<T>)
    .onConflictDoNothing();
  return { statement, row };
}

/**
 * Plans deleting an entity as the target reads it, returning the row the target read. A release
 * deletes Live's row. In a draft, an entity the draft created is deleted and any other gets a
 * tombstone. Only the entity goes: callers remove its descendants. Plans nothing, returning
 * undefined, when the target reads no entity with this id.
 */
export const planRemove = Effect.fn("overlay.planRemove")(function* <T extends ContentTable>(
  db: Database,
  target: WriteTarget,
  table: T,
  id: string,
) {
  const shown = (yield* get(db, readScopeOf(target), table, id)) as Row<T> | undefined;
  if (!shown) return nothingPlanned<Row<T> | undefined>(undefined);
  const projectId = yield* projectOfWrite(db, target, shown);
  const planned = (statements: BatchItem[]) =>
    ({
      statements,
      changes: contentChanges(target, projectId, table, shown, "deleted"),
      result: shown as Row<T> | undefined,
    }) satisfies Planned<Row<T> | undefined>;
  if (target === RELEASE) {
    return planned([
      ...liveFollowUps(table, id),
      db
        .delete(table as SQLiteTable)
        .where(and(storedIn(table, null), eq(table.id, id), inLocaleOf(table, null))),
    ]);
  }
  const stored = and(storedIn(table, target), eq(table.id, id), inLocaleOf(table, target));
  if (shown.draftId === target.id && shown.baseVersion == null) {
    return planned([db.delete(table as SQLiteTable).where(stored)]);
  }
  const statements: BatchItem[] = [];
  if (shown.draftId !== target.id) {
    statements.push(copyIntoDraft(db, target, table, shown, { deleted: true }).statement);
  }
  // Marks the draft's copy, also when a concurrent write copied it first. The time tells Live
  // descendants written since, which publishing loses, from older ones.
  statements.push(
    db
      .update(table as SQLiteTable)
      .set({ deleted: true, updatedAt: Date.now() } as Partial<Values<T>>)
      .where(stored),
  );
  return planned(statements);
});

/**
 * Deletes an entity as the target reads it, returning the row the target read. A release deletes
 * Live's row. In a draft, an entity the draft created is deleted and any other gets a tombstone.
 * Only the entity goes: callers remove its descendants.
 */
export const remove = Effect.fn("overlay.remove")(function* <T extends ContentTable>(
  db: Database,
  target: WriteTarget,
  table: T,
  id: string,
) {
  return yield* runPlanned(db, yield* planRemove(db, target, table, id));
});

/**
 * Drops the row a draft stores for an entity, copy or tombstone, so the draft reads Live's again.
 * Returns the dropped row, or undefined when the draft stores none.
 */
export const revert = Effect.fn("overlay.revert")(function* <T extends ContentTable>(
  db: Database,
  draft: Draft,
  table: T,
  id: string,
) {
  const stored = yield* getStored(db, draft, table, id);
  if (!stored) return undefined;
  yield* Effect.promise(() =>
    db
      .delete(table as SQLiteTable)
      .where(and(storedIn(table, draft), eq(table.id, id), inLocaleOf(table, draft))),
  );
  const live = yield* liveRowFor(db, draft, table, id);
  yield* journalWrite(db, draft, table, live ?? stored, live ? "changed" : "deleted");
  return stored;
});

/**
 * Moves the copy a draft stores of an entity onto Live's version `liveVersion`, as if it had been
 * copied then: once a translation job merged a localization with Live's, it's no longer a
 * conflict (ADR 0016). A later Live change makes it one again.
 */
export const rebase = Effect.fn("overlay.rebase")(function* <T extends ContentTable>(
  db: Database,
  draft: Draft,
  table: T,
  id: string,
  liveVersion: number,
) {
  yield* Effect.promise(() =>
    db
      .update(table as SQLiteTable)
      .set({ baseVersion: liveVersion } as Partial<Values<T>>)
      .where(
        and(
          storedIn(table, draft),
          eq(table.id, id),
          inLocaleOf(table, draft),
          sql`${table.baseVersion} is not null`,
        ),
      ),
  );
});

// --- Locales (ADR 0015) ---
//
// A locale's content is every row of the localized tables naming its tag. These statements act
// on a whole locale at once, set-based, so a locale of any size is added or removed in one batch.

/** The registered tables storing an entity once per locale. */
const localizedTables = () => tables().filter((table) => localeColumn(table) !== undefined);

/**
 * Statements deleting every row a draft stores in a locale, copies, creations and tombstones:
 * the draft reads Live's content in that locale again, if Live has any.
 */
export function dropLocaleStatements(db: Database, draft: Draft, tag: string): BatchItem[] {
  return localizedTables().map((table) =>
    db
      .delete(table as SQLiteTable)
      .where(and(storedIn(table, draft), sql`${localeColumn(table)} = ${tag}`)),
  );
}

/**
 * Statements giving a draft a localization in locale `tag` of every entity it reads in its
 * default locale: a copy keeping its original's id (ADR 0015), which the draft creates. Run them
 * after dropping what the draft stores in that locale.
 */
export function localizeStatements(draft: Draft, tag: string, now: number): BatchItem[] {
  const source = draftOf(draft);
  // Nothing is excluded from the default locale.
  const localized = localizedTables().filter((table) => table !== localizationExclusions);
  return localized.map((table) => {
    const t = sql.identifier(getTableName(table));
    const columns = copiedColumns(table);
    const values = columns.map((column) =>
      column === table.updatedAt ? sql`${now}` : sql`${t}.${ident(column)}`,
    );
    return sql`insert into ${t} (
        ${sql.join(columns.map(ident), sql`, `)}, ${ident(table.id)}, ${ident(localeColumn(table)!)},
        ${ident(table.draftId)}, ${ident(table.baseVersion)}, ${ident(table.deleted)})
      select ${sql.join(values, sql`, `)}, ${t}.${ident(table.id)}, ${tag}, ${draft.id}, null, 0
      from ${t}
      where ${visibleIn(table, source)} and ${registrationOf(table).inProject(draft.projectId)}`;
  });
}

/**
 * Statements renaming a locale's tag everywhere in a project, on Live and in every draft: the
 * locale itself and every row naming it. Correcting the default locale's tag isn't a change to
 * content, so no draft holds it (ADR 0015).
 */
export function retagStatements(
  db: Database,
  projectId: number,
  from: string,
  to: string,
): BatchItem[] {
  return [
    db
      .update(locales)
      .set({ tag: to })
      .where(and(eq(locales.projectId, projectId), eq(locales.tag, from))),
    ...localizedTables().map((table) =>
      db
        .update(table as SQLiteTable)
        .set({ locale: to } as Partial<Values<ContentTable>>)
        .where(
          and(sql`${localeColumn(table)} = ${from}`, registrationOf(table).inProject(projectId)),
        ),
    ),
  ];
}

/** Runs statements as one batch, atomically. */
export const runStatements = (db: Database, statements: BatchItem[]) =>
  Effect.promise(() => runBatch(db, statements));

/**
 * Per registered entity, the entities Live holds, as a subquery: their ids, with their locales
 * for a localized entity.
 */
export function liveKeys(): { entity: EntityKind; keys: SQL; localized: boolean }[] {
  return tables().map((table) => ({
    entity: registrationOf(table).entity,
    keys: sql`select ${keyColumns("l", table)} from ${sql.identifier(getTableName(table))} as "l" where ${at("l", table.draftId)} is null`,
    localized: localeColumn(table) !== undefined,
  }));
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

/**
 * A conflict as shown to the caller and sent back to publish: entity, id, Live version, and the
 * locale for a localized entity.
 */
export type ConflictKey = [
  entity: EntityKind,
  id: string,
  liveVersion: number | null,
  locale: string | null,
];

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

/**
 * A draft's id in a query: bound as a parameter, or an expression reading it once bound, since D1
 * binds at most 100 parameters per statement.
 */
type DraftRef = string | SQL;

const registeredTableOf = (column: AnySQLiteColumn) =>
  tables().find((table) => getTableName(table) === getTableName(column.table));

/**
 * Where a row of the relation's parent table matches the entity at `alias`. A registered
 * parent counts when Live or the draft `draftId` holds it, tombstones aside, and the draft
 * didn't delete it; with `anywhere`,
 * when Live or any draft does.
 */
function parentRowMatches(
  relation: ParentRelation,
  alias: string,
  holder: { draftId: DraftRef } | "anywhere",
): SQL {
  const { column, key, within = [] } = relation;
  const matches = [
    sql`"parent".${ident(key)} = ${at(alias, column)}`,
    ...within.map(([child, parent]) => sql`"parent".${ident(parent)} = ${at(alias, child)}`),
  ];
  const parentTable = registeredTableOf(key);
  if (parentTable) {
    matches.push(sql`"parent".${ident(parentTable.deleted)} = 0`);
  }
  // A localization's parent is the parent's localization in the same locale.
  matches.push(
    ...sameLocale(
      { alias: "parent", table: parentTable },
      { alias, table: registeredTableOf(column) },
    ),
  );
  // A layout lives in Live and in development drafts (ADR 0006), like content: a draft holds
  // Live's layouts and its own.
  const draftColumn = parentTable?.draftId ?? getTableColumns(key.table).draftId;
  if (draftColumn && holder !== "anywhere") {
    matches.push(
      sql`("parent".${ident(draftColumn)} is null or "parent".${ident(draftColumn)} = ${holder.draftId})`,
    );
  }
  // Live's row doesn't hold a parent the draft deleted.
  if (parentTable && holder !== "anywhere") {
    matches.push(sql`not exists (select 1 from ${tableOf(key)} as "tomb"
      where ${at("tomb", parentTable.draftId)} = ${holder.draftId}
        and ${sameEntity(parentTable, "tomb", "parent")}
        and ${at("tomb", parentTable.deleted)} = 1)`);
  }
  return sql`exists (select 1 from ${tableOf(key)} as "parent" where ${sql.join(matches, sql` and `)})`;
}

/** Whether the entity at `alias` has every parent it names, in Live or in the draft. */
function parentsExist(table: ContentTable, alias: string, draftId: DraftRef): SQL {
  const checks = registrationOf(table).parents.map(
    (relation) =>
      sql`(${at(alias, relation.column)} is null or ${parentRowMatches(relation, alias, { draftId })})`,
  );
  return checks.length ? sql.join(checks, sql` and `) : sql`1`;
}

/** Registered tables whose entities can be a table's ancestors, then the table: parents first. */
function lineageOf(table: ContentTable): ContentTable[] {
  const lineage: ContentTable[] = [];
  const visit = (current: ContentTable) => {
    if (lineage.includes(current)) return;
    for (const { key } of registrationOf(current).parents) {
      const parentTable = registeredTableOf(key);
      if (parentTable && parentTable !== current) visit(parentTable);
    }
    lineage.push(current);
  };
  visit(table);
  return lineage;
}

const goneName = (table: ContentTable) => sql.identifier(`gone_${getTableName(table)}`);

/**
 * A recursive common table, `gone_<table>`, of a table's rows that a draft's deletions take
 * away: its tombstones, and Live rows whose parent is gone, recursively. Each row also has when
 * the deletion above it was drafted (`gone_at`) and which entity it deleted (`gone_entity`,
 * `gone_id`). Reads the common tables of the parents' tables.
 */
function goneTable(table: ContentTable, draftId: DraftRef): SQL {
  const { entity, parents } = registrationOf(table);
  const t = sql.identifier(getTableName(table));
  const underParent = (relation: ParentRelation, parentTable: ContentTable) => {
    const matches = [
      sql`"p".${ident(relation.key)} = ${at("x", relation.column)}`,
      ...(relation.within ?? []).map(
        ([child, parent]) => sql`"p".${ident(parent)} = ${at("x", child)}`,
      ),
      ...sameLocale({ alias: "p", table: parentTable }, { alias: "x", table }),
    ];
    return sql`select "x".*, "p"."gone_at", "p"."gone_entity", "p"."gone_id", "p"."gone_locale"
      from ${t} as "x" join ${goneName(parentTable)} as "p" on ${sql.join(matches, sql` and `)}
      where ${at("x", table.draftId)} is null`;
  };
  const related = parents.flatMap((relation) => {
    const parentTable = registeredTableOf(relation.key);
    return parentTable ? [{ relation, parentTable }] : [];
  });
  // The recursive terms, through a parent in the same table, come last.
  const ordered = [
    ...related.filter(({ parentTable }) => parentTable !== table),
    ...related.filter(({ parentTable }) => parentTable === table),
  ];
  const terms = [
    sql`select "x".*, ${at("x", table.updatedAt)} as "gone_at", ${entity} as "gone_entity",
        ${at("x", table.id)} as "gone_id", ${localeAt("x", table)} as "gone_locale"
      from ${t} as "x" where ${at("x", table.draftId)} = ${draftId} and ${at("x", table.deleted)} = 1`,
    ...ordered.map(({ relation, parentTable }) => underParent(relation, parentTable)),
  ];
  return sql`${goneName(table)} as (${sql.join(terms, sql` union `)})`;
}

/**
 * One table's Live descendants of what the draft deletes that were written or published after
 * the deletion was drafted, which publishing deletes. Those the draft stores itself are its own
 * changes, not descendants. Selects the descendant (`id`, `version`, `published_at`,
 * `published_by`) and the deleted entity above it (`gone_entity`, `gone_id`). Undefined for a
 * table without registered parents.
 */
function descendantsWrittenAfterDeletion(table: ContentTable, draftId: DraftRef): SQL | undefined {
  if (!registrationOf(table).parents.some((relation) => registeredTableOf(relation.key))) {
    return undefined;
  }
  const t = sql.identifier(getTableName(table));
  return sql`with recursive ${sql.join(
    lineageOf(table).map((member) => goneTable(member, draftId)),
    sql`, `,
  )}
    select "g"."id", ${localeAt("g", table)} as "locale", "g"."version", "g"."published_at",
      "g"."published_by", "g"."gone_entity", "g"."gone_id", "g"."gone_locale"
    from ${goneName(table)} as "g"
    where "g".${ident(table.draftId)} is null
      and max("g".${ident(table.updatedAt)}, coalesce("g".${ident(table.publishedAt)}, 0)) >= "g"."gone_at"
      and not exists (select 1 from ${t} as "h"
        where ${at("h", table.draftId)} = ${draftId} and ${sameEntity(table, "h", "g")})`;
}

/**
 * The draft's conflicts in one table: entities it copied or deleted whose Live version moved
 * past the copy's base, or that Live deleted, and Live descendants of what it deletes that were
 * published after the deletion was drafted. Lost changes, and deletions of what Live deleted
 * too, aren't conflicts.
 */
function conflictsIn(table: ContentTable, draftId: DraftRef): SQL {
  const { entity } = registrationOf(table);
  const t = sql.identifier(getTableName(table));
  const copied = sql`select ${entity} as "entity", ${at("d", table.id)} as "id",
      ${localeAt("d", table)} as "locale",
      ${at("l", table.version)} as "live_version",
      ${at("l", table.publishedAt)} as "published_at",
      ${at("l", table.publishedBy)} as "published_by"
    from ${t} as "d"
    left join ${t} as "l" on ${at("l", table.draftId)} is null and ${sameEntity(table, "l", "d")}
    where ${at("d", table.draftId)} = ${draftId}
      and ${at("d", table.baseVersion)} is not null
      and ${parentsExist(table, "d", draftId)}
      and ((${at("l", table.id)} is null and ${at("d", table.deleted)} = 0)
        or ${at("l", table.version)} != ${at("d", table.baseVersion)})`;
  const descendants = descendantsWrittenAfterDeletion(table, draftId);
  if (!descendants) return copied;
  // A descendant under several deleted entities is still one conflict.
  return sql`${copied}
    union all
    select distinct ${entity}, "w"."id", "w"."locale", "w"."version", "w"."published_at",
      "w"."published_by"
    from (${descendants}) as "w"`;
}

export type StoredChange = {
  table: ContentTable;
  entity: EntityKind;
  row: Row<ContentTable>;
  change: "created" | "changed" | "deleted";
};

/**
 * The tag of the locale a row is in (ADR 0015), or null for an entity stored once, like a file or
 * a locale.
 */
export const localeOfRow = (row: object): string | null =>
  "locale" in row && typeof row.locale === "string" ? row.locale : null;

/** Every entity a draft stores, as created, changed or deleted. */
export const changesOf = Effect.fn("overlay.changesOf")(function* (db: Database, scope: Draft) {
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
  entity: EntityKind;
  id: string;
  // A localized entity's locale, or null.
  locale: string | null;
  liveVersion: number | null;
  publishedAt: number | null;
  publishedBy: string | null;
};

/** The draft's conflicts, with who published Live's version and when. */
export const conflictsOf = Effect.fn("overlay.conflictsOf")(function* (db: Database, scope: Draft) {
  const conflicts: StoredConflict[] = [];
  for (const table of tables()) {
    const rows = yield* Effect.promise(() =>
      db.all<{
        entity: EntityKind;
        id: string;
        locale: string | null;
        live_version: number | null;
        published_at: number | null;
        published_by: string | null;
      }>(conflictsIn(table, scope.id)),
    );
    for (const row of rows) {
      conflicts.push({
        entity: row.entity,
        id: row.id,
        locale: row.locale,
        liveVersion: row.live_version,
        publishedAt: row.published_at,
        publishedBy: row.published_by,
      });
    }
  }
  return conflicts;
});

/** An entity a loss names: a localized entity with its locale, any other with null. */
type LostEntity = { entity: EntityKind; id: string; locale: string | null };

export type StoredLoss =
  | ({ reason: "parentGone" } & LostEntity)
  | ({ reason: "writtenAfterDeletion"; parent: LostEntity } & LostEntity);

/**
 * The changes publishing drops: entities the draft changed whose parent exists neither in Live
 * nor in the draft, and Live descendants written or published after the draft deleted an
 * entity above them (`parent`), which are conflicts too.
 */
export const lostOf = Effect.fn("overlay.lostOf")(function* (db: Database, scope: Draft) {
  const lost: StoredLoss[] = [];
  for (const table of tables()) {
    const { entity } = registrationOf(table);
    const t = sql.identifier(getTableName(table));
    const orphans = yield* Effect.promise(() =>
      db.all<{ id: string; locale: string | null }>(sql`select ${at("d", table.id)} as "id",
          ${localeAt("d", table)} as "locale"
        from ${t} as "d"
        where ${at("d", table.draftId)} = ${scope.id} and ${at("d", table.deleted)} = 0
          and not (${parentsExist(table, "d", scope.id)})`),
    );
    for (const { id, locale } of orphans) lost.push({ reason: "parentGone", entity, id, locale });

    const descendants = descendantsWrittenAfterDeletion(table, scope.id);
    if (!descendants) continue;
    const rows = yield* Effect.promise(() =>
      db.all<{
        id: string;
        locale: string | null;
        gone_entity: EntityKind;
        gone_id: string;
        gone_locale: string | null;
      }>(descendants),
    );
    // A descendant under several deleted entities is listed once.
    const listed = new Set<string>();
    for (const row of rows) {
      const key = JSON.stringify([row.id, row.locale]);
      if (listed.has(key)) continue;
      listed.add(key);
      lost.push({
        reason: "writtenAfterDeletion",
        entity,
        id: row.id,
        locale: row.locale,
        parent: { entity: row.gone_entity, id: row.gone_id, locale: row.gone_locale },
      });
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
  // The draft's id and the conflicts shown are bound once: every table's conflicts read them.
  const guarded = sql`(select "draft_id" from "guarded")`;
  const shownJson = sql`(select "shown" from "guarded")`;
  // Each table's conflicts are queried apart, never as one `union all`: D1 caps a compound
  // select at a few terms, fewer than there are registered tables.
  const count = sql.join(
    tables().map((table) => sql`(select count(*) from (${conflictsIn(table, guarded)}))`),
    sql` + `,
  );
  const matchesShown = sql.join(
    tables().map(
      (table) => sql`exists (
          select 1 from (${conflictsIn(table, guarded)}) as "current"
          where "current"."entity" = json_extract("shown"."value", '$[0]')
            and "current"."id" = json_extract("shown"."value", '$[1]')
            and "current"."live_version" is json_extract("shown"."value", '$[2]')
            and "current"."locale" is json_extract("shown"."value", '$[3]'))`,
    ),
    sql` or `,
  );
  return sql`with "guarded"("draft_id", "shown") as (select ${draftId}, ${JSON.stringify(shown)})
    select case when
      exists (select 1 from ${drafts} where ${drafts.id} = ${guarded})
      and ${count} = json_array_length(${shownJson})
      and not exists (
        select 1 from json_each(${shownJson}) as "shown" where not (${matchesShown}))
    then 1 else json('the draft or its conflicts changed') end`;
}

/** The columns publishing copies from a draft row onto Live. */
function copiedColumns(table: ContentTable) {
  const skipped = new Set<string>(bookkeeping);
  return Object.entries(getTableColumns(table))
    .filter(([key]) => !skipped.has(key))
    .map(([, column]) => column as AnySQLiteColumn);
}

/**
 * Statements running every table's Live follow-ups for what a draft changes: the draft's rows,
 * and the Live rows they replace or delete.
 */
function followUpStatements(draftId: string, now: number): BatchItem[] {
  return tables().flatMap((table) => {
    const { afterLiveChange } = registrationOf(table);
    if (!afterLiveChange) return [];
    const name = getTableName(table);
    const t = sql.identifier(name);
    const changed = sql`select * from ${t} where ${ident(table.draftId)} = ${draftId}
      union all
      select * from ${t} where ${ident(table.draftId)} is null and ${keyAt(name, table)} in (
        select ${keyColumns("d", table)} from ${t} as "d" where ${at("d", table.draftId)} = ${draftId})`;
    return afterLiveChange(changed, now);
  });
}

/** Statements applying one table's rows from a draft onto Live. */
function applyStatements(
  table: ContentTable,
  draftId: string,
  publishedBy: string,
  now: number,
): BatchItem[] {
  const name = getTableName(table);
  const t = sql.identifier(name);
  // A localized entity's locale is copied with its id: the rest of its identity.
  const locale = localeColumn(table);
  const identity = locale ? [table.id, locale] : [table.id];
  const columns = copiedColumns(table);
  const kept = new Set(registrationOf(table).liveColumns ?? []);
  const overwritten = columns.filter((column) => !kept.has(column));
  const d = (column: AnySQLiteColumn) => at("d", column);
  const live = (column: AnySQLiteColumn) => sql`${t}.${ident(column)}`;
  const applied = () =>
    sql`${d(table.draftId)} = ${draftId} and ${d(table.deleted)} = 0 and ${parentsExist(table, "d", draftId)}`;

  return [
    // Copies the draft's version over the Live entities it changed.
    sql`update ${t} set
        ${sql.join(
          overwritten.map((column) => sql`${ident(column)} = ${d(column)}`),
          sql`, `,
        )},
        ${ident(table.version)} = ${live(table.version)} + 1,
        ${ident(table.publishedAt)} = ${now},
        ${ident(table.publishedBy)} = ${publishedBy},
        ${ident(table.firstPublishedAt)} = coalesce(${live(table.firstPublishedAt)}, ${now})
      from ${t} as "d"
      where ${applied()} and ${live(table.draftId)} is null and ${sameEntity(table, name, "d")}`,
    // Adds what the draft created, and brings back what Live deleted after the draft copied it.
    sql`insert into ${t} (
        ${sql.join(columns.map(ident), sql`, `)},
        ${sql.join(identity.map(ident), sql`, `)}, ${ident(table.draftId)}, ${ident(table.version)},
        ${ident(table.baseVersion)}, ${ident(table.deleted)}, ${ident(table.firstPublishedAt)},
        ${ident(table.publishedAt)}, ${ident(table.publishedBy)})
      select ${sql.join(columns.map(d), sql`, `)},
        ${sql.join(identity.map(d), sql`, `)}, null, coalesce(${d(table.baseVersion)}, 0) + 1, null, 0,
        coalesce(${d(table.firstPublishedAt)}, ${now}), ${now}, ${publishedBy}
      from ${t} as "d"
      where ${applied()} and not exists (
        select 1 from ${t} as "l" where ${at("l", table.draftId)} is null and ${sameEntity(table, "l", "d")})`,
    // Deletes what the draft deleted.
    sql`delete from ${t} where ${live(table.draftId)} is null and ${keyAt(name, table)} in (
        select ${keyColumns("d", table)} from ${t} as "d"
        where ${d(table.draftId)} = ${draftId} and ${d(table.deleted)} = 1)`,
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
  const name = getTableName(table);
  const t = sql.identifier(name);
  const orphaned = parents.map(
    (relation) =>
      sql`(${at("x", relation.column)} is not null and not ${parentRowMatches(relation, "x", "anywhere")})`,
  );
  const selfColumns = parents
    .filter((relation) => registeredTableOf(relation.key) === table && !relation.within?.length)
    .map((relation) => relation.column);
  // A doomed entity's descendants in the same table are in its locale.
  const locale = localeColumn(table);
  const inDoomedLocale = (alias: string) =>
    locale ? sql` and ${at(alias, locale)} = "doomed"."locale"` : sql``;
  const recursive = selfColumns.map(
    (column) => sql`union
      select ${at("c", table.id)}, ${localeAt("c", table)} from ${t} as "c"
        join "doomed" on ${at("c", column)} = "doomed"."id"${inDoomedLocale("c")}
      where ${at("c", table.draftId)} is null and not exists (
        select 1 from ${t} as "h" where ${at("h", table.id)} = ${at("c", column)}
          ${locale ? sql`and ${at("h", locale)} = ${at("c", locale)}` : sql``}
          and ${at("h", table.draftId)} is not null and ${at("h", table.deleted)} = 0)`,
  );
  const doomedKey = locale ? sql`"id", "locale"` : sql`"id"`;
  return sql`delete from ${t} where ${t}.${ident(table.draftId)} is null and ${keyAt(name, table)} in (
    with recursive "doomed"("id", "locale") as (
      select ${at("x", table.id)}, ${localeAt("x", table)} from ${t} as "x"
      where ${at("x", table.draftId)} is null and (${sql.join(orphaned, sql` or `)})
      ${sql.join(recursive, sql` `)}
    ) select ${doomedKey} from "doomed")`;
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
  scope: Draft,
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
 * when), deletions with their Live descendants, lost changes dropped, and the draft ended. The
 * tables' Live follow-ups run before the draft is applied, for what it replaces, and after, for
 * what it adds.
 * Fails when the batch aborted, having applied nothing.
 */
export const publish = (
  db: Database,
  scope: Draft,
  {
    shown,
    publishedBy,
    now,
    after = [],
  }: {
    shown: ConflictKey[];
    publishedBy: string;
    now: number;
    /**
     * Statements of other domains, run once Live holds what the publish leaves, descendants
     * deleted and lost changes dropped, before the draft ends.
     */
    after?: BatchItem[];
  },
) => {
  const statements = [
    guardStatement(scope.id, shown),
    ...followUpStatements(scope.id, now),
    ...tables().flatMap((table) => applyStatements(table, scope.id, publishedBy, now)),
    ...tables().flatMap((table) => descendantsStatement(table) ?? []),
    ...followUpStatements(scope.id, now),
    ...after,
    ...endStatements(db, scope, "published", publishedBy, now),
  ];
  return endingBatch(db, scope, statements, "live");
};

/**
 * Runs a batch ending what a draft stores, then records each entity it stored as changed where
 * the batch changed it: Live for a publish, or for a discard the draft itself, when it stays as
 * a development draft does. A regular draft that ended has no readers left to refresh: they are
 * told it ended. Fails when the batch aborted, recording nothing.
 */
const endingBatch = Effect.fnUntraced(function* (
  db: Database,
  scope: Draft,
  statements: BatchItem[],
  changed: "live" | "draft",
) {
  const readersLeft = changed === "live" || scope.kind === "development";
  // Read before the batch drops the draft's rows.
  const stored = readersLeft ? yield* changesOf(db, scope) : [];
  yield* Effect.tryPromise(() => runBatch(db, statements));
  // The draft is gone from the drafts list, or listed empty.
  yield* record(db, { kind: "drafts", projectId: scope.projectId });
  for (const { table, row, change } of stored) {
    yield* record(db, {
      kind: "content",
      entity: registrationOf(table).entity,
      id: row.id,
      projectId: scope.projectId,
      draftId: changed === "live" ? null : scope.id,
      change,
      // As the draft had it: what Live holds now, or what the draft no longer shows.
      row,
    });
  }
});

/** Discards a draft in one batch: one cascading delete, or emptying a development draft. */
export const discard = (
  db: Database,
  scope: Draft,
  {
    discardedBy,
    now,
    alongside = [],
  }: { discardedBy: string; now: number; alongside?: BatchItem[] },
) => {
  const statements = [...alongside, ...endStatements(db, scope, "discarded", discardedBy, now)];
  return endingBatch(db, scope, statements, "draft");
};
