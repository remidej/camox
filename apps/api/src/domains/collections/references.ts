import { isQueryBacked, QUERY_LIMIT_CAP, referenceQueryProblem } from "@camox/api-contract";
import { uuidv7Schema } from "@camox/api-contract/ids";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { Effect } from "effect";

import { InvalidInputError, type ServiceError } from "../../lib/errors";
import { lexicalStateToPlainText } from "../../lib/lexical-state";
import { blockDefinitions } from "../../schema";
import { conformRecordContent } from "../_shared/conform-content";
import { definitionsIn } from "../_shared/definitions";
import { type Field, fieldsOf, itemSchemas, pointersOf } from "../_shared/fields";
import type { ServiceContext } from "../_shared/service-context";
import * as overlay from "../drafts/overlay";
import type { DraftScope } from "../drafts/scope";
import { collectionOfRecord, type ContentScope, recordsOf } from "./identity";
import { resolveRecordFiles } from "./record-files";
import { collectionDefinitions, collectionRecords } from "./schema";
import { validatePageLink } from "./text-content";

/** A node of a stored schema, walked whatever its place in the schema. */
type SchemaNode = Record<string, unknown>;
type ReferenceField = Extract<Field, { kind: "Reference" | "ReferenceList" }>;
type ReferenceListField = Extract<Field, { kind: "ReferenceList" }>;

export type ResolvedReference = {
  id: string;
  collectionId: string;
  label: string;
  content: Record<string, unknown>;
  contentSchema: unknown;
  /** The records this record links, one hop further; absent beyond the second hop. */
  references?: ResolvedReferences;
};

/** A block's resolved references: a record (or null) per reference, records in order per list. */
export type ResolvedReferences = Record<string, ResolvedReference | ResolvedReference[] | null>;

function referenceFields(schema: unknown) {
  return fieldsOf(schema).filter((field) => field.kind === "Reference");
}

function referenceListFields(schema: unknown) {
  return fieldsOf(schema).filter((field) => field.kind === "ReferenceList");
}

/** Every record that resolved references link, single or listed. */
export function referencedRecords(references: ResolvedReferences | undefined) {
  return Object.values(references ?? {}).flatMap((value) => value ?? []);
}

/** A reference field's resolved record; reference lists never resolve to one record. */
export function resolvedReference(references: ResolvedReferences | undefined, field: string) {
  const value = references?.[field];
  return value && !Array.isArray(value) ? value : null;
}

/** A reference list field's resolved records, in list order; references resolve to none. */
export function resolvedReferenceList(references: ResolvedReferences | undefined, field: string) {
  const value = references?.[field];
  return Array.isArray(value) ? value : [];
}

/**
 * References and reference lists are supported at the top level of block content and of
 * repeatable item content, at any repeater depth. Fail closed for other shapes, such as
 * settings, item settings or nested objects.
 */
export function validateReferenceSchema(schema: unknown, allow = true) {
  const allowed = new Set<unknown>();
  const collect = (content: unknown) => {
    for (const field of fieldsOf(content)) {
      if (field.kind === "Reference" || field.kind === "ReferenceList") allowed.add(field.schema);
      if (field.kind === "Repeater") collect(field.itemContentSchema);
    }
  };
  if (allow) collect(schema);
  /** `parentKey` is the key holding `value`, named in query errors. */
  function visit(value: unknown, parentKey: string): InvalidInputError | undefined {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const child of value) {
        const error = visit(child, parentKey);
        if (error) return error;
      }
      return;
    }
    const field = value as SchemaNode;
    const kind = field.kind ?? field.fieldType;
    if (kind === "ReferenceList" || kind === "Reference") {
      if (field.fieldType !== kind || !allowed.has(field)) {
        return new InvalidInputError({
          message: "References and reference lists are only supported in block and item content",
        });
      }
      if (typeof field.collectionId !== "string" || !field.collectionId) {
        return new InvalidInputError({ message: "Reference requires collectionId" });
      }
      if (isQueryBacked(field)) {
        const problem =
          kind === "Reference" ? "only reference lists take a query" : queryProblem(field);
        if (problem) return new InvalidInputError({ message: `${parentKey}: ${problem}` });
      }
    }
    for (const [key, child] of Object.entries(field)) {
      // A reference carries its collection's schema, which collection sync validates.
      if (key === "referenceSchema" && (kind === "Reference" || kind === "ReferenceList")) continue;
      if (key === "query" && (kind === "Reference" || kind === "ReferenceList")) continue;
      const error = visit(child, key);
      if (error) return error;
    }
  }
  const error = visit(schema, "");
  return error ? Effect.fail(error) : Effect.void;
}

/** A query-backed list's normalized query: an optional ordering key and a capped limit. */
export type NormalizedReferenceQuery = {
  orderBy?: { key: string; direction: "asc" | "desc" };
  limit: number;
};

