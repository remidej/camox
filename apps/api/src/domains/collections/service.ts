import { generateUuidv7, uuidv7Schema } from "@camox/api-contract/ids";
import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import { assertSyncAccess, recordDefinitionsSynced } from "../../authorization";
import {
  ConflictError,
  decodeInput,
  InvalidInputError,
  NotFoundError,
  type ServiceError,
} from "../../lib/errors";
import type { Journal } from "../../lib/journal";
import { stableStringify } from "../../lib/stable-stringify";
import { definitionsDraftOf, definitionsIn } from "../_shared/definitions";
import { fieldOf } from "../_shared/fields";
import { referencesTo } from "../_shared/references-to";
import { collectionSchemaHash } from "../_shared/schema-hash";
import type { ServiceContext } from "../_shared/service-context";
import { contentReader, type ContentReader } from "../content/reader";
import { accessTo, type AccessMode, type ContentAccess } from "../drafts/access";
import * as overlay from "../drafts/overlay";
import type { ReadScope } from "../drafts/scope";
import { deleteOnPurpose } from "../translations/exclusions";
import { recordsOf } from "./identity";
import { pageValue, recordPageLayouts, recordsSharingPageValues } from "./record-pages";
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
    // A release writes Live; dev mode writes the caller's development draft (ADR 0006).
    const target = yield* assertSyncAccess(
      ctx.db,
      input.projectSlug,
      { user: ctx.user, draft: ctx.draft, deployToken: input.deployToken },
      { create: input.autoCreate },
    );
    const { project } = target;
    const draftId = definitionsDraftOf(target.scope);
    const scope = and(
      eq(collectionDefinitions.projectId, project.id),
      definitionsIn(collectionDefinitions, target.scope),
    );
    const hashes = yield* Effect.promise(() =>
      Promise.all(input.definitions.map((definition) => collectionSchemaHash(definition))),
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
      ...input.definitions.map((definition, index) =>
        ctx.db
          .insert(collectionDefinitions)
          .values({
            ...definition,
            schemaHash: hashes[index]!,
            draftId,
            projectId: project.id,
          })
          .onConflictDoUpdate(
            draftId === null
              ? {
                  target: [collectionDefinitions.projectId, collectionDefinitions.collectionId],
                  targetWhere: sql`${collectionDefinitions.draftId} is null`,
                  set: { ...definition, schemaHash: hashes[index]! },
                }
              : {
                  target: [collectionDefinitions.draftId, collectionDefinitions.collectionId],
                  targetWhere: sql`${collectionDefinitions.draftId} is not null`,
                  set: { ...definition, schemaHash: hashes[index]! },
                },
          ),
      ),
    ] as const;
    yield* Effect.promise(() => ctx.db.batch(statements));
    yield* recordDefinitionsSynced(ctx.db, target);
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
/** A collection reader in the draft a request names, or Live: its records are reader there. */
type ScopedDefinition = Definition & { draft: ReadScope };
type RecordRow = typeof collectionRecords.$inferSelect;

/** The columns reads need of a record. */
const recordColumns = {
  id: collectionRecords.id,
  collectionId: collectionRecords.collectionId,
  content: collectionRecords.content,
  createdAt: collectionRecords.createdAt,
  updatedAt: collectionRecords.updatedAt,
};
type ShownRecordRow = { [K in keyof typeof recordColumns]: RecordRow[K] };

/** A collection as one request reads it: its definition, and the reader of its scope. */
type Collection = { definition: ScopedDefinition; reader: ContentReader };

/**
 * A record as reads return it: its current content conformed to its collection's definition
 * (ADR 0007), with its files resolved and the records it references.
 */
const recordView = Effect.fn("collections.recordView")(function* (
  { reader, definition }: Collection,
  record: RecordRow,
) {
  const [view] = yield* reader.records(definition.collectionId, [record]);
  const { id, collectionId, content, createdAt, updatedAt, references } = view!;
  return { id, collectionId, content, createdAt, updatedAt, references };
});

export const getCollectionRecord = Effect.fn("collections.getCollectionRecord")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getCollectionRecordInput>,
) {
  const input = yield* decodeInput(getCollectionRecordInput, rawInput);
  return yield* inCollection(ctx, input, "member", (collection) =>
    Effect.gen(function* () {
      const record = yield* recordIn(ctx, collection.definition, input.id);
      if (!record) return yield* new NotFoundError();
      return yield* recordRead(ctx, collection, record);
    }),
  );
});

