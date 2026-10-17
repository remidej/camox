import { and, eq, inArray } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { Effect } from "effect";

import { lexicalStateToPlainText } from "../../lib/lexical-state";
import {
  blockDefinitions,
  blocks,
  collectionDefinitions,
  collectionRecords,
  pages,
  repeatableItems,
  sharedContents,
} from "../../schema";
import { conformRecordContent } from "../_shared/conform-content";
import { definitionsIn } from "../_shared/definitions";
import type { ServiceContext } from "../_shared/service-context";
import type { GeneratedEntity } from "../generated-values/schema";
import { readValues } from "../generated-values/service";
import * as overlay from "./overlay";
import type { DraftScope } from "./scope";

// How a publish preview names the entities it mentions, so people can find them: a label, and
// the page, layout, synced block or collection the entity sits in (ADR 0009).

type Scope = NonNullable<DraftScope>;
type BlockRow = typeof blocks.$inferSelect;
export type RecordRow = typeof collectionRecords.$inferSelect;

/**
 * Where an entity sits, so people can find it: its page, its layout, its synced block or its
 * collection.
 */
export type Owner =
  | { kind: "page"; id: string; path: string; nickname: string }
  | { kind: "layout"; name: string }
  | { kind: "syncedBlock"; name: string; title: string }
  | { kind: "collection"; name: string; title: string }
  | null;

/** What a preview can mention: an entity drafts hold, or a definition (ADR 0006). */
export type SubjectKind = overlay.EntityKind | "definition";

/** An entity as people know it. */
export type Subject = {
  entity: SubjectKind;
  id: string;
  /** What the entity is to people, e.g. a block's summary or its definition's title. */
  label: string;
  owner: Owner;
};

export type Mention = { entity: SubjectKind; id: string };

/** The rows of `ids` the draft holds, or Live's where it holds none. */
const rowsSeenBy = <T extends overlay.ContentTable>(
  ctx: ServiceContext,
  scope: Scope,
  table: T,
  ids: string[],
) =>
  Effect.gen(function* () {
    if (ids.length === 0) return new Map<string, T["$inferSelect"]>();
    const rows = (yield* Effect.promise(() =>
      ctx.db
        .select()
        .from(table as SQLiteTable)
        .where(and(inArray(table.id, ids), overlay.storedInLiveOrDraft(table, scope.id))),
    )) as T["$inferSelect"][];
    const byId = new Map<string, T["$inferSelect"]>();
    for (const row of rows) {
      if (!byId.has(row.id) || row.draftId !== null) byId.set(row.id, row);
    }
    return byId;
  });

/**
 * Labels and owners for pages, blocks, synced blocks and items, from the rows the draft holds
 * or Live's: a block or item sits on its page or layout, or in its synced block; a page is its
 * own.
 */
