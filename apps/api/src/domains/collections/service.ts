import { queryKeys } from "@camox/api-contract/query-keys";
import { and, desc, eq, exists, notInArray, sql } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import { assertSyncAccess, getAuthorizedProjectBySlug, requireUser } from "../../authorization";
import { broadcastInvalidation } from "../../lib/broadcast-invalidation";
import { ConflictError, decodeInput, InvalidInputError, NotFoundError } from "../../lib/errors";
import { lexicalStateToPlainText } from "../../lib/lexical-state";
import { resolveEnvironment } from "../../lib/resolve-environment";
import { stableStringify } from "../../lib/stable-stringify";
import { projects } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
import { collectionDefinitions, collectionRecords, collectionRevisions } from "./schema";
import { collectionAdditionDefaults } from "./schema-evolution";
import { collectionDefinitionInput, validateContent } from "./validation";

export const syncCollectionDefinitionsInput = z
  .object({
    projectSlug: z.string(),
    deployToken: z.string().optional(),
    autoCreate: z.boolean(),
    definitions: z.array(collectionDefinitionInput),
  })
  .strict();

/** Sync code-defined collection schemas. */
export const syncCollectionDefinitions = Effect.fn("collections.syncCollectionDefinitions")(
  function* (ctx: ServiceContext, rawInput: z.input<typeof syncCollectionDefinitionsInput>) {
    const input = yield* decodeInput(syncCollectionDefinitionsInput, rawInput);
    for (const definition of input.definitions) {
      definition.contentSchema = JSON.parse(stableStringify(definition.contentSchema));
    }
    if (new Set(input.definitions.map((d) => d.collectionId)).size !== input.definitions.length) {
      return yield* new InvalidInputError({ message: "Duplicate collection IDs" });
    }
    const project = yield* assertSyncAccess(ctx.db, input.projectSlug, {
      user: ctx.user,
      environmentName: ctx.environmentName,
      deployToken: input.deployToken,
    });
    const environment = yield* resolveEnvironment(ctx.db, project.id, ctx.environmentName, {
      autoCreate: input.autoCreate,
    });
    const scope = and(
      eq(collectionDefinitions.projectId, project.id),
      eq(collectionDefinitions.environmentId, environment.id),
    );
    const existing = yield* Effect.promise(() =>
      ctx.db.select().from(collectionDefinitions).where(scope),
    );
    // Validate the whole sync first. Backfills and schema updates then commit in
    // one batch; the DB guard also catches races with first-record creation.
    const backfills = [];
    for (const definition of input.definitions) {
      const previous = existing.find((d) => d.collectionId === definition.collectionId);
      if (
        !previous ||
        stableStringify(previous.contentSchema) === stableStringify(definition.contentSchema)
      )
        continue;
      const record = yield* Effect.promise(() =>
        ctx.db
          .select({ id: collectionRecords.id })
          .from(collectionRecords)
          .where(eq(collectionRecords.definitionId, previous.id))
          .get(),
      );
      if (!record) continue;
      const defaults = JSON.stringify(
        yield* collectionAdditionDefaults(ctx, previous.contentSchema, {
          ...previous,
          contentSchema: definition.contentSchema,
        }),
      );
      backfills.push(
        ctx.db
          .update(collectionRecords)
          .set({
            // Merge only missing keys, including nulls. json_patch would delete
            // null asset fields; json_each also handles arbitrary field names.
            draft: sql`(
            select json_group_object(key, case type
              when 'object' then json(value) when 'array' then json(value)
              when 'true' then json('true') when 'false' then json('false')
              else value end)
            from (
              select key, value, type from json_each(${collectionRecords.draft})
              union all
              select key, value, type from json_each(${defaults}) as addition
              where not exists (
                select 1 from json_each(${collectionRecords.draft}) as current
                where current.key = addition.key
              )
            )
          )`,
            version: sql`${collectionRecords.version} + 1`,
            updatedAt: Date.now(),
          })
          .where(
            and(
              eq(collectionRecords.definitionId, previous.id),
              sql`exists (select 1 from ${collectionDefinitions}
            where ${collectionDefinitions.id} = ${previous.id}
            and ${collectionDefinitions.contentSchema} = ${JSON.stringify(previous.contentSchema)})`,
              sql`exists (select 1 from json_each(${defaults}) as addition
            where not exists (select 1 from json_each(${collectionRecords.draft}) as current
              where current.key = addition.key))`,
            ),
          ),
      );
    }
    const statements = [
      ctx.db
        .update(collectionDefinitions)
        .set({ active: false })
        .where(
          and(
            scope,
            input.definitions.length
              ? notInArray(
                  collectionDefinitions.collectionId,
                  input.definitions.map((definition) => definition.collectionId),
                )
              : undefined,
          ),
        ),
      ...backfills,
      ...input.definitions.map((definition) =>
        ctx.db
          .insert(collectionDefinitions)
          .values({
            ...definition,
            projectId: project.id,
            environmentId: environment.id,
            active: true,
          })
          .onConflictDoUpdate({
            target: [
              collectionDefinitions.projectId,
              collectionDefinitions.environmentId,
              collectionDefinitions.collectionId,
            ],
            set: { ...definition, active: true },
          }),
      ),
    ] as const;
    yield* Effect.promise(() => ctx.db.batch(statements));
    broadcastInvalidation({
      waitUntil: ctx.waitUntil,
      projectRoomNamespace: ctx.env.ProjectRoom,
      projectId: project.id,
      targets: [
        ["camox", "collections"],
        ["camox", "blocks"],
        queryKeys.pages.getByPathAll,
        queryKeys.pages.list,
        queryKeys.layouts.all,
      ],
    });
    return {
      count: input.definitions.length,
      retired: existing
        .filter(
          (d) => !input.definitions.some((incoming) => incoming.collectionId === d.collectionId),
        )
        .map((d) => d.collectionId),
    };
  },
);

