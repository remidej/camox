import { generateUuidv7, uuidv7Schema } from "@camox/api-contract/ids";
import { queryKeys } from "@camox/api-contract/query-keys";
import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import { assertSyncAccess, getAuthorizedProjectBySlug, requireUser } from "../../authorization";
import { broadcastInvalidation } from "../../lib/broadcast-invalidation";
import { contentToMarkdown } from "../../lib/content-markdown";
import {
  ConflictError,
  decodeInput,
  InvalidInputError,
  NotFoundError,
  type ServiceError,
} from "../../lib/errors";
import { lexicalStateToPlainText } from "../../lib/lexical-state";
import { resolveEnvironment } from "../../lib/resolve-environment";
import { stableStringify } from "../../lib/stable-stringify";
import { projects } from "../../schema";
import { conformRecordContent } from "../_shared/conform-content";
import { referencesTo } from "../_shared/references-to";
import type { ServiceContext } from "../_shared/service-context";
import * as overlay from "../drafts/overlay";
import type { DraftScope } from "../drafts/scope";
import { inDraftScope } from "../drafts/service";
import { recordsOf } from "./identity";
import { resolveRecordFiles } from "./record-files";
import { resolveReferences } from "./references";
import { collectionDefinitions, collectionRecords } from "./schema";
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
    // Content never blocks a sync: records keep their stored shape and conform on read.
    // A collection code no longer declares goes. Its records stay stored under its name, hidden
    // because nothing reads a collection without a definition, and come back with it (ADR 0007).
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
        ),
      ),
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
      draftId: null,
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
const recordInput = scopeInput.extend({ id: uuidv7Schema });
export const getCollectionRecordInput = recordInput;
export const getRecordUsageCountInput = recordInput;
/** The server mints the id; a client may mint one for an optimistic insert. */
export const createRecordInput = scopeInput.extend({
  id: uuidv7Schema.optional(),
  content: z.unknown(),
});
export const editRecordInput = recordInput.extend({ content: z.unknown() });
export const deleteRecordInput = recordInput;

type Definition = typeof collectionDefinitions.$inferSelect;
/** A collection read in the draft a request names, or Live: its records are read there. */
type ScopedDefinition = Definition & { draft: DraftScope };
type RecordRow = typeof collectionRecords.$inferSelect;

/**
 * A record as reads return it: its current content conformed to its collection's definition
 * (ADR 0007), with its files resolved.
 */
const recordView = Effect.fn("collections.recordView")(function* (
  ctx: ServiceContext,
  definition: ScopedDefinition,
  record: RecordRow,
) {
  const { id, collectionId, createdAt, updatedAt } = record;
  const content = yield* resolveRecordFiles(
    ctx,
    definition,
    definition.contentSchema,
    conformRecordContent(definition.contentSchema, record.content),
  );
  return { id, collectionId, content, createdAt, updatedAt };
});

export const getCollectionRecord = Effect.fn("collections.getCollectionRecord")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getCollectionRecordInput>,
) {
  const input = yield* decodeInput(getCollectionRecordInput, rawInput);
  return yield* inCollection(ctx, input, true, (definition) =>
    Effect.gen(function* () {
      const record = yield* recordIn(ctx, definition, input.id);
      if (!record) return yield* new NotFoundError();
      return yield* recordView(ctx, definition, record);
    }),
  );
});

/**
 * How many blocks, repeatable items and other records reference this record, as the request's
 * draft or Live reads them now. Deleting a referenced record is allowed: this count is what
 * tells editors it is in use.
 */
export const getRecordUsageCount = Effect.fn("collections.getRecordUsageCount")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getRecordUsageCountInput>,
) {
  const input = yield* decodeInput(getRecordUsageCountInput, rawInput);
  return yield* inCollection(ctx, input, true, (definition) =>
    Effect.gen(function* () {
      const record = yield* recordIn(ctx, definition, input.id);
      if (!record) return yield* new NotFoundError();
      const uses = yield* referencesTo(ctx.db, definition, { kind: "record", id: record.id });
      return { count: uses.length };
    }),
  );
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
        // Definitions have no creation timestamp; their row order preserves creation order.
        .orderBy(desc(sql`${collectionDefinitions}.rowid`)),
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
  return yield* inCollection(ctx, input, true, (definition) =>
    Effect.gen(function* () {
      const records = yield* Effect.promise(() =>
        ctx.db
          .select({ id: collectionRecords.id, content: collectionRecords.content })
          .from(collectionRecords)
          .where(recordsOf(definition, definition.draft))
          .orderBy(desc(collectionRecords.createdAt), desc(collectionRecords.id)),
      );
      return records.map((record) => ({
        id: record.id,
        label: lexicalStateToPlainText(
          conformRecordContent(definition.contentSchema, record.content)[definition.label] as
            | string
            | Record<string, unknown>,
        ),
      }));
    }),
  );
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

/**
 * Runs `run` on a collection, read in the draft the request names or in Live. A write that
 * starts the draft and fails leaves no draft behind.
 */
const inCollection = <A>(
  ctx: ServiceContext,
  input: z.infer<typeof scopeInput>,
  authorized: boolean,
  run: (definition: ScopedDefinition) => Effect.Effect<A, ServiceError>,
) =>
  Effect.flatMap(definitionFor(ctx, input, authorized), (definition) =>
    inDraftScope(ctx, definition.projectId, (draft) => run({ ...definition, draft })),
  );

/** A record of the collection, as the collection's scope reads it. */
const recordIn = (ctx: ServiceContext, definition: ScopedDefinition, id: string) =>
  Effect.promise(() =>
    ctx.db
      .select()
      .from(collectionRecords)
      .where(and(eq(collectionRecords.id, id), recordsOf(definition, definition.draft)))
      .get(),
  );

export const createRecord = Effect.fn("collections.createRecord")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof createRecordInput>,
) {
  const input = yield* decodeInput(createRecordInput, rawInput);
  return yield* inCollection(ctx, input, true, (definition) =>
    Effect.gen(function* () {
      const content = yield* validateContent(ctx, definition, input.content);
      const now = Date.now();
      // Reads conform the record to whatever schema a later sync brings.
      const record = yield* overlay.insert(ctx.db, definition.draft, collectionRecords, {
        id: input.id ?? generateUuidv7(),
        environmentId: definition.environmentId,
        collectionId: definition.collectionId,
        content,
        createdAt: now,
        updatedAt: now,
      });
      if (!record) return yield* new ConflictError({ message: "This record id is already taken" });
      invalidateRecord(ctx, definition, input, record.id);
      return yield* recordView(ctx, definition, record);
    }),
  );
});

