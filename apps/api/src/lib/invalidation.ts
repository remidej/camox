import { queryKeys, type ProjectRoomMessage, type QueryKey } from "@camox/api-contract/query-keys";
import { and, eq, type SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { Effect } from "effect";

import type { Database } from "../db";
import {
  contentTableOf,
  storedIn,
  storedInLiveOrDraft,
  type EntityKind,
} from "../domains/drafts/overlay";
import type { Change } from "./journal";

type ContentChange = Extract<Change, { kind: "content" }>;
import { projectRooms } from "./project-rooms";

// Turns a journal into the project rooms' messages (ADR 0011): which reads each change reaches,
// in the scope it was made in. This is the one place that knows which query keys a change
// refreshes. A change to an entity kind without a rule refreshes everything its scope reads.

type Row = Record<string, unknown>;

/** Past this many content changes in one scope, as when publishing, refresh broadly instead. */
const MANY_CHANGES = 40;

const prefixes = {
  blocks: ["camox", "blocks"],
  blockBundles: ["camox", "blocks", "get"],
  pageMarkdowns: ["camox", "blocks", "getPageMarkdown"],
  collections: ["camox", "collections"],
  files: ["camox", "files"],
  projects: ["camox", "projects"],
  everything: ["camox"],
} satisfies Record<string, QueryKey>;

/** What a scope's readers see after many changes: everything content-shaped. */
const broadly: QueryKey[] = [
  queryKeys.pages.getByPathAll,
  queryKeys.pages.list,
  queryKeys.layouts.all,
  prefixes.files,
  prefixes.blocks,
  prefixes.collections,
];

/** Every read showing a synced block's shared content: each of its placements, anywhere. */
const sharedContentReads = (type: string | undefined): QueryKey[] => [
  type === undefined ? queryKeys.blocks.getUsageCounts : queryKeys.blocks.getSyncedContent(type),
  queryKeys.pages.getByPathAll,
  queryKeys.pages.list,
  queryKeys.layouts.all,
  prefixes.blockBundles,
  prefixes.pageMarkdowns,
];

/** Reads a scope's rows, as written: the journal's own first, then the database's. */
function rowsIn(db: Database, changes: readonly Change[]) {
  const written = new Map<string, Row>();
  const keyOf = (entity: EntityKind, id: string, draftId: string | null) =>
    `${entity}:${draftId}:${id}`;
  for (const change of changes) {
    if (change.kind === "content" && change.row) {
      written.set(keyOf(change.entity, change.id, change.draftId), change.row);
    }
  }
  /**
   * The entity as the scope stores it, tombstone included, or as Live does; undefined when
   * neither has it, or when reading it failed.
   */
  return (entity: EntityKind, id: string, draftId: string | null) =>
    Effect.gen(function* () {
      const known = written.get(keyOf(entity, id, draftId));
      if (known) return known;
      const table = contentTableOf(entity);
      const where: SQL =
        draftId === null ? storedIn(table, null) : storedInLiveOrDraft(table, draftId);
      const rows = yield* Effect.tryPromise(
        () =>
          db
            .select()
            .from(table as SQLiteTable)
            .where(and(where, eq(table.id, id))) as Promise<Row[]>,
      ).pipe(Effect.orElseSucceed((): Row[] => []));
      return rows.find((row) => row.draftId !== null) ?? rows[0];
    });
}

type RowOf = ReturnType<typeof rowsIn>;

/** The reads showing an entity, in its scope. */
const readsOf = Effect.fn("invalidation.readsOf")(function* (
  rowOf: RowOf,
  entity: EntityKind,
  id: string,
  draftId: string | null,
  known: { row?: Row; columns?: string[]; change?: ContentChange["change"] } = {},
): Effect.fn.Return<QueryKey[]> {
  const row = known.row ?? (yield* rowOf(entity, id, draftId));
  switch (entity) {
    case "page": {
      // A changed page may have moved off the path it was read under, unless the change says
      // which columns it set: a publish doesn't.
      const moved = known.change === "changed" && (known.columns?.includes("fullPath") ?? true);
      const path = typeof row?.fullPath === "string" && !moved ? row.fullPath : null;
      return [
        queryKeys.pages.list,
        queryKeys.pages.getById(id),
        path === null ? queryKeys.pages.getByPathAll : queryKeys.pages.getByPath(path),
        queryKeys.blocks.getPageMarkdown(id),
        // The pages using each block definition.
        queryKeys.blocks.getUsageCounts,
      ];
    }
    case "block":
      return [
        queryKeys.blocks.get(id),
        ...(yield* placementReads(rowOf, row, draftId)),
        // A removed block restructures its page: refresh every page path, also those the browser
        // normalized differently from the stored path (such as a trailing slash).
        ...(known.change === "deleted" ? [queryKeys.pages.getByPathAll] : []),
      ];
    case "sharedContent":
      return sharedContentReads(typeof row?.type === "string" ? row.type : undefined);
    case "repeatableItem": {
      // An item shows wherever the root of its tree does.
      if (typeof row?.sharedContentType === "string") {
        return sharedContentReads(row.sharedContentType);
      }
      if (typeof row?.blockId !== "string") return [queryKeys.blocks.getUsageCounts, ...broadly];
      return yield* readsOf(rowOf, "block", row.blockId, draftId);
    }
    case "file":
      // A new file shows nowhere yet; a changed one shows in every placement of it.
      return [
        queryKeys.files.list,
        queryKeys.files.get(id),
        queryKeys.blocks.getUsageCounts,
        ...(known.change === "created"
          ? []
          : [queryKeys.pages.getByPathAll, prefixes.blockBundles]),
      ];
    case "record":
      // Every record list, reference and usage count can change with one record.
      return [
        prefixes.collections,
        prefixes.blocks,
        queryKeys.pages.getByPathAll,
        queryKeys.pages.list,
        queryKeys.layouts.all,
      ];
    default:
      return [prefixes.everything];
  }
});

/** The reads showing a block's placement: its page, or every page of its layout. */
const placementReads = Effect.fn("invalidation.placementReads")(function* (
  rowOf: RowOf,
  block: Row | undefined,
  draftId: string | null,
): Effect.fn.Return<QueryKey[]> {
  // Placing, moving or removing a block changes the usage counts.
  const shared = [queryKeys.pages.list, queryKeys.blocks.getUsageCounts];
  if (typeof block?.pageId === "string") {
    const page = yield* rowOf("page", block.pageId, draftId);
    return [
      ...shared,
      typeof page?.fullPath === "string"
        ? queryKeys.pages.getByPath(page.fullPath)
        : queryKeys.pages.getByPathAll,
      queryKeys.blocks.getPageMarkdown(block.pageId),
    ];
  }
  return [...shared, queryKeys.layouts.all, queryKeys.pages.getByPathAll];
});

/** The keys of a set that no shorter key of the set already covers, in order. */
function withoutCovered(keys: readonly QueryKey[]): QueryKey[] {
  const unique = [...new Map(keys.map((key) => [JSON.stringify(key), key])).values()];
  const covers = (prefix: QueryKey, key: QueryKey) =>
    prefix.length < key.length && prefix.every((part, index) => part === key[index]);
  return unique.filter((key) => !unique.some((other) => covers(other, key)));
}

/** The messages a project's room is sent for its changes, Live's after the drafts'. */
const messagesFor = Effect.fn("invalidation.messagesFor")(function* (
  rowOf: RowOf,
  changes: readonly Change[],
) {
  const targets = new Map<string | null, QueryKey[]>();
  const add = (draftId: string | null, ...keys: QueryKey[]) =>
    targets.set(draftId, [...(targets.get(draftId) ?? []), ...keys]);
  const ended: ProjectRoomMessage[] = [];

  const contentCount = new Map<string | null, number>();
  for (const change of changes) {
    if (change.kind !== "content") continue;
    contentCount.set(change.draftId, (contentCount.get(change.draftId) ?? 0) + 1);
  }
  const many = (draftId: string | null) => (contentCount.get(draftId) ?? 0) > MANY_CHANGES;
  const contentReads = (change: ContentChange) =>
    Effect.gen(function* () {
      const { entity, id, draftId, row, columns } = change;
      if (draftId === null) {
        // Live changed, by a publish or a release: what Live shows, a conflict in any draft, and
        // the latest publish. Derived layouts render Live pages under their own keys.
        const live = [queryKeys.drafts.all, queryKeys.layouts.all];
        if (many(null)) return [...broadly, ...live];
        return [
          ...(yield* readsOf(rowOf, entity, id, null, { row, change: change.change })),
          ...live,
        ];
      }
      if (many(draftId)) return broadly;
      return yield* readsOf(rowOf, entity, id, draftId, { row, columns, change: change.change });
    });

  for (const change of changes) {
    switch (change.kind) {
      case "content":
        add(change.draftId, ...(yield* contentReads(change)));
        // A draft's change count changes: in its own summary, and in everyone's list.
        if (change.draftId !== null) {
          add(change.draftId, queryKeys.drafts.get);
          add(null, queryKeys.drafts.list);
        }
        break;
      case "generated": {
        const { entity, id, draftId } = change;
        add(draftId, ...(yield* readsOf(rowOf, entity, id, draftId)));
        // A page's pending or missing meta title is a publish warning or blocker.
        if (entity === "page") add(draftId, queryKeys.drafts.all);
        break;
      }
      case "translations":
        // The draft's summary, and every listed draft's, says which of its locales are
        // translating, and so does its publish preview, which waits for them.
        add(change.draftId, queryKeys.drafts.all);
        add(null, queryKeys.drafts.list);
        break;
      case "overview":
        // Its draft's publish preview carries it.
        add(change.draftId, queryKeys.drafts.all);
        break;
      case "localizedWrite":
        // Its content change says where it shows.
        break;
      case "definitions":
        // Content conforms to its definitions: everything the scope reads can change.
        add(change.draftId, prefixes.everything);
        break;
      case "drafts":
        add(null, queryKeys.drafts.all);
        break;
      case "ended":
        ended.push({ type: "draftEnded", ...change.ended });
        break;
      case "project":
        add(null, prefixes.projects);
        break;
    }
  }

  const invalidations: ProjectRoomMessage[] = [...targets]
    .sort(([a], [b]) => Number(a === null) - Number(b === null))
    .map(([draftId, keys]) => ({ type: "invalidate", draftId, targets: withoutCovered(keys) }));
  // Viewers of an ended draft go back to Live once Live's reads are refreshed.
  return [...invalidations, ...ended];
});

/**
 * Sends each project's room the messages for what a unit of work changed. Reading where the
 * changes show can't fail it: a change whose entity can't be read refreshes more broadly.
 */
export const announce = Effect.fn("invalidation.announce")(
  function* (db: Database, changes: readonly Change[]) {
    const rowOf = rowsIn(db, changes);
    const byProject = new Map<number, Change[]>();
    for (const change of changes) {
      byProject.set(change.projectId, [...(byProject.get(change.projectId) ?? []), change]);
    }
    for (const [projectId, projectChanges] of byProject) {
      for (const message of yield* messagesFor(rowOf, projectChanges)) {
        projectRooms.send(projectId, message);
      }
    }
  },
  Effect.catchCause((cause) =>
    // The work it announces already happened: a failure to announce it mustn't fail it.
    Effect.logError("[invalidation] announcing changes failed", cause),
  ),
);
