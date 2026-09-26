import { queryKeys } from "@camox/api-contract/query-keys";
import { ORPCError } from "@orpc/server";
import { and, desc, eq, exists, sql } from "drizzle-orm";
import { z } from "zod";

import { assertSyncAccess, getAuthorizedProjectBySlug } from "../../authorization";
import { broadcastInvalidation } from "../../lib/broadcast-invalidation";
import { lexicalStateToPlainText } from "../../lib/lexical-state";
import { resolveEnvironment } from "../../lib/resolve-environment";
import { stableStringify } from "../../lib/stable-stringify";
import { projects } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
import { collectionDefinitions, collectionRecords, collectionRevisions } from "./schema";
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
export async function syncCollectionDefinitions(
  ctx: ServiceContext,
  rawInput: z.input<typeof syncCollectionDefinitionsInput>,
) {
  const input = syncCollectionDefinitionsInput.parse(rawInput);
  for (const definition of input.definitions) {
    definition.contentSchema = JSON.parse(stableStringify(definition.contentSchema));
  }
  if (new Set(input.definitions.map((d) => d.collectionId)).size !== input.definitions.length) {
    throw new ORPCError("BAD_REQUEST", { message: "Duplicate collection IDs" });
  }
  const project = await assertSyncAccess(ctx.db, input.projectSlug, {
    user: ctx.user,
    environmentName: ctx.environmentName,
    deployToken: input.deployToken,
  });
  const environment = await resolveEnvironment(ctx.db, project.id, ctx.environmentName, {
    autoCreate: input.autoCreate,
  });
  const scope = and(
    eq(collectionDefinitions.projectId, project.id),
    eq(collectionDefinitions.environmentId, environment.id),
  );
  const existing = await ctx.db.select().from(collectionDefinitions).where(scope);
  // Validate the whole sync before making changes. The DB trigger also guards races
  // with record creation; schema evolution must never invalidate stored content.
  for (const definition of input.definitions) {
    const previous = existing.find((d) => d.collectionId === definition.collectionId);
    if (
      !previous ||
      stableStringify(previous.contentSchema) === stableStringify(definition.contentSchema)
    )
      continue;
    const record = await ctx.db
      .select({ id: collectionRecords.id })
      .from(collectionRecords)
      .where(eq(collectionRecords.definitionId, previous.id))
      .get();
    if (record)
      throw new ORPCError("CONFLICT", {
        message: `Collection "${definition.collectionId}" has records; schema migration is not supported yet`,
      });
  }
  const statements = [
    ctx.db.update(collectionDefinitions).set({ active: false }).where(scope),
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
  await ctx.db.batch(statements);
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    projectId: project.id,
    targets: [queryKeys.collections.list(input.projectSlug, ctx.environmentName)],
  });
  return {
    count: input.definitions.length,
    retired: existing
      .filter(
        (d) => !input.definitions.some((incoming) => incoming.collectionId === d.collectionId),
      )
      .map((d) => d.collectionId),
  };
}

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

export async function getCollectionRecord(
  ctx: ServiceContext,
  rawInput: z.input<typeof getCollectionRecordInput>,
) {
  const input = getCollectionRecordInput.parse(rawInput);
  const { definition, record } = await recordFor(ctx, input, true);
  if (!definition.active || !record) throw new ORPCError("NOT_FOUND");
  return record;
}

export async function listCollectionDefinitions(
  ctx: ServiceContext,
  rawInput: z.input<typeof listCollectionDefinitionsInput>,
) {
  const input = listCollectionDefinitionsInput.parse(rawInput);
  if (!ctx.user) throw new ORPCError("UNAUTHORIZED");
  const project = await getAuthorizedProjectBySlug(ctx.db, input.projectSlug, ctx.user.id);
  if (!project) throw new ORPCError("NOT_FOUND");
  const environment = await resolveEnvironment(ctx.db, project.id, ctx.environmentName);
  return (
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
      .orderBy(desc(collectionDefinitions.id))
  );
}

export async function getCollectionDefinition(
  ctx: ServiceContext,
  rawInput: z.input<typeof getCollectionDefinitionInput>,
) {
  const input = getCollectionDefinitionInput.parse(rawInput);
  const definition = await definitionFor(ctx, input, true);
  if (!definition.active) throw new ORPCError("NOT_FOUND");
  const { collectionId, title, description, label, contentSchema } = definition;
  return { collectionId, title, description, label, contentSchema };
}