export const listCollectionDefinitionsInput = z.object({ projectSlug: z.string() }).strict();
export const listCollectionRecordsInput = listCollectionDefinitionsInput.extend({
  collectionId: z.string(),
});
export const getCollectionDefinitionInput = listCollectionRecordsInput;
const scopeInput = listCollectionRecordsInput;
const recordInput = scopeInput.extend({ id: z.uuid() });
const mutationInput = recordInput.extend({ expectedVersion: z.number().int().positive() });
export const getCollectionRecordInput = recordInput;
export const createRecordInput = scopeInput.extend({ content: z.unknown() });
export const editRecordInput = mutationInput.extend({ content: z.unknown() });
export const deleteRecordInput = mutationInput;
export const publishRecordInput = mutationInput;
export const unpublishRecordInput = mutationInput;
export const discardRecordInput = mutationInput;

export const getCollectionRecord = Effect.fn("collections.getCollectionRecord")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getCollectionRecordInput>,
) {
  const input = yield* decodeInput(getCollectionRecordInput, rawInput);
  const { definition, record } = yield* recordFor(ctx, input, true);
  if (!definition.active || !record) return yield* new NotFoundError();
  return record;
});

export const listCollectionDefinitions = Effect.fn("collections.listCollectionDefinitions")(
  function* (ctx: ServiceContext, rawInput: z.input<typeof listCollectionDefinitionsInput>) {
    const input = yield* decodeInput(listCollectionDefinitionsInput, rawInput);
    const user = yield* requireUser(ctx);
    const project = yield* getAuthorizedProjectBySlug(ctx.db, input.projectSlug, user.id);
    const environment = yield* resolveEnvironment(ctx.db, project.id, ctx.environmentName);
    return yield* Effect.promise(() =>
      ctx.db
        .select({
          collectionId: collectionDefinitions.collectionId,
          title: collectionDefinitions.title,
          description: collectionDefinitions.description,
          label: collectionDefinitions.label,
        })
        .from(collectionDefinitions)
        .where(
          and(
            eq(collectionDefinitions.projectId, project.id),
            eq(collectionDefinitions.environmentId, environment.id),
            eq(collectionDefinitions.active, true),
          ),
        )
        // Definitions have no creation timestamp; their auto-increment ID preserves creation order.
        .orderBy(desc(collectionDefinitions.id)),
    );
  },
);

export const getCollectionDefinition = Effect.fn("collections.getCollectionDefinition")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getCollectionDefinitionInput>,
) {
  const input = yield* decodeInput(getCollectionDefinitionInput, rawInput);
  const definition = yield* definitionFor(ctx, input, true);
  if (!definition.active) return yield* new NotFoundError();
  const { collectionId, title, description, label, contentSchema } = definition;
  return { collectionId, title, description, label, contentSchema };
});