/**
 * Why a reference list's query is invalid, if it is. Ordering keys must name a text field of
 * the collection (from the content schema the field carries) or system metadata.
 */
function queryProblem(field: SchemaNode) {
  const properties = (
    field.referenceSchema as { properties?: Record<string, SchemaNode> } | undefined
  )?.properties;
  return referenceQueryProblem(field.query, (key) =>
    properties && Object.hasOwn(properties, key) ? properties[key]?.fieldType : undefined,
  );
}

/** A reference list field's normalized query; manual lists have none. */
function referenceQuery(field: ReferenceListField): NormalizedReferenceQuery | null {
  const query = field.schema.query as
    | { orderBy?: Record<string, "asc" | "desc">; limit?: number }
    | undefined;
  if (!query || typeof query !== "object") return null;
  const [entry] = Object.entries(query.orderBy ?? {});
  return {
    ...(entry ? { orderBy: { key: entry[0], direction: entry[1] } } : {}),
    limit: Math.min(query.limit ?? QUERY_LIMIT_CAP, QUERY_LIMIT_CAP),
  };
}

type ItemRow = { id: string; parentItemId: string | null; fieldName: string };

/**
 * Resolves the records a block, item or record links. Resolution is bounded at two hops: records
 * placed by blocks and items (`hop` 1) resolve the records they link (`hop` 2), which resolve
 * nothing further. Cycles therefore cannot expand without limit.
 */
export const resolveReferences = Effect.fn("collections.resolveReferences")(function* (
  ctx: ServiceContext,
  scope: ContentScope,
  schema: unknown,
  content: unknown,
  hop: 1 | 2 = 1,
): Effect.fn.Return<ResolvedReferences, ServiceError> {
  const singles = referenceFields(schema);
  const lists = referenceListFields(schema);
  const result: ResolvedReferences = {};
  if (!singles.length && !lists.length) return result;
  const values = content as Record<string, unknown> | null;
  for (const field of singles) {
    const definition = yield* definitionIn(ctx, scope, field);
    result[field.name] = definition
      ? yield* resolveRecord(ctx, definition, values?.[field.name], hop)
      : null;
  }
  for (const field of lists) {
    const records: ResolvedReference[] = [];
    result[field.name] = records;
    const definition = yield* definitionIn(ctx, scope, field);
    if (!definition) continue;
    // A query-backed list ignores any stored value: code defines its membership and order.
    const query = referenceQuery(field);
    const ids = query
      ? yield* queryRecordIds(ctx, definition, query)
      : pointersOf(field, values?.[field.name]).map((pointer) => pointer.id);
    // Missing records, such as deleted ones, are left out.
    for (const id of ids) {
      const record = yield* resolveRecord(ctx, definition, id, hop);
      if (record) records.push(record);
    }
  }
  return result;
});

/**
 * Text order for query-backed lists: English collation, case-insensitive, numbers by value.
 * Text differing only by case compares equal, so the id tie-break keeps the order deterministic.
 */
const textOrder = new Intl.Collator("en", { numeric: true, sensitivity: "accent" });

/** A collection as read in a scope, so its records are read in the same one. */
type Definition = typeof collectionDefinitions.$inferSelect & { draft: DraftScope };
type Direction = "asc" | "desc";

/**
 * The records a query-backed list resolves to, in order. `publishedAt` orders by when each
 * record was first published, so editing and republishing a record never reorders it. Empty
 * text sorts last in either direction, and ties break by record id. Without `orderBy`, records
 * keep their creation order.
 */
function queryRecordIds(
  ctx: ServiceContext,
  definition: Definition,
  query: NormalizedReferenceQuery,
) {
  const { key, direction } = query.orderBy ?? { key: "createdAt", direction: "asc" };
  if (key === "createdAt" || key === "publishedAt") {
    return recordIdsByTime(ctx, definition, key, direction, query.limit);
  }
  return recordIdsByText(ctx, definition, key, direction, query.limit);
}

/**
 * When a record was first published. A record the draft created sorts as published now, where
 * publishing would put it. A Live record written before publish times were kept falls back to
 * its creation time.
 */
const firstPublished = (now: number) =>
  sql`coalesce(${collectionRecords.firstPublishedAt}, case
    when ${collectionRecords.draftId} is not null and ${collectionRecords.baseVersion} is null
    then ${now} else ${collectionRecords.createdAt} end)`;