const contentDescriber = Effect.fn("drafts.contentDescriber")(function* (
  ctx: ServiceContext,
  scope: Scope,
  mentions: Mention[],
) {
  const idsOf = (entity: overlay.EntityKind) => [
    ...new Set(mentions.filter((m) => m.entity === entity).map((m) => m.id)),
  ];
  const items = yield* rowsSeenBy(ctx, scope, repeatableItems, idsOf("repeatableItem"));
  const blockIds = [
    ...idsOf("block"),
    ...[...items.values()].flatMap((item) => (item.blockId ? [item.blockId] : [])),
  ];
  const blockRows = yield* rowsSeenBy(ctx, scope, blocks, [...new Set(blockIds)]);
  const pageIds = [
    ...idsOf("page"),
    ...[...blockRows.values()].flatMap((row) => (row.pageId ? [row.pageId] : [])),
  ];
  const pageRows = yield* rowsSeenBy(ctx, scope, pages, [...new Set(pageIds)]);
  const shared = yield* rowsSeenBy(ctx, scope, sharedContents, idsOf("sharedContent"));
  // Summaries are generated values the draft reads (ADR 0012).
  const summary = (entity: GeneratedEntity, ids: Iterable<string>) =>
    Effect.map(
      readValues(ctx.db, scope, entity, "summary", [...ids]),
      (values) => (id: string) => values.get(id)?.value?.summary ?? "",
    );
  const sharedSummary = yield* summary("sharedContent", shared.keys());
  const itemSummary = yield* summary("repeatableItem", items.keys());
  const blockSummary = yield* summary("block", blockRows.keys());
  const definitions = yield* Effect.promise(() =>
    ctx.db
      .select({ blockId: blockDefinitions.blockId, title: blockDefinitions.title })
      .from(blockDefinitions)
      .where(
        and(
          eq(blockDefinitions.projectId, scope.projectId),
          definitionsIn(blockDefinitions, scope),
        ),
      ),
  );
  const titles = new Map(definitions.map((definition) => [definition.blockId, definition.title]));

  const pageOwner = (pageId: string | null): Owner => {
    const page = pageId ? pageRows.get(pageId) : undefined;
    return page
      ? { kind: "page", id: page.id, path: page.fullPath, nickname: page.nickname }
      : null;
  };
  const syncedOwner = (type: string): Owner => ({
    kind: "syncedBlock",
    name: type,
    title: titles.get(type) ?? type,
  });
  const blockOwner = (block: BlockRow | undefined): Owner => {
    if (!block) return null;
    if (block.pageId) return pageOwner(block.pageId);
    if (block.layoutId) return { kind: "layout", name: block.layoutId };
    return null;
  };

  return (entity: SubjectKind, id: string): Subject => {
    if (entity === "page") {
      return { entity, id, label: "Page", owner: pageOwner(id) };
    }
    if (entity === "sharedContent") {
      const row = shared.get(id);
      const type = row?.type ?? id;
      return {
        entity,
        id,
        label: sharedSummary(id) || "Shared content",
        owner: syncedOwner(type),
      };
    }
    if (entity === "repeatableItem") {
      const item = items.get(id);
      let owner: Owner = null;
      if (item?.sharedContentType) owner = syncedOwner(item.sharedContentType);
      else if (item?.blockId) owner = blockOwner(blockRows.get(item.blockId));
      return { entity, id, label: itemSummary(id) || "Item", owner };
    }
    const row = blockRows.get(id);
    if (!row) return { entity, id, label: "Block", owner: null };
    return {
      entity,
      id,
      label: blockSummary(id) || titles.get(row.type) || row.type,
      owner: blockOwner(row),
    };
  };
});

/** A file as people know it: by its filename. Files belong to no page or layout. */
const describeFile = (id: string, file?: { filename: string }): Subject => ({
  entity: "file",
  id,
  label: file?.filename ?? "File",
  owner: null,
});

/** Labels for records, from the rows given, each under its collection. */
const recordDescriber = Effect.fn("drafts.recordDescriber")(function* (
  ctx: ServiceContext,
  scope: Scope,
  rows: Iterable<RecordRow>,
) {
  const definitions = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(collectionDefinitions)
      .where(
        and(
          eq(collectionDefinitions.projectId, scope.projectId),
          definitionsIn(collectionDefinitions, scope),
        ),
      ),
  );
  const definitionOf = (row: RecordRow) =>
    definitions.find(
      (definition) =>
        definition.projectId === row.projectId && definition.collectionId === row.collectionId,
    );
  const byId = new Map([...rows].map((row) => [row.id, row]));

  return (id: string): Subject => {
    const row = byId.get(id);
    if (!row) return { entity: "record", id, label: "Record", owner: null };
    const definition = definitionOf(row);
    // A record of a removed collection is still named by its collection's name (ADR 0007).
    if (!definition) {
      const owner: Owner = { kind: "collection", name: row.collectionId, title: row.collectionId };
      return { entity: "record", id, label: "Record", owner };
    }
    const content = conformRecordContent(definition.contentSchema, row.content);
    const label = lexicalStateToPlainText(
      content[definition.label] as string | Record<string, unknown>,
    );
    return {
      entity: "record",
      id,
      label: label || "Untitled record",
      owner: { kind: "collection", name: definition.collectionId, title: definition.title },
    };
  };
});

/**
 * Names the entities a preview mentions. Pages, blocks, synced blocks and items are read here;
 * records and files are named from the rows the caller already holds (the draft's, as it reads
 * them), so a record is labelled by its content and a file by its filename.
 */
export const describeSubjects = Effect.fn("drafts.describeSubjects")(function* (
  ctx: ServiceContext,
  scope: Scope,
  mentions: Mention[],
  known: { records: Iterable<RecordRow>; files: ReadonlyMap<string, { filename: string }> },
) {
  const describeContent = yield* contentDescriber(ctx, scope, mentions);
  const describeRecord = yield* recordDescriber(ctx, scope, known.records);
  return (entity: SubjectKind, id: string): Subject => {
    if (entity === "record") return describeRecord(id);
    if (entity === "file") return describeFile(id, known.files.get(id));
    return describeContent(entity, id);
  };
});