/** Studio reads current drafts only; public/live reads remain separate. */
export const listCollectionRecords = Effect.fn("collections.listCollectionRecords")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof listCollectionRecordsInput>,
) {
  const input = yield* decodeInput(listCollectionRecordsInput, rawInput);
  const definition = yield* definitionFor(ctx, input, true);
  if (!definition.active) return yield* new NotFoundError();
  const records = yield* Effect.promise(() =>
    ctx.db
      .select({
        id: collectionRecords.id,
        content: collectionRecords.draft,
        version: collectionRecords.version,
        publishedContent: collectionRevisions.content,
      })
      .from(collectionRecords)
      .leftJoin(
        collectionRevisions,
        eq(collectionRecords.publishedRevisionId, collectionRevisions.id),
      )
      .where(eq(collectionRecords.definitionId, definition.id))
      .orderBy(desc(collectionRecords.createdAt), desc(collectionRecords.id)),
  );
  return records.map((record) => ({
    id: record.id,
    version: record.version,
    status: recordStatus(record.content, record.publishedContent),
    label: lexicalStateToPlainText(
      record.content[definition.label] as string | Record<string, unknown>,
    ),
  }));
});

function recordStatus(draft: unknown, published: unknown): "draft" | "modified" | "published" {
  if (published == null) return "draft";
  return stableStringify(draft) === stableStringify(published) ? "published" : "modified";
}

const definitionFor = Effect.fn("collections.definitionFor")(function* (
  ctx: ServiceContext,
  input: z.infer<typeof scopeInput>,
  authorized: boolean,
) {
  const user = authorized ? yield* requireUser(ctx) : null;
  const project = user
    ? yield* getAuthorizedProjectBySlug(ctx.db, input.projectSlug, user.id)
    : yield* Effect.promise(() =>
        ctx.db.select().from(projects).where(eq(projects.slug, input.projectSlug)).get(),
      );
  if (!project) return yield* new NotFoundError();
  const environment = yield* resolveEnvironment(ctx.db, project.id, ctx.environmentName);
  const definition = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(collectionDefinitions)
      .where(
        and(
          eq(collectionDefinitions.projectId, project.id),
          eq(collectionDefinitions.environmentId, environment.id),
          eq(collectionDefinitions.collectionId, input.collectionId),
        ),
      )
      .get(),
  );
  if (!definition) return yield* new NotFoundError();
  return definition;
});

const recordFor = Effect.fn("collections.recordFor")(function* (
  ctx: ServiceContext,
  input: z.infer<typeof recordInput>,
  authorized: boolean,
) {
  const definition = yield* definitionFor(ctx, input, authorized);
  const record = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(collectionRecords)
      .where(
        and(eq(collectionRecords.id, input.id), eq(collectionRecords.definitionId, definition.id)),
      )
      .get(),
  );
  return { definition, record };
});

function assertActive(definition: typeof collectionDefinitions.$inferSelect) {
  if (definition.active) return Effect.void;
  return Effect.fail(new ConflictError({ message: "Collection definition is retired" }));
}

export const createRecord = Effect.fn("collections.createRecord")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof scopeInput> & { content: unknown },
) {
  const input = yield* decodeInput(createRecordInput, rawInput);
  const definition = yield* definitionFor(ctx, input, true);
  yield* assertActive(definition);
  const draft = yield* validateContent(ctx, definition, input.content);
  const now = Date.now();
  // INSERT SELECT closes the race with syncing a schema while its first record is
  // being validated. Once inserted, the schema-change DB guard owns this invariant.
  const record = yield* Effect.promise(() =>
    ctx.db
      .insert(collectionRecords)
      .select(
        ctx.db
          .select({
            id: sql<string>`${crypto.randomUUID()}`.as("id"),
            definitionId: collectionDefinitions.id,
            draft: sql<Record<string, unknown>>`${JSON.stringify(draft)}`.as("draft"),
            version: sql<number>`1`.as("version"),
            publishedRevisionId: sql<string | null>`null`.as("published_revision_id"),
            createdAt: sql<number>`${now}`.as("created_at"),
            updatedAt: sql<number>`${now}`.as("updated_at"),
          })
          .from(collectionDefinitions)
          .where(
            and(
              eq(collectionDefinitions.id, definition.id),
              eq(collectionDefinitions.active, true),
              sql`${collectionDefinitions.contentSchema} = ${JSON.stringify(definition.contentSchema)}`,
            ),
          ),
      )
      .returning()
      .get(),
  );
  if (!record)
    return yield* new ConflictError({ message: "Collection definition changed; retry creation" });
  invalidateRecord(ctx, definition, input, record.id);
  return record;
});