/**
 * A record as the studio reads and saves it: its view, and whether another record's page is
 * found by the same value (ADR 0009).
 */
const recordRead = Effect.fn("collections.recordRead")(function* (
  ctx: ServiceContext,
  collection: Collection,
  record: RecordRow,
) {
  const { definition } = collection;
  const records = yield* Effect.promise(() =>
    ctx.db
      .select(recordColumns)
      .from(collectionRecords)
      .where(recordsOf(definition, definition.draft)),
  );
  const duplicates = yield* duplicatePageValueIds(ctx, collection, records);
  return {
    ...(yield* recordView(collection, record)),
    duplicatePageValue: duplicates.has(record.id),
  };
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
  return yield* inCollection(ctx, input, "member", ({ definition }) =>
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
    const { project, scope } = yield* accessTo(ctx, { projectSlug: input.projectSlug }, "member");
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
            definitionsIn(collectionDefinitions, scope),
          ),
        )
        // Definitions have no creation timestamp; their row order preserves creation order.
        .orderBy(desc(collectionDefinitions.rowId)),
    );
  },
  Effect.scoped,
);

export const getCollectionDefinition = Effect.fn("collections.getCollectionDefinition")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getCollectionDefinitionInput>,
) {
  const input = yield* decodeInput(getCollectionDefinitionInput, rawInput);
  const { project, scope } = yield* accessTo(ctx, { projectSlug: input.projectSlug }, "member");
  const reader = contentReader(ctx, { projectId: project.id, draft: scope });
  const definition = yield* reader.collection(input.collectionId);
  if (!definition) return yield* new NotFoundError();
  const { collectionId, title, description, label, contentSchema } = definition;
  return { collectionId, title, description, label, contentSchema };
}, Effect.scoped);

/**
 * The studio's record list: each record's id and plain text label, newest first, and whether
 * another record's page is found by the same value (ADR 0009).
 */
export const listCollectionRecords = Effect.fn("collections.listCollectionRecords")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof listCollectionRecordsInput>,
) {
  const input = yield* decodeInput(listCollectionRecordsInput, rawInput);
  return yield* inCollection(ctx, input, "member", (collection) =>
    Effect.gen(function* () {
      const { definition, reader } = collection;
      const records = yield* Effect.promise(() =>
        ctx.db
          .select(recordColumns)
          .from(collectionRecords)
          .where(recordsOf(definition, definition.draft))
          .orderBy(desc(collectionRecords.createdAt), desc(collectionRecords.id)),
      );
      const duplicates = yield* duplicatePageValueIds(ctx, collection, records);
      const shown = yield* reader.shown.records(definition.collectionId, records);
      return shown.map((record) => ({
        id: record.id,
        label: record.label,
        duplicatePageValue: duplicates.has(record.id),
      }));
    }),
  );
});

/**
 * The ids of the collection's records sharing the value their record pages are found by with
 * another record: a duplicate path (ADR 0009). `records` are all the collection's records.
 */
const duplicatePageValueIds = Effect.fn("collections.duplicatePageValueIds")(function* (
  ctx: ServiceContext,
  { definition, reader }: Collection,
  records: readonly ShownRecordRow[],
) {
  const recordPages = (yield* recordPageLayouts(ctx.db, definition)).filter(
    (layout) => layout.collectionId === definition.collectionId,
  );
  if (recordPages.length === 0) return new Set<string>();
  const shown = yield* reader.shown.records(definition.collectionId, records);
  return new Set(
    recordPages.flatMap(({ field }) =>
      recordsSharingPageValues(shown, (record) => pageValue(record.content, field)).flatMap(
        (group) => group.map((record) => record.id),
      ),
    ),
  );
});

/**
 * Runs `run` on a collection, reader in the draft the request names or in Live, with the request's
 * access to the collection's project in `mode`, and the content reader of that scope. A write
 * that starts the draft and fails leaves no draft behind.
 */
