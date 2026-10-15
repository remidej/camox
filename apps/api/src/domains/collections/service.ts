import { queryKeys } from "@camox/api-contract/query-keys";
import { and, desc, eq, notExists, notInArray, sql } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import { assertSyncAccess, getAuthorizedProjectBySlug, requireUser } from "../../authorization";
import { broadcastInvalidation } from "../../lib/broadcast-invalidation";
import { contentToMarkdown } from "../../lib/content-markdown";
import { ConflictError, decodeInput, InvalidInputError, NotFoundError } from "../../lib/errors";
import { lexicalStateToPlainText } from "../../lib/lexical-state";
import { resolveEnvironment } from "../../lib/resolve-environment";
import { stableStringify } from "../../lib/stable-stringify";
import { projects } from "../../schema";
import { referencesTo } from "../_shared/references-to";
import type { ServiceContext } from "../_shared/service-context";
import { resolveRecordFiles } from "./record-files";
import { resolveReferences } from "./references";
import { collectionDefinitions, collectionRecords } from "./schema";
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
    // A collection references only collections synced alongside it.
    const synced = new Set(input.definitions.map((d) => d.collectionId));
    for (const definition of input.definitions) {
      for (const [key, field] of Object.entries(definition.contentSchema.properties)) {
        if (field.collectionId === undefined || synced.has(field.collectionId)) continue;
        return yield* new InvalidInputError({
          message: `${definition.collectionId}.${key}: references unknown collection "${field.collectionId}"`,
        });
      }
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
            content: sql`(
            select json_group_object(key, case type
              when 'object' then json(value) when 'array' then json(value)
              when 'true' then json('true') when 'false' then json('false')
              else value end)
            from (
              select key, value, type from json_each(${collectionRecords.content})
              union all
              select key, value, type from json_each(${defaults}) as addition
              where not exists (
                select 1 from json_each(${collectionRecords.content}) as current
                where current.key = addition.key
              )
            )
          )`,
            updatedAt: Date.now(),
          })
          .where(
            and(
              eq(collectionRecords.definitionId, previous.id),
              sql`exists (select 1 from ${collectionDefinitions}
            where ${collectionDefinitions.id} = ${previous.id}
            and ${collectionDefinitions.contentSchema} = ${JSON.stringify(previous.contentSchema)})`,
              sql`exists (select 1 from json_each(${defaults}) as addition
            where not exists (select 1 from json_each(${collectionRecords.content}) as current
              where current.key = addition.key))`,
            ),
          ),
      );
    }
    // A collection code no longer declares goes, unless it holds records: those stay, with
    // their definition, until a removed collection can keep its records hidden (ADR 0007).
    const statements = [
      ctx.db.delete(collectionDefinitions).where(
        and(
          scope,
          input.definitions.length
            ? notInArray(
                collectionDefinitions.collectionId,
                input.definitions.map((definition) => definition.collectionId),
              )
            : undefined,
          notExists(
            ctx.db
              .select({ id: collectionRecords.id })
              .from(collectionRecords)
              .where(eq(collectionRecords.definitionId, collectionDefinitions.id)),
          ),
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
          })
          .onConflictDoUpdate({
            target: [
              collectionDefinitions.projectId,
              collectionDefinitions.environmentId,
              collectionDefinitions.collectionId,
            ],
            set: definition,
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
export const getCollectionRecordInput = recordInput;
export const getRecordUsageCountInput = recordInput;
export const createRecordInput = scopeInput.extend({ content: z.unknown() });
export const editRecordInput = recordInput.extend({ content: z.unknown() });
export const deleteRecordInput = recordInput;

type Definition = typeof collectionDefinitions.$inferSelect;
type RecordRow = typeof collectionRecords.$inferSelect;

/** A record as reads return it: its current content, with its files resolved. */
const recordView = Effect.fn("collections.recordView")(function* (
  ctx: ServiceContext,
  definition: Definition,
  record: RecordRow,
) {
  const { id, createdAt, updatedAt } = record;
  const content = yield* resolveRecordFiles(
    ctx,
    definition,
    definition.contentSchema,
    record.content,
  );
  return { id, content, createdAt, updatedAt };
});

export const getCollectionRecord = Effect.fn("collections.getCollectionRecord")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getCollectionRecordInput>,
) {
  const input = yield* decodeInput(getCollectionRecordInput, rawInput);
  const { definition, record } = yield* recordFor(ctx, input, true);
  if (!record) return yield* new NotFoundError();
  return yield* recordView(ctx, definition, record);
});

/**
 * How many blocks, repeatable items and other records reference this record, as stored now.
 * Deleting a referenced record is allowed: this count is what tells editors it is in use.
 */
export const getRecordUsageCount = Effect.fn("collections.getRecordUsageCount")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getRecordUsageCountInput>,
) {
  const input = yield* decodeInput(getRecordUsageCountInput, rawInput);
  const { definition, record } = yield* recordFor(ctx, input, true);
  if (!record) return yield* new NotFoundError();
  const uses = yield* referencesTo(ctx.db, definition, { kind: "record", id: record.id });
  return { count: uses.length };
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
  const { collectionId, title, description, label, contentSchema } = definition;
  return { collectionId, title, description, label, contentSchema };
});