/** Studio reads current drafts only; public/live reads remain separate. */
export async function listCollectionRecords(
  ctx: ServiceContext,
  rawInput: z.input<typeof listCollectionRecordsInput>,
) {
  const input = listCollectionRecordsInput.parse(rawInput);
  const definition = await definitionFor(ctx, input, true);
  if (!definition.active) throw new ORPCError("NOT_FOUND");
  const records = await ctx.db
    .select({
      id: collectionRecords.id,
      content: collectionRecords.draft,
      version: collectionRecords.version,
    })
    .from(collectionRecords)
    .where(eq(collectionRecords.definitionId, definition.id))
    .orderBy(desc(collectionRecords.createdAt), desc(collectionRecords.id));
  return records.map((record) => ({
    id: record.id,
    version: record.version,
    label: lexicalStateToPlainText(
      record.content[definition.label] as string | Record<string, unknown>,
    ),
  }));
}

async function definitionFor(
  ctx: ServiceContext,
  input: z.infer<typeof scopeInput>,
  authorized: boolean,
) {
  if (authorized && !ctx.user) throw new ORPCError("UNAUTHORIZED");
  const project = authorized
    ? await getAuthorizedProjectBySlug(ctx.db, input.projectSlug, ctx.user!.id)
    : await ctx.db.select().from(projects).where(eq(projects.slug, input.projectSlug)).get();
  if (!project) throw new ORPCError("NOT_FOUND");
  const environment = await resolveEnvironment(ctx.db, project.id, ctx.environmentName);
  const definition = await ctx.db
    .select()
    .from(collectionDefinitions)
    .where(
      and(
        eq(collectionDefinitions.projectId, project.id),
        eq(collectionDefinitions.environmentId, environment.id),
        eq(collectionDefinitions.collectionId, input.collectionId),
      ),
    )
    .get();
  if (!definition) throw new ORPCError("NOT_FOUND");
  return definition;
}

async function recordFor(
  ctx: ServiceContext,
  input: z.infer<typeof recordInput>,
  authorized: boolean,
) {
  const definition = await definitionFor(ctx, input, authorized);
  const record = await ctx.db
    .select()
    .from(collectionRecords)
    .where(
      and(eq(collectionRecords.id, input.id), eq(collectionRecords.definitionId, definition.id)),
    )
    .get();
  return { definition, record };
}

function assertActive(definition: typeof collectionDefinitions.$inferSelect) {
  if (!definition.active)
    throw new ORPCError("CONFLICT", { message: "Collection definition is retired" });
}

export async function createRecord(
  ctx: ServiceContext,
  rawInput: z.input<typeof scopeInput> & { content: unknown },
) {
  const input = createRecordInput.parse(rawInput);
  const definition = await definitionFor(ctx, input, true);
  assertActive(definition);
  const draft = await validateContent(ctx, definition, input.content);
  const now = Date.now();
  // INSERT SELECT closes the race with syncing a schema while its first record is
  // being validated. Once inserted, the schema-change DB guard owns this invariant.
  const record = await ctx.db
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
    .get();
  if (!record)
    throw new ORPCError("CONFLICT", { message: "Collection definition changed; retry creation" });
  invalidateRecord(ctx, definition, input, record.id);
  return record;
}

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
    ],
  });
}

/** Live results deliberately omit draft, draft version, and mutable definition metadata. */
export async function readRecord(
  ctx: ServiceContext,
  rawInput: z.input<typeof recordInput> & { source?: "live" | "draft" | { revisionId: string } },
) {
  const input = recordInput
    .extend({
      source: z
        .union([z.literal("live"), z.literal("draft"), z.object({ revisionId: z.uuid() }).strict()])
        .default("live"),
    })
    .parse(rawInput);
  const { definition, record } = await recordFor(ctx, input, input.source !== "live");
  if (!record) return null;
  if (input.source === "draft") return record;
  if (input.source === "live" && (!definition.active || !record.publishedRevisionId)) return null;
  const revisionId =
    input.source === "live" ? record.publishedRevisionId! : input.source.revisionId;
  return (
    (await ctx.db
      .select()
      .from(collectionRevisions)
      .where(
        and(eq(collectionRevisions.id, revisionId), eq(collectionRevisions.recordId, record.id)),
      )
      .get()) ?? null
  );
}

async function mutation(ctx: ServiceContext, input: z.infer<typeof mutationInput>) {
  const { definition, record } = await recordFor(ctx, input, true);
  if (!record) throw new ORPCError("NOT_FOUND");
  assertActive(definition);
  if (record.version !== input.expectedVersion)
    throw new ORPCError("CONFLICT", { message: "Record changed; reload before retrying" });
  return { definition, record };
}