function invalidateRecord(
  ctx: ServiceContext,
  definition: { projectId: number },
  scope: z.infer<typeof scopeInput>,
  id: string,
) {
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    projectId: definition.projectId,
    targets: [
      queryKeys.collections.records(scope.projectSlug, ctx.environmentName, scope.collectionId),
      queryKeys.collections.record(scope.projectSlug, ctx.environmentName, scope.collectionId, id),
      ["camox", "blocks"],
      queryKeys.pages.getByPathAll,
      queryKeys.pages.list,
      queryKeys.layouts.all,
    ],
  });
}

/** Live results deliberately omit draft, draft version, and mutable definition metadata. */
export const readRecord = Effect.fn("collections.readRecord")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof recordInput> & { source?: "live" | "draft" | { revisionId: string } },
) {
  const input = yield* decodeInput(
    recordInput.extend({
      source: z
        .union([z.literal("live"), z.literal("draft"), z.object({ revisionId: z.uuid() }).strict()])
        .default("live"),
    }),
    rawInput,
  );
  const { definition, record } = yield* recordFor(ctx, input, input.source !== "live");
  if (!record) return null;
  if (input.source === "draft") return record;
  if (input.source === "live" && (!definition.active || !record.publishedRevisionId)) return null;
  const revisionId =
    input.source === "live" ? record.publishedRevisionId! : input.source.revisionId;
  return (
    (yield* Effect.promise(() =>
      ctx.db
        .select()
        .from(collectionRevisions)
        .where(
          and(eq(collectionRevisions.id, revisionId), eq(collectionRevisions.recordId, record.id)),
        )
        .get(),
    )) ?? null
  );
});

const mutation = Effect.fn("collections.mutation")(function* (
  ctx: ServiceContext,
  input: z.infer<typeof mutationInput>,
) {
  const { definition, record } = yield* recordFor(ctx, input, true);
  if (!record) return yield* new NotFoundError();
  yield* assertActive(definition);
  if (record.version !== input.expectedVersion)
    return yield* new ConflictError({ message: "Record changed; reload before retrying" });
  return { definition, record };
});

const update = Effect.fn("collections.update")(function* (
  ctx: ServiceContext,
  definition: typeof collectionDefinitions.$inferSelect,
  record: typeof collectionRecords.$inferSelect,
  values: Partial<typeof collectionRecords.$inferInsert>,
) {
  const result = yield* Effect.promise(() =>
    ctx.db
      .update(collectionRecords)
      .set({
        ...values,
        version: record.version + 1,
        updatedAt: Date.now(),
      })
      .where(
        and(
          eq(collectionRecords.id, record.id),
          eq(collectionRecords.version, record.version),
          sql`exists (select 1 from ${collectionDefinitions}
          where ${collectionDefinitions.id} = ${record.definitionId}
          and ${collectionDefinitions.active} = 1
          and ${collectionDefinitions.contentSchema} = ${JSON.stringify(definition.contentSchema)})`,
        ),
      )
      .returning()
      .get(),
  );
  if (!result)
    return yield* new ConflictError({
      message: "Record or definition changed; reload before retrying",
    });
  return result;
});

export const editRecord = Effect.fn("collections.editRecord")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof mutationInput> & { content: unknown },
) {
  const input = yield* decodeInput(editRecordInput, rawInput);
  const { definition, record } = yield* mutation(ctx, input);
  const draft = yield* validateContent(ctx, definition, input.content);
  const updated = yield* update(ctx, definition, record, { draft });
  invalidateRecord(ctx, definition, input, record.id);
  return updated;
});

export const deleteRecord = Effect.fn("collections.deleteRecord")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof deleteRecordInput>,
) {
  const input = yield* decodeInput(deleteRecordInput, rawInput);
  const { definition, record } = yield* mutation(ctx, input);
  yield* assertReferenceRemoval(ctx, record.id, false);
  const guard = and(
    eq(collectionRecords.id, record.id),
    eq(collectionRecords.version, input.expectedVersion),
    sql`exists (select 1 from ${collectionDefinitions} where ${collectionDefinitions.id} = ${record.definitionId} and ${collectionDefinitions.active} = 1)`,
  );
  // D1 batches are atomic. Every step is guarded, so a concurrent edit cannot
  // leave a partially deleted item or remove its history on a version conflict.
  const [, , deleted] = yield* Effect.promise(() =>
    ctx.db.batch([
      ctx.db.update(collectionRecords).set({ publishedRevisionId: null }).where(guard),
      ctx.db
        .delete(collectionRevisions)
        .where(
          and(
            eq(collectionRevisions.recordId, record.id),
            exists(
              ctx.db.select({ id: collectionRecords.id }).from(collectionRecords).where(guard),
            ),
          ),
        ),
      ctx.db.delete(collectionRecords).where(guard).returning({ id: collectionRecords.id }),
    ]),
  );
  if (!deleted.length) {
    return yield* new ConflictError({
      message: "Record or definition changed; reload before retrying",
    });
  }
  invalidateRecord(ctx, definition, input, record.id);
  return { id: record.id };
});

