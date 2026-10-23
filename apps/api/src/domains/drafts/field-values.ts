import { artifactTitle } from "@camox/api-contract";
import { and, eq, inArray } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { Effect } from "effect";

import { isObject } from "../../lib/is-object";
import { lexicalStateToPlainText } from "../../lib/lexical-state";
import {
  blocks,
  collectionRecords,
  files,
  pages,
  repeatableItems,
  sharedContents,
} from "../../schema";
import { type Field, fieldsOf, pointersIn } from "../_shared/fields";
import type { ServiceContext } from "../_shared/service-context";
import { contentReader } from "../content/reader";
import { withFileMetadata } from "../files/generated-metadata";
import { defaultLocaleTag } from "../locales/default-locale";
import * as overlay from "./overlay";
import type { DraftScope } from "./scope";

// What an entity's fields hold, side by side on Live and in a draft, as short plain text people
// can read: rich text flattened, references by their target's label, files by their filename.
// Conflict cards show the fields that differ (#529), and so does the draft overview's input.

type Scope = NonNullable<DraftScope>;
type FileRow = typeof files.$inferSelect;
type RecordRow = typeof collectionRecords.$inferSelect;

/** A field whose value differs between Live's version of an entity and a draft's copy. */
export type FieldDiff = {
  /** The field's title, from its definition. */
  field: string;
  live: string;
  draft: string;
};

/** How long a value shown as plain text gets before it's cut. */
const MAX_LENGTH = 120;

/** A value cut to a readable length, on one line. */
function short(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > MAX_LENGTH ? `${line.slice(0, MAX_LENGTH - 1).trimEnd()}…` : line;
}

/** A field of an entity, as its title and how to read its value from a row. */
type RowField = { title: string; read: (row: Record<string, unknown>) => string };

/** What renders values that point elsewhere: record labels and filenames, by id. */
type Targets = { record: (id: string) => string; file: (id: string) => string };

const fileIdOf = (value: unknown) =>
  isObject(value) && typeof value._fileId === "string" ? value._fileId : undefined;

/**
 * A field's value as plain text, or undefined for a field that isn't shown this way, like a
 * repeater, whose items are entities of their own.
 */
function plainText(field: Field, value: unknown, targets: Targets): string | undefined {
  switch (field.kind) {
    case "String":
      return typeof value === "string" || isObject(value) ? lexicalStateToPlainText(value) : "";
    case "Embed":
    case "Icon":
    case "Enum":
      return typeof value === "string" ? value : "";
    case "Artifact":
      return typeof value === "string" && value.trim() !== "" ? artifactTitle(value) : "";
    case "Boolean":
      return value === true ? "Yes" : "No";
    case "Link": {
      if (!isObject(value)) return "";
      const text = typeof value.text === "string" ? value.text : "";
      const href = typeof value.href === "string" ? value.href : "";
      return text || href;
    }
    case "Image":
    case "File": {
      const id = fileIdOf(value);
      return id ? targets.file(id) : "";
    }
    case "ImageList":
    case "FileList":
      return Array.isArray(value)
        ? value
            .flatMap((entry) => fileIdOf(entry) ?? [])
            .map(targets.file)
            .join(", ")
        : "";
    case "Reference":
      return typeof value === "string" && value !== "" ? targets.record(value) : "";
    case "ReferenceList":
      if (field.queryBacked) return undefined;
      return Array.isArray(value)
        ? value.flatMap((id) => (typeof id === "string" ? [targets.record(id)] : [])).join(", ")
        : "";
    default:
      return undefined;
  }
}

