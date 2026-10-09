import { isQueryBacked, QUERY_LIMIT_CAP, referenceQueryProblem } from "@camox/api-contract";
import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { Effect } from "effect";
import { z } from "zod";

import { getAuthorizedProject, requireUser } from "../../authorization";
import { InvalidInputError, NotFoundError, type ServiceError } from "../../lib/errors";
import { lexicalStateToPlainText } from "../../lib/lexical-state";
import { stableStringify } from "../../lib/stable-stringify";
import { blockDefinitions, layouts, pages } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
import { collectionDefinitions, collectionRecords, collectionRevisions } from "./schema";

type Field = Record<string, unknown>;
export type ResolvedReference = {
  id: string;
  collectionId: string;
  label: string;
  content: Record<string, unknown>;
  contentSchema: unknown;
  version?: number;
  revisionId?: string;
  /** The records this record links, one hop further; absent beyond the second hop. */
  references?: ResolvedReferences;
};

/** A block's resolved references: a record (or null) per reference, records in order per list. */
export type ResolvedReferences = Record<string, ResolvedReference | ResolvedReference[] | null>;

function fieldsOfType(
  schema: unknown,
  fieldType: "Reference" | "ReferenceList",
): [string, Field][] {
  const properties = (schema as { properties?: Record<string, Field> } | null)?.properties;
  return Object.entries(properties ?? {}).filter(([, field]) => field.fieldType === fieldType);
}

export function referenceFields(schema: unknown): [string, Field][] {
  return fieldsOfType(schema, "Reference");
}

export function referenceListFields(schema: unknown): [string, Field][] {
  return fieldsOfType(schema, "ReferenceList");
}

/** The record ids a reference list value links, in stored order; anything else links none. */
export function referenceListIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === "string" && id !== "");
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

/** A content schema's repeater fields, whose items hold their own content schema. */
function repeaterFields(schema: unknown): [string, Field][] {
  const properties = (schema as { properties?: Record<string, Field> } | null)?.properties;
  return Object.entries(properties ?? {}).filter(([, field]) => field.fieldType === "Repeater");
}

/**
 * References and reference lists are supported at the top level of block content and of
 * repeatable item content, at any repeater depth. Fail closed for other shapes, such as
 * settings, item settings or nested objects.
 */