/** Orders by creation or first publish time in SQL, so only `limit` ids load. */
const recordIdsByTime = Effect.fn("collections.recordIdsByTime")(function* (
  ctx: ServiceContext,
  definition: Definition,
  key: "createdAt" | "publishedAt",
  direction: Direction,
  limit: number,
) {
  const sortKey =
    key === "createdAt" ? sql`${collectionRecords.createdAt}` : firstPublished(Date.now());
  const rows = yield* Effect.promise(() =>
    ctx.db
      .select({ id: collectionRecords.id })
      .from(collectionRecords)
      .where(recordsOf(definition, definition.draft))
      .orderBy(direction === "asc" ? asc(sortKey) : desc(sortKey), asc(collectionRecords.id))
      .limit(limit),
  );
  return rows.map((row) => row.id);
});

/**
 * Orders by a text field in memory, since the collation is ICU's, not SQLite's. One query loads
 * each candidate's id and raw field value only, never whole records.
 */
const recordIdsByText = Effect.fn("collections.recordIdsByText")(function* (
  ctx: ServiceContext,
  definition: Definition,
  key: string,
  direction: Direction,
  limit: number,
) {
  const content = collectionRecords.content;
  const path = `$.${JSON.stringify(key)}`;
  const rows = yield* Effect.promise(() =>
    ctx.db
      .select({
        id: collectionRecords.id,
        value: sql<string | null>`case when json_type(${content}, ${path}) = 'text'
          then json_extract(${content}, ${path}) end`,
      })
      .from(collectionRecords)
      .where(recordsOf(definition, definition.draft)),
  );
  const sign = direction === "asc" ? 1 : -1;
  const keyed = rows.map((row) => {
    const text = row.value === null ? "" : lexicalStateToPlainText(row.value);
    return { id: row.id, key: text === "" ? null : text };
  });
  keyed.sort((a, b) => compareTextKeys(a, b, sign));
  return keyed.slice(0, limit).map((candidate) => candidate.id);
});

type TextKey = { id: string; key: string | null };

/** Missing text sorts last in either direction; equal text breaks by id, ascending. */
function compareTextKeys(a: TextKey, b: TextKey, sign: 1 | -1) {
  const byId = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  if (a.key === null && b.key === null) return byId;
  if (a.key === null) return 1;
  if (b.key === null) return -1;
  return textOrder.compare(a.key, b.key) * sign || byId;
}

/** The collection a reference field names, in the scope of the content holding it. */
const definitionIn = Effect.fn("collections.definitionIn")(function* (
  ctx: ServiceContext,
  scope: ContentScope,
  field: ReferenceField,
) {
  const definition = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(collectionDefinitions)
      .where(
        and(
          eq(collectionDefinitions.projectId, scope.projectId),
          definitionsIn(collectionDefinitions, scope.draft),
          eq(collectionDefinitions.collectionId, field.collectionId),
        ),
      )
      .get(),
  );
  return definition && { ...definition, draft: scope.draft };
});

/** A linked record with its current content, or null when it is missing. */
const resolveRecord = Effect.fn("collections.resolveRecord")(function* (
  ctx: ServiceContext,
  definition: Definition,
  id: unknown,
  hop: 1 | 2,
): Effect.fn.Return<ResolvedReference | null, ServiceError> {
  const validId = uuidv7Schema.safeParse(id);
  if (!validId.success) return null;
  const record = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(collectionRecords)
      .where(and(eq(collectionRecords.id, validId.data), recordsOf(definition, definition.draft)))
      .get(),
  );
  if (!record) return null;
  const { contentSchema } = definition;
  const content = conformRecordContent(contentSchema, record.content);
  // A record placed at the first hop resolves its own references; the second hop stops.
  const linked =
    hop === 1
      ? { references: yield* resolveReferences(ctx, definition, contentSchema, content, 2) }
      : {};
  return {
    id: record.id,
    collectionId: definition.collectionId,
    content: yield* resolveRecordFiles(ctx, definition, contentSchema, content),
    label: lexicalStateToPlainText(content[definition.label] as string),
    contentSchema,
    ...linked,
  } satisfies ResolvedReference;
});

const blockDefinitionsIn = Effect.fn("collections.blockDefinitionsIn")(function* (
  ctx: ServiceContext,
  scope: ContentScope,
) {
  return yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(blockDefinitions)
      .where(
        and(
          eq(blockDefinitions.projectId, scope.projectId),
          definitionsIn(blockDefinitions, scope.draft),
        ),
      ),
  );
});

export const hydrateReferences = Effect.fn("collections.hydrateReferences")(function* <
  T extends { type: string; content: unknown },
>(
  ctx: ServiceContext,
  scope: ContentScope,
  values: T[],
): Effect.fn.Return<(T & { references: ResolvedReferences })[], ServiceError> {
  const definitions = yield* blockDefinitionsIn(ctx, scope);
  return yield* Effect.forEach(
    values,
    (block) =>
      resolveReferences(
        ctx,
        scope,
        definitions.find((definition) => definition.blockId === block.type)?.contentSchema,
        block.content,
      ).pipe(Effect.map((references) => ({ ...block, references }))),
    { concurrency: "unbounded" },
  );
});