/** The fields of content and settings schemas, read from a row's `content` and `settings`. */
function schemaFields(contentSchema: unknown, settingsSchema: unknown, targets: Targets) {
  const fields: RowField[] = [];
  for (const [column, schema] of [
    ["content", contentSchema],
    ["settings", settingsSchema],
  ] as const) {
    for (const field of fieldsOf(schema)) {
      // Fields not shown as plain text, like repeaters, are left out.
      if (plainText(field, undefined, targets) === undefined) continue;
      fields.push({
        title: field.title,
        read: (row) => {
          const values = row[column];
          return plainText(field, isObject(values) ? values[field.name] : undefined, targets) ?? "";
        },
      });
    }
  }
  return fields;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** A page's own fields, which no definition declares. */
const PAGE_FIELDS: RowField[] = [
  { title: "Name", read: (row) => text(row.nickname) },
  { title: "Path", read: (row) => text(row.fullPath) },
  { title: "Meta title", read: (row) => text(row.metaTitle) },
  { title: "Meta description", read: (row) => text(row.metaDescription) },
];

/** A file's own fields, as its metadata reads: manual, or generated. */
const FILE_FIELDS: RowField[] = [
  { title: "Filename", read: (row) => text(row.filename) },
  { title: "Alt text", read: (row) => text(row.alt) },
];

/** The kinds of entity whose fields are compared, and the tables holding them. */
const TABLES = {
  page: pages,
  block: blocks,
  sharedContent: sharedContents,
  repeatableItem: repeatableItems,
  record: collectionRecords,
  file: files,
} as const;

type ComparedKind = keyof typeof TABLES;
const isCompared = (entity: string): entity is ComparedKind => Object.hasOwn(TABLES, entity);

// D1 binds at most 100 parameters per statement.
const ID_CHUNK = 90;

/**
 * Live's rows and the draft's own for these ids, tombstones included, in the default locale for
 * a localized table.
 */
const bothRows = Effect.fn("drafts.bothRows")(function* <T extends overlay.ContentTable>(
  ctx: ServiceContext,
  scope: Scope,
  table: T,
  ids: string[],
  defaultTag: string | undefined,
) {
  const live = new Map<string, T["$inferSelect"]>();
  const draft = new Map<string, T["$inferSelect"]>();
  const locale = "locale" in table ? (table.locale as typeof blocks.locale) : undefined;
  for (let start = 0; start < ids.length; start += ID_CHUNK) {
    const rows = (yield* Effect.promise(() =>
      ctx.db
        .select()
        .from(table as SQLiteTable)
        .where(
          and(
            inArray(table.id, ids.slice(start, start + ID_CHUNK)),
            overlay.storedInLiveOrDraft(table, scope.id),
            locale && defaultTag !== undefined ? eq(locale, defaultTag) : undefined,
          ),
        ),
    )) as T["$inferSelect"][];
    for (const row of rows) (row.draftId === null ? live : draft).set(row.id, row);
  }
  return { live, draft };
});

/** Rows of a table the draft reads in the default locale, by id, Live's where it holds none. */
const seenRows = <T extends overlay.ContentTable>(
  ctx: ServiceContext,
  scope: Scope,
  table: T,
  ids: Iterable<string>,
  defaultTag: string | undefined,
) =>
  Effect.map(bothRows(ctx, scope, table, [...new Set(ids)], defaultTag), ({ live, draft }) => {
    const seen = new Map(live);
    for (const [id, row] of draft) seen.set(id, row);
    for (const [id, row] of seen) if (row.deleted) seen.delete(id);
    return seen;
  });

/**
 * For entities a draft holds a copy of, the default-locale fields where Live's version and the
 * draft's copy differ, as short plain text in field order, with titles from their definitions.
 * An entity either side deleted, or that isn't one with fields, like a locale, has none.
 */
export const fieldDiffsOf = Effect.fn("drafts.fieldDiffsOf")(function* (
  ctx: ServiceContext,
  scope: Scope,
  entities: readonly { entity: overlay.EntityKind; id: string }[],
) {
  const defaultTag = yield* defaultLocaleTag(ctx.db, scope.projectId);
  const pairs = new Map<
    string,
    { live: Record<string, unknown>; draft: Record<string, unknown> }
  >();
  const key = (entity: string, id: string) => `${entity}:${id}`;
  const rowsByKind = new Map<ComparedKind, { live: unknown[]; draft: unknown[] }>();
  for (const entity of Object.keys(TABLES) as ComparedKind[]) {
    const ids = [...new Set(entities.filter((e) => e.entity === entity).map((e) => e.id))];
    if (ids.length === 0) continue;
    const { live, draft } = yield* bothRows(ctx, scope, TABLES[entity], ids, defaultTag);
    const kept = { live: [] as unknown[], draft: [] as unknown[] };
    for (const [id, draftRow] of draft) {
      const liveRow = live.get(id);
      if (!liveRow || liveRow.deleted || draftRow.deleted) continue;
      pairs.set(key(entity, id), { live: liveRow, draft: draftRow });
      kept.live.push(liveRow);
      kept.draft.push(draftRow);
    }
    rowsByKind.set(entity, kept);
  }

  // Files show their metadata as each side reads it.
  const fileRows = rowsByKind.get("file");
  if (fileRows) {
    for (const [side, read] of [
      ["live", null],
      ["draft", scope],
    ] as const) {
      for (const row of yield* withFileMetadata(ctx.db, read, fileRows[side] as FileRow[])) {
        const pair = pairs.get(key("file", row.id));
        if (pair) pair[side] = row;
      }
    }
  }

  // What the compared content points at, named as the draft reads it.
  const reader = contentReader(ctx, { projectId: scope.projectId, draft: scope });
  const schemaOf = new Map<string, { content: unknown; settings: unknown }>();
  for (const entity of ["block", "sharedContent"] as const) {
    for (const row of (rowsByKind.get(entity)?.draft ?? []) as { id: string; type: string }[]) {
      const definition = yield* reader.blockDefinition(row.type);
      if (definition) {
        schemaOf.set(key(entity, row.id), {
          content: definition.contentSchema,
          settings: definition.settingsSchema,
        });
      }
    }
  }
  const items = (rowsByKind.get("repeatableItem")?.draft ??
    []) as (typeof repeatableItems.$inferSelect)[];
  for (const [id, schemas] of yield* reader.itemSchemas(items)) {
    schemaOf.set(key("repeatableItem", id), schemas);
  }
  for (const row of (rowsByKind.get("record")?.draft ?? []) as RecordRow[]) {
    const definition = yield* reader.collection(row.collectionId);
    if (definition) {
      schemaOf.set(key("record", row.id), { content: definition.contentSchema, settings: null });
    }
  }

  const recordIds = new Set<string>();
  const fileIds = new Set<string>();
  for (const [entityKey, pair] of pairs) {
    const schemas = schemaOf.get(entityKey);
    if (!schemas) continue;
    for (const row of [pair.live, pair.draft]) {
      for (const [schema, values] of [
        [schemas.content, row.content],
        [schemas.settings, row.settings],
      ]) {
        for (const { pointer } of pointersIn(schema, values)) {
          if (pointer.to === "record") recordIds.add(pointer.id);
          if (pointer.to === "file") fileIds.add(pointer.id);
        }
      }
    }
  }
  const records = yield* seenRows(ctx, scope, collectionRecords, recordIds, defaultTag);
  const recordLabels = new Map<string, string>();
  for (const [collectionId, group] of Map.groupBy(records.values(), (row) => row.collectionId)) {
    for (const record of yield* reader.shown.records(collectionId, group)) {
      recordLabels.set(record.id, record.title || "Untitled record");
    }
  }
  const fileRowsSeen = yield* seenRows(ctx, scope, files, fileIds, defaultTag);
  const filenames = new Map(
    (yield* withFileMetadata(ctx.db, scope, [...fileRowsSeen.values()])).map((file) => [
      file.id,
      file.filename || "Untitled file",
    ]),
  );
  const targets: Targets = {
    record: (id) => recordLabels.get(id) ?? "Missing record",
    file: (id) => filenames.get(id) ?? "Missing file",
  };

  const diffs = new Map<string, FieldDiff[]>();
  for (const [entityKey, pair] of pairs) {
    const entity = entityKey.slice(0, entityKey.indexOf(":"));
    const schemas = schemaOf.get(entityKey);
    let fields: RowField[] = [];
    if (entity === "page") fields = PAGE_FIELDS;
    else if (entity === "file") fields = FILE_FIELDS;
    else if (schemas) fields = schemaFields(schemas.content, schemas.settings, targets);
    diffs.set(
      entityKey,
      fields.flatMap(({ title, read }) => {
        const live = short(read(pair.live));
        const draft = short(read(pair.draft));
        return live === draft ? [] : [{ field: title, live, draft }];
      }),
    );
  }

  return (entity: overlay.EntityKind, id: string): FieldDiff[] =>
    isCompared(entity) ? (diffs.get(key(entity, id)) ?? []) : [];
});