function invalidateRecord(
  ctx: ServiceContext,
  definition: { projectId: number; draft: DraftScope },
  scope: z.infer<typeof scopeInput>,
  id: string,
) {
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    draftId: definition.draft?.id ?? null,
    projectId: definition.projectId,
    targets: [
      // Every record list, reference and usage count can change with one record.
      ["camox", "collections"],
      queryKeys.collections.records(scope.projectSlug, scope.collectionId),
      queryKeys.collections.record(scope.projectSlug, scope.collectionId, id),
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
  definition: ScopedDefinition,
) {
  const field = (definition.contentSchema.properties as Record<string, { fieldType?: string }>)[
    input.field
  ];
  if (field?.fieldType !== "String")
    return yield* new InvalidInputError({
      message: `${input.collectionId}.${input.field} is not a String field`,
    });
  const rows = yield* Effect.promise(() =>
    ctx.db.select().from(collectionRecords).where(recordsOf(definition, definition.draft)),
  );
  return rows.flatMap((row) => {
    const value = pageValue(
      conformRecordContent(definition.contentSchema, row.content),
      input.field,
    );
    return value === null ? [] : [{ row, value }];
  });
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
  return yield* inCollection(ctx, input, false, (definition) =>
    Effect.gen(function* () {
      const records = yield* recordsWithPageValues(ctx, input, definition);
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
              conformRecordContent(definition.contentSchema, row.content),
              2,
            );
            return { id, content, updatedAt, references };
          }),
      );
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
  return yield* inCollection(ctx, input, false, (definition) =>
    Effect.map(recordsWithPageValues(ctx, input, definition), (records) =>
      records.map(({ row, value }) => ({ id: row.id, value })),
    ),
  );
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
  return yield* inCollection(ctx, input, false, (definition) =>
    Effect.gen(function* () {
      const record = yield* recordIn(ctx, definition, input.id);
      if (!record) return yield* new NotFoundError();
      const { content } = yield* recordView(ctx, definition, record);
      const contentSchema = definition.contentSchema as { properties?: object };
      const references = yield* resolveReferences(
        ctx,
        definition,
        contentSchema,
        conformRecordContent(contentSchema, record.content),
        2,
      );
      return contentToMarkdown(
        input.toMarkdown,
        (contentSchema.properties ?? {}) as Record<string, unknown>,
        content,
        { references },
      );
    }),
  );
});

/** Changes a record. In a draft, the first change copies the Live record into it. */
export const editRecord = Effect.fn("collections.editRecord")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof editRecordInput>,
) {
  const input = yield* decodeInput(editRecordInput, rawInput);
  return yield* inCollection(ctx, input, true, (definition) =>
    Effect.gen(function* () {
      const record = yield* recordIn(ctx, definition, input.id);
      if (!record) return yield* new NotFoundError();
      // Keys of removed fields stay stored, unread, for when their field comes back.
      const content = {
        ...record.content,
        ...(yield* validateContent(ctx, definition, input.content, record.content)),
      };
      const updated = yield* overlay.update(
        ctx.db,
        definition.draft,
        collectionRecords,
        record.id,
        {
          content,
          updatedAt: Date.now(),
        },
      );
      if (!updated) return yield* new NotFoundError();
      invalidateRecord(ctx, definition, input, record.id);
      return yield* recordView(ctx, definition, updated);
    }),
  );
});

/**
 * Deleting a referenced record is allowed: references to it read as empty. In a draft, a Live
 * record gets a tombstone, and publishing deletes it.
 */
export const deleteRecord = Effect.fn("collections.deleteRecord")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof deleteRecordInput>,
) {
  const input = yield* decodeInput(deleteRecordInput, rawInput);
  return yield* inCollection(ctx, input, true, (definition) =>
    Effect.gen(function* () {
      const record = yield* recordIn(ctx, definition, input.id);
      if (!record) return yield* new NotFoundError();
      yield* overlay.remove(ctx.db, definition.draft, collectionRecords, record.id);
      invalidateRecord(ctx, definition, input, record.id);
      return { id: record.id };
    }),
  );
});