async function update(
  ctx: ServiceContext,
  record: typeof collectionRecords.$inferSelect,
  values: Partial<typeof collectionRecords.$inferInsert>,
) {
  const result = await ctx.db
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
        sql`exists (select 1 from ${collectionDefinitions} where ${collectionDefinitions.id} = ${record.definitionId} and ${collectionDefinitions.active} = 1)`,
      ),
    )
    .returning()
    .get();
  if (!result)
    throw new ORPCError("CONFLICT", {
      message: "Record or definition changed; reload before retrying",
    });
  return result;
}

export async function editRecord(
  ctx: ServiceContext,
  rawInput: z.input<typeof mutationInput> & { content: unknown },
) {
  const input = editRecordInput.parse(rawInput);
  const { definition, record } = await mutation(ctx, input);
  const draft = await validateContent(ctx, definition, input.content);
  const updated = await update(ctx, record, { draft });
  invalidateRecord(ctx, definition, input, record.id);
  return updated;
}

export async function deleteRecord(
  ctx: ServiceContext,
  rawInput: z.input<typeof deleteRecordInput>,
) {
  const input = deleteRecordInput.parse(rawInput);
  const { definition, record } = await mutation(ctx, input);
  const guard = and(
    eq(collectionRecords.id, record.id),
    eq(collectionRecords.version, input.expectedVersion),
    sql`exists (select 1 from ${collectionDefinitions} where ${collectionDefinitions.id} = ${record.definitionId} and ${collectionDefinitions.active} = 1)`,
  );
  // D1 batches are atomic. Every step is guarded, so a concurrent edit cannot
  // leave a partially deleted item or remove its history on a version conflict.
  const [, , deleted] = await ctx.db.batch([
    ctx.db.update(collectionRecords).set({ publishedRevisionId: null }).where(guard),
    ctx.db
      .delete(collectionRevisions)
      .where(
        and(
          eq(collectionRevisions.recordId, record.id),
          exists(ctx.db.select({ id: collectionRecords.id }).from(collectionRecords).where(guard)),
        ),
      ),
    ctx.db.delete(collectionRecords).where(guard).returning({ id: collectionRecords.id }),
  ]);
  if (!deleted.length) {
    throw new ORPCError("CONFLICT", {
      message: "Record or definition changed; reload before retrying",
    });
  }
  invalidateRecord(ctx, definition, input, record.id);
  return { id: record.id };
}

async function snapshot(
  ctx: ServiceContext,
  definition: typeof collectionDefinitions.$inferSelect,
  record: typeof collectionRecords.$inferSelect,
  kind: typeof collectionRevisions.$inferInsert.kind,
) {
  return ctx.db
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
    .get();
}

export async function checkpointRecord(
  ctx: ServiceContext,
  rawInput: z.input<typeof mutationInput>,
) {
  const input = mutationInput.parse(rawInput);
  const { definition, record } = await mutation(ctx, input);
  const revision = await snapshot(ctx, definition, record, "manual");
  const updated = await update(ctx, record, {});
  return { record: updated, revision };
}

export async function publishRecord(ctx: ServiceContext, rawInput: z.input<typeof mutationInput>) {
  const input = mutationInput.parse(rawInput);
  const { definition, record } = await mutation(ctx, input);
  await validateContent(ctx, definition, record.draft);
  const revision = await snapshot(ctx, definition, record, "auto-publish");
  const updated = await update(ctx, record, { publishedRevisionId: revision.id });
  return { record: updated, revision };
}

export async function unpublishRecord(
  ctx: ServiceContext,
  rawInput: z.input<typeof mutationInput>,
) {
  const input = mutationInput.parse(rawInput);
  const { record } = await mutation(ctx, input);
  return update(ctx, record, { publishedRevisionId: null });
}

export async function restoreRecord(
  ctx: ServiceContext,
  rawInput: z.input<typeof mutationInput> & { revisionId: string },
) {
  const input = mutationInput.extend({ revisionId: z.uuid() }).parse(rawInput);
  const { definition, record } = await mutation(ctx, input);
  const revision = await ctx.db
    .select()
    .from(collectionRevisions)
    .where(
      and(
        eq(collectionRevisions.id, input.revisionId),
        eq(collectionRevisions.recordId, record.id),
      ),
    )
    .get();
  if (!revision) throw new ORPCError("NOT_FOUND");
  if (revision.schemaVersion !== 1)
    throw new ORPCError("CONFLICT", { message: "Unsupported snapshot version" });
  await validateContent(ctx, definition, revision.content);
  const displaced = await snapshot(ctx, definition, record, "auto-draft");
  return { record: await update(ctx, record, { draft: revision.content }), displaced };
}