/** The studio's record list: each record's id and plain text label, newest first. */
export const listCollectionRecords = Effect.fn("collections.listCollectionRecords")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof listCollectionRecordsInput>,
) {
  const input = yield* decodeInput(listCollectionRecordsInput, rawInput);
  const definition = yield* definitionFor(ctx, input, true);
  const records = yield* Effect.promise(() =>
    ctx.db
      .select({ id: collectionRecords.id, content: collectionRecords.content })
      .from(collectionRecords)
      .where(eq(collectionRecords.definitionId, definition.id))
      .orderBy(desc(collectionRecords.createdAt), desc(collectionRecords.id)),
  );
  return records.map((record) => ({
    id: record.id,
    label: lexicalStateToPlainText(
      record.content[definition.label] as string | Record<string, unknown>,
    ),
  }));
});

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

/** Writes go through only while the definition still has the schema they were validated with. */
const definitionUnchanged = (definition: Definition) =>
  sql`exists (select 1 from ${collectionDefinitions}
    where ${collectionDefinitions.id} = ${definition.id}
    and ${collectionDefinitions.contentSchema} = ${JSON.stringify(definition.contentSchema)})`;

export const createRecord = Effect.fn("collections.createRecord")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof scopeInput> & { content: unknown },
) {
  const input = yield* decodeInput(createRecordInput, rawInput);
  const definition = yield* definitionFor(ctx, input, true);
  const content = yield* validateContent(ctx, definition, input.content);
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
            content: sql<Record<string, unknown>>`${JSON.stringify(content)}`.as("content"),
            createdAt: sql<number>`${now}`.as("created_at"),
            updatedAt: sql<number>`${now}`.as("updated_at"),
          })
          .from(collectionDefinitions)
          .where(and(eq(collectionDefinitions.id, definition.id), definitionUnchanged(definition))),
      )
      .returning()
      .get(),
  );
  if (!record)
    return yield* new ConflictError({ message: "Collection definition changed; retry creation" });
  invalidateRecord(ctx, definition, input, record.id);
  return yield* recordView(ctx, definition, record);
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
      // Every record list, reference and usage count can change with one record.
      ["camox", "collections"],
      queryKeys.collections.records(scope.projectSlug, ctx.environmentName, scope.collectionId),
      queryKeys.collections.record(scope.projectSlug, ctx.environmentName, scope.collectionId, id),
      ["camox", "blocks"],
      queryKeys.pages.getByPathAll,
      queryKeys.pages.list,
      queryKeys.layouts.all,
    ],
  });
}

export const listRecordPageValuesInput = scopeInput.extend({ field: z.string() });
export const findRecordsByFieldInput = listRecordPageValuesInput.extend({ value: z.string() });

/** A record's String field as a path segment, or null when it can't be one. */
function pageValue(content: Record<string, unknown> | null, field: string) {
  const value = content?.[field];
  if (typeof value !== "string" && (typeof value !== "object" || value === null)) return null;
  const text = lexicalStateToPlainText(value as string | Record<string, unknown>);
  // Empty values and values containing `/` can't be a path segment.
  return text && !text.includes("/") ? text : null;
}

