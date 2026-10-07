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

export function referenceFields(schema: unknown): [string, Field][] {
  const properties = (schema as { properties?: Record<string, Field> } | null)?.properties;
  return Object.entries(properties ?? {}).filter(([, field]) => field.fieldType === "Reference");
}

/** Only direct single references are supported; fail closed for future shapes. */
export function validateReferenceSchema(schema: unknown, allow = true) {
  const allowed = new Set(referenceFields(schema).map(([, field]) => field));
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
      if (!allow || field.fieldType !== "Reference" || !allowed.has(field)) {
        return new InvalidInputError({
          message: "Only top-level single block references are supported",
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
  const fields = referenceFields(schema);
  const result: Record<string, ResolvedReference | null> = {};
  if (!fields.length) return result;
  if (source === "draft") {
    const user = yield* requireUser(ctx);
    yield* getAuthorizedProject(ctx.db, scope.projectId, user.id);
  }
  for (const [name, field] of fields) {
    result[name] = null;
    const id = (content as Record<string, unknown> | null)?.[name];
    if (!z.uuid().safeParse(id).success) continue;
    const definition = yield* Effect.promise(() =>
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
    if (!definition) continue;
    const record = yield* Effect.promise(() =>
      ctx.db
        .select()
        .from(collectionRecords)
        .where(
          and(
            eq(collectionRecords.id, id as string),
            eq(collectionRecords.definitionId, definition.id),
          ),
        )
        .get(),
    );
    if (!record) continue;
    if (source === "draft") {
      result[name] = {
        id: record.id,
        collectionId: definition.collectionId,
        content: record.draft,
        label: lexicalStateToPlainText(record.draft[definition.label] as string),
        contentSchema: definition.contentSchema,
        version: record.version,
      };
      continue;
    }
    const { publishedRevisionId } = record;
    if (!publishedRevisionId) continue;
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
    if (!revision) continue;
    result[name] = {
      id: record.id,
      collectionId: definition.collectionId,
      content: revision.content,
      label: lexicalStateToPlainText(revision.content[String(revision.definition.label)] as string),
      contentSchema: (revision.definition as { contentSchema: unknown }).contentSchema,
      revisionId: revision.id,
    };
  }
  return result;
});

export const hydrateReferences = Effect.fn("collections.hydrateReferences")(function* <
  T extends { type: string; content: unknown },
>(
  ctx: ServiceContext,
  scope: { projectId: number; environmentId: number },
  values: T[],
  source: "draft" | "live",
): Effect.fn.Return<
  (T & { references: Record<string, ResolvedReference | null> })[],
  ServiceError
> {
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
  for (const [name, field] of referenceFields(schema)) {
    const value = (content as Record<string, unknown> | null)?.[name];
    if (value === undefined || value === null) continue;
    const validId = z.uuid().safeParse(value);
    if (!validId.success) return yield* missingReference(name);
    const recordId = validId.data;
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
            eq(collectionRecords.id, recordId),
            eq(collectionDefinitions.projectId, scope.projectId),
            eq(collectionDefinitions.environmentId, scope.environmentId),
            eq(collectionDefinitions.collectionId, String(field.collectionId)),
            eq(collectionDefinitions.active, true),
          ),
        )
        .get(),
    );
    if (!record) return yield* missingReference(name);
  }
});

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
