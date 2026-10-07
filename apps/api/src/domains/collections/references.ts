import { and, eq, sql } from "drizzle-orm";
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

/** Only top-level references and reference lists are supported; fail closed for other shapes. */
export function validateReferenceSchema(schema: unknown, allow = true) {
  const allowed = new Set(
    [...referenceFields(schema), ...referenceListFields(schema)].map(([, field]) => field),
  );
  function visit(value: unknown): InvalidInputError | undefined {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const child of value) {
        const error = visit(child);
        if (error) return error;
      }
      return;
    }
    const field = value as Field;
    const kind = field.kind ?? field.fieldType;
    if (kind === "ReferenceList" || kind === "Reference") {
      if (!allow || field.fieldType !== kind || !allowed.has(field)) {
        return new InvalidInputError({
          message: "Only top-level block references and reference lists are supported",
        });
      }
      if (typeof field.collectionId !== "string" || !field.collectionId) {
        return new InvalidInputError({ message: "Reference requires collectionId" });
      }
    }
    for (const child of Object.values(field)) {
      const error = visit(child);
      if (error) return error;
    }
  }
  const error = visit(schema);
  return error ? Effect.fail(error) : Effect.void;
}

export const resolveReferences = Effect.fn("collections.resolveReferences")(function* (
  ctx: ServiceContext,
  scope: { projectId: number; environmentId: number },
  schema: unknown,
  content: unknown,
  source: "draft" | "live",
) {
  const singles = referenceFields(schema);
  const lists = referenceListFields(schema);
  const result: ResolvedReferences = {};
  if (!singles.length && !lists.length) return result;
  if (source === "draft") {
    const user = yield* requireUser(ctx);
    yield* getAuthorizedProject(ctx.db, scope.projectId, user.id);
  }
  const values = content as Record<string, unknown> | null;
  for (const [name, field] of singles) {
    const definition = yield* activeDefinition(ctx, scope, field);
    result[name] = definition
      ? yield* resolveRecord(ctx, definition, values?.[name], source)
      : null;
  }
  for (const [name, field] of lists) {
    const records: ResolvedReference[] = [];
    result[name] = records;
    const definition = yield* activeDefinition(ctx, scope, field);
    if (!definition) continue;
    // Draft resolves every linked record; live only published ones. Missing records are skipped.
    for (const id of referenceListIds(values?.[name])) {
      const record = yield* resolveRecord(ctx, definition, id, source);
      if (record) records.push(record);
    }
  }
  return result;
});

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
) {
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
  return {
    id: record.id,
    collectionId: definition.collectionId,
    content: revision.content,
    label: lexicalStateToPlainText(revision.content[String(revision.definition.label)] as string),
    contentSchema: (revision.definition as { contentSchema: unknown }).contentSchema,
    revisionId: revision.id,
  } satisfies ResolvedReference;
});

export const hydrateReferences = Effect.fn("collections.hydrateReferences")(function* <
  T extends { type: string; content: unknown },
>(
  ctx: ServiceContext,
  scope: { projectId: number; environmentId: number },
  values: T[],
  source: "draft" | "live",
): Effect.fn.Return<(T & { references: ResolvedReferences })[], ServiceError> {
  const definitions = yield* Effect.promise(() =>
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

export const validateReferenceValues = Effect.fn("collections.validateReferenceValues")(function* (
  ctx: ServiceContext,
  scope: { projectId: number; environmentId: number },
  schema: unknown,
  content: unknown,
) {
  const values = content as Record<string, unknown> | null;
  for (const [name, field] of referenceFields(schema)) {
    const value = values?.[name];
    if (value === undefined || value === null) continue;
    if (!(yield* recordInScope(ctx, scope, field, value))) return yield* missingReference(name);
  }
  for (const [name, field] of referenceListFields(schema)) {
    const value = values?.[name];
    if (value === undefined) continue;
    if (!Array.isArray(value)) return yield* invalidList(name, "must be an array of record ids");
    if (new Set(value).size !== value.length) {
      return yield* invalidList(name, "links the same record more than once");
    }
    if (typeof field.maxItems === "number" && value.length > field.maxItems) {
      return yield* invalidList(name, `links more than ${field.maxItems} records`);
    }
    for (const id of value) {
      if (!(yield* recordInScope(ctx, scope, field, id))) return yield* missingReference(name);
    }
  }
});

const recordInScope = Effect.fn("collections.recordInScope")(function* (
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

function missingReference(name: string) {
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