/** Each record with its String field's plain text, when that text can be a path segment. */
const recordsWithPageValues = Effect.fn("collections.recordsWithPageValues")(function* (
  ctx: ServiceContext,
  input: z.infer<typeof listRecordPageValuesInput>,
) {
  const definition = yield* definitionFor(ctx, input, false);
  const field = (definition.contentSchema.properties as Record<string, { fieldType?: string }>)[
    input.field
  ];
  if (field?.fieldType !== "String")
    return yield* new InvalidInputError({
      message: `${input.collectionId}.${input.field} is not a String field`,
    });
  const rows = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(collectionRecords)
      .where(eq(collectionRecords.definitionId, definition.id)),
  );
  const records = rows.flatMap((row) => {
    const value = pageValue(row.content, input.field);
    return value === null ? [] : [{ row, value }];
  });
  return { definition, records };
});

/**
 * The records whose String field's plain text equals `value`: the records a record page could
 * render. Empty values and values containing `/` never match.
 */
export const findRecordsByField = Effect.fn("collections.findRecordsByField")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof findRecordsByFieldInput>,
) {
  const input = yield* decodeInput(findRecordsByFieldInput, rawInput);
  const { definition, records } = yield* recordsWithPageValues(ctx, input);
  // The page's record is the first hop: it resolves the records it links, which link nothing.
  return yield* Effect.forEach(
    records.filter((record) => record.value === input.value),
    ({ row }) =>
      Effect.gen(function* () {
        const { id, content, updatedAt } = yield* recordView(ctx, definition, row);
        const references = yield* resolveReferences(
          ctx,
          definition,
          definition.contentSchema,
          row.content,
          2,
        );
        return { id, content, updatedAt, references };
      }),
  );
});

/**
 * The records that can have a record page, with the value of their `field`: route discovery.
 * Records sharing a value are all listed, so the caller can report the ambiguity.
 */
export const listRecordPageValues = Effect.fn("collections.listRecordPageValues")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof listRecordPageValuesInput>,
) {
  const input = yield* decodeInput(listRecordPageValuesInput, rawInput);
  const { records } = yield* recordsWithPageValues(ctx, input);
  return records.map(({ row, value }) => ({ id: row.id, value }));
});

export const recordMarkdownInput = recordInput.extend({
  toMarkdown: z.array(z.string().max(10_000)).max(200),
});

/**
 * A record page's Markdown: the layout's `toMarkdown` lines, filled with the record's fields
 * like a reference list's records. The record is the first hop, so its links resolve.
 */
export const recordMarkdown = Effect.fn("collections.recordMarkdown")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof recordMarkdownInput>,
) {
  const input = yield* decodeInput(recordMarkdownInput, rawInput);
  const { definition, record } = yield* recordFor(ctx, input, false);
  if (!record) return yield* new NotFoundError();
  const { content } = yield* recordView(ctx, definition, record);
  const contentSchema = definition.contentSchema as { properties?: object };
  const references = yield* resolveReferences(ctx, definition, contentSchema, record.content, 2);
  return contentToMarkdown(
    input.toMarkdown,
    (contentSchema.properties ?? {}) as Record<string, unknown>,
    content,
    { references },
  );
});

export const editRecord = Effect.fn("collections.editRecord")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof editRecordInput>,
) {
  const input = yield* decodeInput(editRecordInput, rawInput);
  const { definition, record } = yield* recordFor(ctx, input, true);
  if (!record) return yield* new NotFoundError();
  const content = yield* validateContent(ctx, definition, input.content, record.content);
  const updated = yield* Effect.promise(() =>
    ctx.db
      .update(collectionRecords)
      .set({ content, updatedAt: Date.now() })
      .where(and(eq(collectionRecords.id, record.id), definitionUnchanged(definition)))
      .returning()
      .get(),
  );
  if (!updated)
    return yield* new ConflictError({
      message: "Record or definition changed; reload before retrying",
    });
  invalidateRecord(ctx, definition, input, record.id);
  return yield* recordView(ctx, definition, updated);
});

/** Deleting a referenced record is allowed: references to it read as empty. */
export const deleteRecord = Effect.fn("collections.deleteRecord")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof deleteRecordInput>,
) {
  const input = yield* decodeInput(deleteRecordInput, rawInput);
  const { definition, record } = yield* recordFor(ctx, input, true);
  if (!record) return yield* new NotFoundError();
  yield* Effect.promise(() =>
    ctx.db.delete(collectionRecords).where(eq(collectionRecords.id, record.id)),
  );
  invalidateRecord(ctx, definition, input, record.id);
  return { id: record.id };
});