export function validateReferenceSchema(schema: unknown, allow = true) {
  const allowed = new Set<Field>();
  const collect = (content: unknown) => {
    for (const [, field] of [...referenceFields(content), ...referenceListFields(content)]) {
      allowed.add(field);
    }
    for (const [, repeater] of repeaterFields(content)) collect(repeater.items);
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
    const field = value as Field;
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
function queryProblem(field: Field) {
  const properties = (field.referenceSchema as { properties?: Record<string, Field> } | undefined)
    ?.properties;
  return referenceQueryProblem(field.query, (key) =>
    properties && Object.hasOwn(properties, key) ? properties[key]?.fieldType : undefined,
  );
}

/** A reference list field's normalized query; manual lists have none. */
export function referenceQuery(field: Field): NormalizedReferenceQuery | null {
  const query = field.query as
    | { orderBy?: Record<string, "asc" | "desc">; limit?: number }
    | undefined;
  if (!query || typeof query !== "object") return null;
  const [entry] = Object.entries(query.orderBy ?? {});
  return {
    ...(entry ? { orderBy: { key: entry[0], direction: entry[1] } } : {}),
    limit: Math.min(query.limit ?? QUERY_LIMIT_CAP, QUERY_LIMIT_CAP),
  };
}

type ItemRow = { id: number; parentItemId: number | null; fieldName: string };

/**
 * Each repeatable item's content schema, found by walking its repeater path from the block's
 * content schema. Items whose path no longer matches the schema have none.
 */
export function itemSchemas(blockSchema: unknown, items: readonly ItemRow[]) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const schemas = new Map<number, unknown>();
  const schemaOf = (item: ItemRow, seen: Set<number>): unknown => {
    if (schemas.has(item.id)) return schemas.get(item.id);
    if (seen.has(item.id)) return undefined;
    seen.add(item.id);
    const parent = item.parentItemId === null ? null : byId.get(item.parentItemId);
    const container =
      item.parentItemId === null ? blockSchema : parent ? schemaOf(parent, seen) : undefined;
    const repeater = (container as { properties?: Record<string, Field> } | undefined)
      ?.properties?.[item.fieldName];
    const schema = repeater?.fieldType === "Repeater" ? repeater.items : undefined;
    schemas.set(item.id, schema);
    return schema;
  };
  for (const item of items) schemaOf(item, new Set());
  return schemas;
}

/**
 * Resolves the records a block, item or record links. Resolution is bounded at two hops: records
 * placed by blocks and items (`hop` 1) resolve the records they link (`hop` 2), which resolve
 * nothing further. Cycles therefore cannot expand without limit.
 */
export const resolveReferences = Effect.fn("collections.resolveReferences")(function* (
  ctx: ServiceContext,
  scope: { projectId: number; environmentId: number },
  schema: unknown,
  content: unknown,
  source: "draft" | "live",
  hop: 1 | 2 = 1,
): Effect.fn.Return<ResolvedReferences, ServiceError> {
  const singles = referenceFields(schema);
  const lists = referenceListFields(schema);
  const result: ResolvedReferences = {};
  if (!singles.length && !lists.length) return result;
  // The first hop already authorized draft access for the nested one.
  if (source === "draft" && hop === 1) {
    const user = yield* requireUser(ctx);
    yield* getAuthorizedProject(ctx.db, scope.projectId, user.id);
  }
  const values = content as Record<string, unknown> | null;
  for (const [name, field] of singles) {
    const definition = yield* activeDefinition(ctx, scope, field);
    result[name] = definition
      ? yield* resolveRecord(ctx, definition, values?.[name], source, hop)
      : null;
  }
  for (const [name, field] of lists) {
    const records: ResolvedReference[] = [];
    result[name] = records;
    const definition = yield* activeDefinition(ctx, scope, field);
    if (!definition) continue;
    // A query-backed list ignores any stored value: code defines its membership and order.
    const query = referenceQuery(field);
    const ids = query
      ? yield* queryRecordIds(ctx, definition, query, source)
      : referenceListIds(values?.[name]);
    // Draft resolves every linked record; live only published ones. Missing records are skipped.
    for (const id of ids) {
      const record = yield* resolveRecord(ctx, definition, id, source, hop);
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

type Definition = typeof collectionDefinitions.$inferSelect;
type Direction = "asc" | "desc";

/**
 * The records a query-backed list resolves to, in order. Draft queries every record and orders
 * by draft content; live queries published records only and orders by their published content.
 * `publishedAt` is a record's first publication, so republishing never reorders it; preview
 * sorts never-published records as published now. Empty text sorts last in either direction,
 * and ties break by record id. Without `orderBy`, records keep their creation order.
 */
function queryRecordIds(
  ctx: ServiceContext,
  definition: Definition,
  query: NormalizedReferenceQuery,
  source: "draft" | "live",
) {
  const { key, direction } = query.orderBy ?? { key: "createdAt", direction: "asc" };
  if (key === "createdAt" || key === "publishedAt") {
    return recordIdsByMetadata(ctx, definition, key, direction, query.limit, source);
  }
  return recordIdsByText(ctx, definition, key, direction, query.limit, source);
}

/** A record's published revision, joined next to the record. */
const publishedRevisions = alias(collectionRevisions, "published_revisions");

/**
 * Orders by record metadata in SQL, so only `limit` ids load. First publications are grouped
 * once for the collection rather than looked up per record.
 */
const recordIdsByMetadata = Effect.fn("collections.recordIdsByMetadata")(function* (
  ctx: ServiceContext,
  definition: Definition,
  key: "createdAt" | "publishedAt",
  direction: Direction,
  limit: number,
  source: "draft" | "live",
) {
  const firstPublications = ctx.db
    .select({
      recordId: collectionRevisions.recordId,
      at: sql<number>`min(${collectionRevisions.createdAt})`.as("first_published_at"),
    })
    .from(collectionRevisions)
    .innerJoin(collectionRecords, eq(collectionRecords.id, collectionRevisions.recordId))
    .where(
      and(
        eq(collectionRecords.definitionId, definition.id),
        eq(collectionRevisions.kind, "auto-publish"),
      ),
    )
    .groupBy(collectionRevisions.recordId)
    .as("first_publications");
  // Falls back to the published revision, then, for never-published drafts, to now.
  const publishedAt = sql`coalesce(${firstPublications.at}, ${publishedRevisions.createdAt}, ${Date.now()})`;
  const sortKey = key === "createdAt" ? collectionRecords.createdAt : publishedAt;
  const rows = yield* Effect.promise(() =>
    ctx.db
      .select({ id: collectionRecords.id })
      .from(collectionRecords)
      .leftJoin(
        publishedRevisions,
        eq(publishedRevisions.id, collectionRecords.publishedRevisionId),
      )
      .leftJoin(firstPublications, eq(firstPublications.recordId, collectionRecords.id))
      .where(
        and(
          eq(collectionRecords.definitionId, definition.id),
          source === "live" ? isNotNull(publishedRevisions.id) : undefined,
        ),
      )
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
  source: "draft" | "live",
) {
  const content = source === "live" ? publishedRevisions.content : collectionRecords.draft;
  const path = `$.${JSON.stringify(key)}`;
  const rows = yield* Effect.promise(() =>
    ctx.db
      .select({
        id: collectionRecords.id,
        value: sql<string | null>`case when json_type(${content}, ${path}) = 'text'
          then json_extract(${content}, ${path}) end`,
      })
      .from(collectionRecords)
      .leftJoin(
        publishedRevisions,
        eq(publishedRevisions.id, collectionRecords.publishedRevisionId),
      )
      .where(
        and(
          eq(collectionRecords.definitionId, definition.id),
          source === "live" ? isNotNull(publishedRevisions.id) : undefined,
        ),
      ),
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

function activeDefinition(
  ctx: ServiceContext,
  scope: { projectId: number; environmentId: number },
  field: Field,
) {
  return Effect.promise(() =>
    ctx.db
      .select()
      .from(collectionDefinitions)
      .where(
        and(
          eq(collectionDefinitions.projectId, scope.projectId),
          eq(collectionDefinitions.environmentId, scope.environmentId),
          eq(collectionDefinitions.collectionId, String(field.collectionId)),
          eq(collectionDefinitions.active, true),
        ),
      )
      .get(),
  );
}

const resolveRecord = Effect.fn("collections.resolveRecord")(function* (
  ctx: ServiceContext,
  definition: typeof collectionDefinitions.$inferSelect,
  id: unknown,
  source: "draft" | "live",
  hop: 1 | 2,
): Effect.fn.Return<ResolvedReference | null, ServiceError> {
  // A record placed at the first hop resolves its own references; the second hop stops.
  const linked = (contentSchema: unknown, content: unknown) =>
    hop === 1
      ? resolveReferences(ctx, definition, contentSchema, content, source, 2).pipe(
          Effect.map((references) => ({ references })),
        )
      : Effect.succeed({});
  const validId = z.uuid().safeParse(id);
  if (!validId.success) return null;
  const record = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(collectionRecords)
      .where(
        and(
          eq(collectionRecords.id, validId.data),
          eq(collectionRecords.definitionId, definition.id),
        ),
      )
      .get(),
  );
  if (!record) return null;
  if (source === "draft") {
    return {
      id: record.id,
      collectionId: definition.collectionId,
      content: record.draft,
      label: lexicalStateToPlainText(record.draft[definition.label] as string),
      contentSchema: definition.contentSchema,
      version: record.version,
      ...(yield* linked(definition.contentSchema, record.draft)),
    } satisfies ResolvedReference;
  }
  const { publishedRevisionId } = record;
  if (!publishedRevisionId) return null;
  const revision = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(collectionRevisions)
      .where(
        and(
          eq(collectionRevisions.id, publishedRevisionId),
          eq(collectionRevisions.recordId, record.id),
        ),
      )
      .get(),
  );
  if (!revision) return null;
  const contentSchema = (revision.definition as { contentSchema: unknown }).contentSchema;
  return {
    id: record.id,
    collectionId: definition.collectionId,
    content: revision.content,
    label: lexicalStateToPlainText(revision.content[String(revision.definition.label)] as string),
    contentSchema,
    revisionId: revision.id,
    ...(yield* linked(contentSchema, revision.content)),
  } satisfies ResolvedReference;
});

const blockDefinitionsIn = Effect.fn("collections.blockDefinitionsIn")(function* (
  ctx: ServiceContext,
  scope: { projectId: number; environmentId: number },
) {
  return yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(blockDefinitions)
      .where(
        and(
          eq(blockDefinitions.projectId, scope.projectId),
          eq(blockDefinitions.environmentId, scope.environmentId),
        ),
      ),
  );
});

export const hydrateReferences = Effect.fn("collections.hydrateReferences")(function* <
  T extends { type: string; content: unknown },
>(
  ctx: ServiceContext,
  scope: { projectId: number; environmentId: number },
  values: T[],
  source: "draft" | "live",
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
        source,
      ).pipe(Effect.map((references) => ({ ...block, references }))),
    { concurrency: "unbounded" },
  );
});

/**
 * Resolves the references of repeatable items, like `hydrateReferences` does for blocks.
 * Each item's schema comes from its block's type and its repeater path.
 */
export const hydrateItemReferences = Effect.fn("collections.hydrateItemReferences")(function* <
  T extends ItemRow & { blockId: number; content: unknown },
>(
  ctx: ServiceContext,
  scope: { projectId: number; environmentId: number },
  blocks: readonly { id: number; type: string }[],
  items: T[],
  source: "draft" | "live",
): Effect.fn.Return<(T & { references: ResolvedReferences })[], ServiceError> {
  if (!items.length) return [];
  const definitions = yield* blockDefinitionsIn(ctx, scope);
  const schemas = new Map<number, unknown>();
  for (const block of blocks) {
    const blockSchema = definitions.find(
      (definition) => definition.blockId === block.type,
    )?.contentSchema;
    const blockItems = items.filter((item) => item.blockId === block.id);
    for (const [id, schema] of itemSchemas(blockSchema, blockItems)) schemas.set(id, schema);
  }
  return yield* Effect.forEach(
    items,
    (item) =>
      resolveReferences(ctx, scope, schemas.get(item.id), item.content, source).pipe(
        Effect.map((references) => ({ ...item, references })),
      ),
    { concurrency: "unbounded" },
  );
});

/**
 * Validates reference values in scope: in `content` itself and, for inline repeatable items
 * (block patches and bundles reconstructed from item seeds), in each item's content too.
 * Item markers (`{ _itemId }`) carry no content of their own here.
 */
export const validateReferenceValues = Effect.fn("collections.validateReferenceValues")(function* (
  ctx: ServiceContext,
  scope: { projectId: number; environmentId: number },
  schema: unknown,
  content: unknown,
  path = "",
): Effect.fn.Return<void, InvalidInputError> {
  const values = content as Record<string, unknown> | null;
  for (const [name, field] of referenceFields(schema)) {
    const value = values?.[name];
    if (value === undefined || value === null) continue;
    if (!(yield* recordInScope(ctx, scope, field, value)))
      return yield* missingReference(path + name);
  }
  for (const [name, field] of referenceListFields(schema)) {
    const value = values?.[name];
    if (value === undefined) continue;
    if (isQueryBacked(field)) {
      return yield* new InvalidInputError({
        message: `${path}${name}: query-backed reference lists are resolved, not written`,
      });
    }
    if (!Array.isArray(value))
      return yield* invalidList(path + name, "must be an array of record ids");
    if (new Set(value).size !== value.length) {
      return yield* invalidList(path + name, "links the same record more than once");
    }
    if (typeof field.maxItems === "number" && value.length > field.maxItems) {
      return yield* invalidList(path + name, `links more than ${field.maxItems} records`);
    }
    for (const id of value) {
      if (!(yield* recordInScope(ctx, scope, field, id)))
        return yield* missingReference(path + name);
    }
  }
  for (const [name, repeater] of repeaterFields(schema)) {
    const items = values?.[name];
    if (!Array.isArray(items)) continue;
    for (const [index, item] of items.entries()) {
      if (!item || typeof item !== "object") continue;
      yield* validateReferenceValues(ctx, scope, repeater.items, item, `${path}${name}[${index}].`);
    }
  }
});

export const recordInScope = Effect.fn("collections.recordInScope")(function* (
  ctx: ServiceContext,
  scope: { projectId: number; environmentId: number },
  field: Field,
  value: unknown,
) {
  const validId = z.uuid().safeParse(value);
  if (!validId.success) return false;
  const record = yield* Effect.promise(() =>
    ctx.db
      .select({ id: collectionRecords.id })
      .from(collectionRecords)
      .innerJoin(
        collectionDefinitions,
        eq(collectionDefinitions.id, collectionRecords.definitionId),
      )
      .where(
        and(
          eq(collectionRecords.id, validId.data),
          eq(collectionDefinitions.projectId, scope.projectId),
          eq(collectionDefinitions.environmentId, scope.environmentId),
          eq(collectionDefinitions.collectionId, String(field.collectionId)),
          eq(collectionDefinitions.active, true),
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
    message: `${name}: reference is missing or outside this collection/project/environment`,
  });
}

export const blockScope = Effect.fn("collections.blockScope")(function* (
  ctx: ServiceContext,
  block: { pageId: number | null; layoutId: number | null },
) {
  const { pageId, layoutId } = block;
  const owner =
    pageId !== null
      ? yield* Effect.promise(() => ctx.db.select().from(pages).where(eq(pages.id, pageId)).get())
      : layoutId !== null
        ? yield* Effect.promise(() =>
            ctx.db.select().from(layouts).where(eq(layouts.id, layoutId)).get(),
          )
        : null;
  if (!owner) return yield* new NotFoundError();
  return { projectId: owner.projectId, environmentId: owner.environmentId };
});

/** Derived dependency status; source edits never mutate page/layout checkpoints. */
export const referenceChanges = Effect.fn("collections.referenceChanges")(function* (
  ctx: ServiceContext,
  environmentId: number,
) {
  const rows = yield* Effect.promise(() =>
    ctx.db.all<{
      page_id: number | null;
      layout_id: number | null;
      draft: string;
      content: string | null;
    }>(sql`select u.page_id, u.layout_id, r.draft, v.content
    from collection_reference_uses u join collection_records r
      on r.id = u.record_id and r.definition_id = u.definition_id
    left join collection_revisions v on v.id = r.published_revision_id
    where u.environment_id = ${environmentId} and u.live = 0`),
  );
  const pageIds = new Set<number>();
  const layoutIds = new Set<number>();
  for (const row of rows) {
    if (
      row.content &&
      stableStringify(JSON.parse(row.draft)) === stableStringify(JSON.parse(row.content))
    )
      continue;
    if (row.page_id !== null) pageIds.add(row.page_id);
    if (row.layout_id !== null) layoutIds.add(row.layout_id);
  }
  return { pageIds, layoutIds };
});