/**
 * Resolves the references of repeatable items, like `hydrateReferences` does for blocks.
 * Each item's schema comes from its block's type and its repeater path.
 */
export const hydrateItemReferences = Effect.fn("collections.hydrateItemReferences")(function* <
  T extends ItemRow & { blockId: string; content: unknown },
>(
  ctx: ServiceContext,
  scope: ContentScope,
  blocks: readonly { id: string; type: string }[],
  items: T[],
): Effect.fn.Return<(T & { references: ResolvedReferences })[], ServiceError> {
  if (!items.length) return [];
  const definitions = yield* blockDefinitionsIn(ctx, scope);
  const schemas = new Map<string, unknown>();
  for (const block of blocks) {
    const blockSchema = definitions.find(
      (definition) => definition.blockId === block.type,
    )?.contentSchema;
    const blockItems = items.filter((item) => item.blockId === block.id);
    for (const [id, { content }] of itemSchemas(blockSchema, blockItems)) schemas.set(id, content);
  }
  return yield* Effect.forEach(
    items,
    (item) =>
      resolveReferences(ctx, scope, schemas.get(item.id), item.content).pipe(
        Effect.map((references) => ({ ...item, references })),
      ),
    { concurrency: "unbounded" },
  );
});

/**
 * Validates reference values and page links in scope: in `content` itself and, for inline
 * repeatable items (block patches and bundles reconstructed from item seeds), in each item's
 * content too. Item markers (`{ _itemId }`) carry no content of their own here.
 */
export const validateReferenceValues = Effect.fn("collections.validateReferenceValues")(function* (
  ctx: ServiceContext,
  scope: ContentScope,
  schema: unknown,
  content: unknown,
  path = "",
): Effect.fn.Return<void, InvalidInputError> {
  const values = content as Record<string, unknown> | null;
  for (const field of fieldsOf(schema)) {
    const { name } = field;
    const value = values?.[name];
    if (value === undefined) continue;
    if (field.kind === "Reference") {
      if (value === null) continue;
      if (!(yield* recordInScope(ctx, scope, field, value)))
        return yield* missingReference(path + name);
      continue;
    }
    if (field.kind === "ReferenceList") {
      if (field.queryBacked) {
        return yield* new InvalidInputError({
          message: `${path}${name}: query-backed reference lists are resolved, not written`,
        });
      }
      if (!Array.isArray(value))
        return yield* invalidList(path + name, "must be an array of record ids");
      if (new Set(value).size !== value.length) {
        return yield* invalidList(path + name, "links the same record more than once");
      }
      if (field.maxItems !== undefined && value.length > field.maxItems) {
        return yield* invalidList(path + name, `links more than ${field.maxItems} records`);
      }
      for (const id of value) {
        if (!(yield* recordInScope(ctx, scope, field, id)))
          return yield* missingReference(path + name);
      }
      continue;
    }
    if (field.kind === "String" || field.kind === "Link") {
      for (const pointer of pointersOf(field, value)) {
        yield* validatePageLink(ctx, scope, pointer.id);
      }
      continue;
    }
    if (field.kind !== "Repeater" || !Array.isArray(value)) continue;
    for (const [index, item] of value.entries()) {
      if (!item || typeof item !== "object") continue;
      yield* validateReferenceValues(
        ctx,
        scope,
        field.itemContentSchema,
        item,
        `${path}${name}[${index}].`,
      );
    }
  }
});

export const recordInScope = Effect.fn("collections.recordInScope")(function* (
  ctx: ServiceContext,
  scope: ContentScope,
  field: { collectionId?: unknown },
  value: unknown,
) {
  const validId = uuidv7Schema.safeParse(value);
  if (!validId.success) return false;
  const record = yield* Effect.promise(() =>
    ctx.db
      .select({ id: collectionRecords.id })
      .from(collectionRecords)
      .innerJoin(collectionDefinitions, collectionOfRecord)
      .where(
        and(
          eq(collectionRecords.id, validId.data),
          overlay.visibleIn(collectionRecords, scope.draft),
          eq(collectionDefinitions.projectId, scope.projectId),
          definitionsIn(collectionDefinitions, scope.draft),
          eq(collectionDefinitions.collectionId, String(field.collectionId)),
        ),
      )
      .get(),
  );
  return !!record;
});

function invalidList(name: string, problem: string) {
  return new InvalidInputError({ message: `${name}: reference list ${problem}` });
}

export function missingReference(name: string) {
  return new InvalidInputError({
    message: `${name}: reference is missing or outside this collection/project`,
  });
}

/**
 * The project a block belongs to, whether on a page or in a layout, read as Live or as `draft`.
 */
export function blockScope(block: { projectId: number }, draft: DraftScope): ContentScope {
  return { projectId: block.projectId, draft };
}