const snapshot = Effect.fn("collections.snapshot")(function* (
  ctx: ServiceContext,
  definition: typeof collectionDefinitions.$inferSelect,
  record: typeof collectionRecords.$inferSelect,
  kind: typeof collectionRevisions.$inferInsert.kind,
) {
  return yield* Effect.promise(() =>
    ctx.db
      .insert(collectionRevisions)
      .values({
        id: crypto.randomUUID(),
        recordId: record.id,
        content: record.draft,
        definition,
        kind,
        createdBy: ctx.user!.id,
        createdAt: Date.now(),
      })
      .returning()
      .get(),
  );
});

export const checkpointRecord = Effect.fn("collections.checkpointRecord")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof mutationInput>,
) {
  const input = yield* decodeInput(mutationInput, rawInput);
  const { definition, record } = yield* mutation(ctx, input);
  const revision = yield* snapshot(ctx, definition, record, "manual");
  const updated = yield* update(ctx, definition, record, {});
  return { record: updated, revision };
});

export const publishRecord = Effect.fn("collections.publishRecord")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof mutationInput>,
) {
  const input = yield* decodeInput(mutationInput, rawInput);
  const { definition, record } = yield* mutation(ctx, input);
  yield* validateContent(ctx, definition, record.draft);
  const revision = yield* snapshot(ctx, definition, record, "auto-publish");
  const updated = yield* update(ctx, definition, record, { publishedRevisionId: revision.id });
  invalidateRecord(ctx, definition, input, record.id);
  return { record: updated, revision };
});

export const unpublishRecord = Effect.fn("collections.unpublishRecord")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof mutationInput>,
) {
  const input = yield* decodeInput(mutationInput, rawInput);
  const { definition, record } = yield* mutation(ctx, input);
  yield* assertReferenceRemoval(ctx, record.id, true);
  const updated = yield* update(ctx, definition, record, { publishedRevisionId: null });
  invalidateRecord(ctx, definition, input, record.id);
  return updated;
});

const assertReferenceRemoval = Effect.fn("collections.assertReferenceRemoval")(function* (
  ctx: ServiceContext,
  id: string,
  unpublish: boolean,
) {
  const usage = yield* Effect.promise(() =>
    ctx.db.get(sql`select 1 from collection_reference_uses
    where record_id = ${id} ${unpublish ? sql`and live = 1 and required = 1` : sql``} limit 1`),
  );
  if (usage)
    return yield* new ConflictError({
      message: unpublish
        ? "Item is required by published content"
        : "Remove this item's draft and published references before deleting it",
    });
});

export const restoreRecord = Effect.fn("collections.restoreRecord")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof mutationInput> & { revisionId: string },
) {
  const input = yield* decodeInput(mutationInput.extend({ revisionId: z.uuid() }), rawInput);
  const { definition, record } = yield* mutation(ctx, input);
  const revision = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(collectionRevisions)
      .where(
        and(
          eq(collectionRevisions.id, input.revisionId),
          eq(collectionRevisions.recordId, record.id),
        ),
      )
      .get(),
  );
  if (!revision) return yield* new NotFoundError();
  if (revision.schemaVersion !== 1)
    return yield* new ConflictError({ message: "Unsupported snapshot version" });
  const defaults = yield* collectionAdditionDefaults(
    ctx,
    revision.definition.contentSchema,
    definition,
  );
  const draft = { ...defaults, ...revision.content };
  yield* validateContent(ctx, definition, draft);
  const displaced = yield* snapshot(ctx, definition, record, "auto-draft");
  return { record: yield* update(ctx, definition, record, { draft }), displaced };
});

export const discardRecord = Effect.fn("collections.discardRecord")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof discardRecordInput>,
) {
  const input = yield* decodeInput(discardRecordInput, rawInput);
  const { definition, record } = yield* mutation(ctx, input);
  if (!record.publishedRevisionId)
    return yield* new ConflictError({
      message: "Unpublished items have no published draft to restore",
    });
  const result = yield* restoreRecord(ctx, { ...input, revisionId: record.publishedRevisionId });
  invalidateRecord(ctx, definition, input, record.id);
  return result.record;
});