const inCollection = <A, M extends AccessMode>(
  ctx: ServiceContext,
  input: z.infer<typeof scopeInput>,
  mode: M,
  run: (collection: {
    definition: Definition & { draft: ContentAccess<{ projectSlug: string }, M>["scope"] };
    reader: ContentReader;
  }) => Effect.Effect<A, ServiceError, Journal>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { project, scope } = yield* accessTo(ctx, { projectSlug: input.projectSlug }, mode);
      const reader = contentReader(ctx, { projectId: project.id, draft: scope });
      const definition = yield* reader.collection(input.collectionId);
      if (!definition) return yield* new NotFoundError();
      return yield* run({ definition: { ...definition, draft: scope }, reader });
    }),
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
  return yield* inCollection(ctx, input, "write", (collection) =>
    Effect.gen(function* () {
      const { definition } = collection;
      const content = yield* validateContent(ctx, definition, input.content);
      const now = Date.now();
      // Reads conform the record to whatever schema a later sync brings.
      const record = yield* overlay.insert(ctx.db, definition.draft, collectionRecords, {
        id: input.id ?? generateUuidv7(),
        projectId: definition.projectId,
        collectionId: definition.collectionId,
        content,
        createdAt: now,
        updatedAt: now,
      });
      if (!record) return yield* new ConflictError({ message: "This record id is already taken" });
      return yield* recordRead(ctx, collection, record);
    }),
  );
});

export const listRecordPageValuesInput = scopeInput.extend({ field: z.string() });
export const findRecordsByFieldInput = listRecordPageValuesInput.extend({ value: z.string() });

/**
 * Each record with its String field's plain text, when that text can be a path segment, and its
 * Label.
 */
const recordsWithPageValues = Effect.fn("collections.recordsWithPageValues")(function* (
  ctx: ServiceContext,
  input: z.infer<typeof listRecordPageValuesInput>,
  { definition, reader }: Collection,
) {
  if (fieldOf(definition.contentSchema, input.field)?.kind !== "String")
    return yield* new InvalidInputError({
      message: `${input.collectionId}.${input.field} is not a String field`,
    });
  const rows = yield* Effect.promise(() =>
    ctx.db.select().from(collectionRecords).where(recordsOf(definition, definition.draft)),
  );
  const shown = yield* reader.shown.records(definition.collectionId, rows);
  return rows.flatMap((row, index) => {
    const { content, label } = shown[index]!;
    const value = pageValue(content, input.field);
    return value === null ? [] : [{ row, value, label }];
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
  return yield* inCollection(ctx, input, "public", (collection) =>
    Effect.gen(function* () {
      const records = yield* recordsWithPageValues(ctx, input, collection);
      // The page's record is the first hop: it resolves the records it links, which link nothing.
      const views = yield* collection.reader.records(
        collection.definition.collectionId,
        records.filter((record) => record.value === input.value).map(({ row }) => row),
      );
      return views.map(({ id, content, updatedAt, references }) => ({
        id,
        content,
        updatedAt,
        references,
      }));
    }),
  );
});

/**
 * The records that can have a record page, with the value of their `field` and their Label:
 * route discovery, and the name of each record page.
 * Records sharing a value are all listed, so the caller can report the ambiguity.
 */
export const listRecordPageValues = Effect.fn("collections.listRecordPageValues")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof listRecordPageValuesInput>,
) {
  const input = yield* decodeInput(listRecordPageValuesInput, rawInput);
  return yield* inCollection(ctx, input, "public", (collection) =>
    Effect.map(recordsWithPageValues(ctx, input, collection), (records) =>
      records.map(({ row, value, label }) => ({ id: row.id, value, label })),
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
  return yield* inCollection(ctx, input, "public", ({ definition, reader }) =>
    Effect.gen(function* () {
      const record = yield* recordIn(ctx, definition, input.id);
      if (!record) return yield* new NotFoundError();
      const markdown = yield* reader.recordMarkdown(
        definition.collectionId,
        record,
        input.toMarkdown,
      );
      return markdown!;
    }),
  );
});

/** Changes a record. In a draft, the first change copies the Live record into it. */
export const editRecord = Effect.fn("collections.editRecord")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof editRecordInput>,
) {
  const input = yield* decodeInput(editRecordInput, rawInput);
  return yield* inCollection(ctx, input, "write", (collection) =>
    Effect.gen(function* () {
      const { definition } = collection;
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
      return yield* recordRead(ctx, collection, updated);
    }),
  );
});

/**
 * Deleting a referenced record is allowed: references to it reader as empty. In a draft, a Live
 * record gets a tombstone, and publishing deletes it.
 */
export const deleteRecord = Effect.fn("collections.deleteRecord")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof deleteRecordInput>,
) {
  const input = yield* decodeInput(deleteRecordInput, rawInput);
  return yield* inCollection(ctx, input, "write", ({ definition }) =>
    Effect.gen(function* () {
      const record = yield* recordIn(ctx, definition, input.id);
      if (!record) return yield* new NotFoundError();
      yield* deleteOnPurpose(ctx.db, definition.draft, collectionRecords, record.id);
      return { id: record.id };
    }),
  );
});
