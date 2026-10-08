import { queryKeys } from "@camox/api-contract/query-keys";
import { chat } from "@tanstack/ai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { generateKeyBetween } from "fractional-indexing";
import { outdent } from "outdent";
import { z } from "zod";

import { assertBlockAccess, assertRepeatableItemAccess, requireUser } from "../../authorization";
import type { Database } from "../../db";
import { broadcastInvalidation } from "../../lib/broadcast-invalidation";
import {
  bumpContentUpdatedAt,
  bumpContentUpdatedAtForBlock,
} from "../../lib/bump-content-updated-at";
import { decodeInput, InvalidInputError, NotFoundError } from "../../lib/errors";
import { scheduleAiJob } from "../../lib/schedule-ai-job";
import { blocks, files, repeatableItems } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
import { loadBlockSchemas } from "../blocks/content-schema";
import { initializeBlockContent } from "../blocks/initialize-content";
import {
  sanitizeItemContent,
  validateItemSeeds,
  type FieldSchema,
} from "../blocks/normalize-content";
import { contentWithSeeds } from "../blocks/prepare-content";
import { syncBlockData } from "../blocks/synced";
import { validateContent } from "../blocks/validate-content";
import { blockScope, validateReferenceValues } from "../collections/references";
import { collectFileIds } from "../pages/ai";

// --- Input Schemas ---
// Exported so adapters (oRPC, MCP, CLI) share the same canonical contract.
// Services .parse() them on entry — service is the trust boundary.

const nestedItemSeedSchema = z.object({
  tempId: z.string(),
  parentTempId: z.string().nullable(),
  fieldName: z.string(),
  content: z.unknown(),
  settings: z.unknown().optional(),
  position: z.string(),
});

export const getRepeatableItemInput = z.object({ id: z.number() });
export const createRepeatableItemInput = z.object({
  blockId: z.number(),
  parentItemId: z.number().nullable().optional(),
  fieldName: z.string(),
  content: z.unknown(),
  settings: z.unknown().optional(),
  afterPosition: z.string().nullable().optional(),
  nestedItems: z.array(nestedItemSeedSchema).optional(),
});
export const updateRepeatableItemContentInput = z.object({
  id: z.number(),
  content: z.unknown(),
});
export const updateRepeatableItemSettingsInput = z.object({
  id: z.number(),
  settings: z.unknown(),
});
export const updateRepeatableItemPositionInput = z.object({
  id: z.number(),
  afterPosition: z.string().nullable().optional(),
  beforePosition: z.string().nullable().optional(),
});
export const duplicateRepeatableItemInput = z.object({ id: z.number() });
export const generateRepeatableItemSummaryInput = z.object({ id: z.number() });
export const deleteRepeatableItemInput = z.object({ id: z.number() });

// --- Schema resolution for item content normalization ---

/** Keep the complete repeater schema, including item constraints and settings. */
const descendRepeaterSchema = Effect.fn("descendRepeaterSchema")(function* (
  rootSchema: FieldSchema | null | undefined,
  fieldNamePath: string[],
) {
  let schema = rootSchema;
  let repeater: FieldSchema | undefined;
  for (const fieldName of fieldNamePath) {
    if (!schema) return undefined;
    repeater = schema.properties?.[fieldName];
    // Undeclared legacy fields remain open, like JSON Schema's default
    // additionalProperties policy. Known non-repeater fields cannot own rows.
    if (!repeater && schema.additionalProperties !== false) return undefined;
    if (repeater?.fieldType !== "Repeater") {
      return yield* new InvalidInputError({
        message: `Invalid repeater field: ${fieldNamePath.join(".")}`,
        data: { field: fieldNamePath.join(".") },
      });
    }
    schema = repeater.items;
  }
  return repeater;
});

const prepareItemContent = Effect.fn("prepareItemContent")(function* (
  content: unknown,
  schema: FieldSchema | undefined,
  path: string,
  rootSchema: unknown,
) {
  // Check shape before the initializer can turn malformed input into an object.
  yield* validateContent(content, null, { path });
  const initialized = initializeBlockContent(content, schema, false);
  yield* validateContent(initialized, schema, { path, partial: true, rootSchema });
  return yield* sanitizeItemContent(initialized, schema?.properties, rootSchema);
});

const prepareItemSettings = Effect.fn("prepareItemSettings")(function* (
  settings: unknown,
  schema: FieldSchema | undefined,
  path: string,
  rootSchema: unknown,
) {
  if (settings == null && schema == null) return null;
  if (settings != null) yield* validateContent(settings, null, { path });
  const initialized = initializeBlockContent(settings ?? undefined, schema, false);
  yield* validateContent(initialized, schema, { path, partial: false, rootSchema });
  return initialized;
});

const validateRepeaterCount = Effect.fn("validateRepeaterCount")(function* (
  schema: FieldSchema | undefined,
  count: number,
  field: string,
) {
  if (!schema) return;
  yield* validateContent(
    { [field]: Array.from({ length: count }, () => null) },
    {
      properties: {
        [field]: { type: "array", minItems: schema.minItems, maxItems: schema.maxItems },
      },
    },
  );
});

/**
 * Build the contentSchema field-name path that leads to this item's
 * `items.properties` — i.e. the schema describing the item's own content.
 * Walks the parentItemId chain in the DB to compose the ancestor list.
 */
const resolveItemFieldNamePath = Effect.fn("resolveItemFieldNamePath")(function* (
  db: Database,
  blockId: number,
  parentItemId: number | null,
  fieldName: string,
) {
  if (parentItemId == null) return [fieldName];
  const all = yield* Effect.promise(() =>
    db
      .select({
        id: repeatableItems.id,
        parentItemId: repeatableItems.parentItemId,
        fieldName: repeatableItems.fieldName,
      })
      .from(repeatableItems)
      .where(eq(repeatableItems.blockId, blockId)),
  );
  const byId = new Map(all.map((i) => [i.id, i]));
  const ancestors: string[] = [];
  const visited = new Set<number>();
  let cur: number | null = parentItemId;
  while (cur != null) {
    const item = byId.get(cur);
    if (!item || visited.has(cur)) {
      return yield* new InvalidInputError({ message: "Invalid parentItemId for this block" });
    }
    visited.add(cur);
    ancestors.unshift(item.fieldName);
    cur = item.parentItemId;
  }
  return [...ancestors, fieldName];
});

function comparePositions(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Find the last index where item.position <= target in a sorted array. */
function findLastIndexLe<T extends { position: string }>(items: T[], target: string): number {
  let result = -1;
  for (let i = 0; i < items.length; i++) {
    if (items[i].position <= target) result = i;
    else break;
  }
  return result;
}

// --- AI Executor ---

const generateObjectSummary = Effect.fn("generateObjectSummary")(function* (
  apiKey: string,
  options: { type: string; markdown: string; previousSummary?: string },
  abortController?: AbortController,
) {
  const stabilityBlock = options.previousSummary
    ? outdent`

      <previous_summary>${options.previousSummary}</previous_summary>
      <stability_instruction>
        A summary was previously generated for this content.
        Return the SAME summary unless it is no longer accurate.
        Only change it if the content has meaningfully changed.
      </stability_instruction>
    `
    : "";

  return yield* Effect.promise(() =>
    chat({
      adapter: createOpenRouterText("openai/gpt-oss-20b", apiKey),
      stream: false,
      abortController,
      messages: [
        {
          role: "user",
          content: outdent`
            <instruction>
              Generate a concise summary for a piece of website content.
            </instruction>

            <constraints>
              - MAXIMUM 4 WORDS
              - Capture the main idea or purpose
              - Be descriptive and specific to the content type
              - Use sentence case (only capitalize the first word and proper nouns)
              - Don't use markdown, just plain text
              - Don't use punctuation
              - Use abbreviations or acronyms where appropriate
            </constraints>

            <context>
              <type>${options.type}</type>
              <content>${options.markdown}</content>
            </context>
            ${stabilityBlock}

            <examples>
              <example>
                <type>paragraph</type>
                <content>{"text": "This is a description of how our service works in detail."}</content>
                <output>Service explanation details</output>
              </example>

              <example>
                <type>button</type>
                <content>{"text": "Submit Form", "action": "submit"}</content>
                <output>Submit form button</output>
              </example>
            </examples>

            <format>
              Return only the summary text, nothing else.
            </format>
          `,
        },
      ],
    }),
  );
});

/**
 * Generates and stores a summary for a repeatable item.
 * Returns `{ blockId }` so the caller can cascade to block summary regeneration.
 */
export const executeRepeatableItemSummary = Effect.fn("repeatableItems.executeSummary")(function* (
  db: Database,
  apiKey: string,
  itemId: number,
  abortController?: AbortController,
) {
  const item = yield* Effect.promise(() =>
    db.select().from(repeatableItems).where(eq(repeatableItems.id, itemId)).get(),
  );
  if (!item) return null;

  const block = yield* Effect.promise(() =>
    db.select().from(blocks).where(eq(blocks.id, item.blockId)).get(),
  );
  if (!block) return null;

  const summary = yield* generateObjectSummary(
    apiKey,
    { type: block.type, markdown: JSON.stringify(item.content), previousSummary: item.summary },
    abortController,
  );

  yield* Effect.promise(() =>
    db
      .update(repeatableItems)
      .set({ summary, updatedAt: Date.now() })
      .where(eq(repeatableItems.id, itemId)),
  );

  if (summary !== item.summary) {
    return { blockId: item.blockId };
  }

  return null;
});

// --- Reads ---

export const getRepeatableItem = Effect.fn("repeatableItems.getRepeatableItem")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getRepeatableItemInput>,
) {
  const { id } = yield* decodeInput(getRepeatableItemInput, rawInput);
  const item = yield* Effect.promise(() =>
    ctx.db.select().from(repeatableItems).where(eq(repeatableItems.id, id)).get(),
  );
  if (!item) return yield* new NotFoundError();

  // Collect and fetch referenced files
  const fileIds = new Set<number>();
  collectFileIds(item.content as Record<string, unknown>, fileIds);

  const fileRows =
    fileIds.size > 0
      ? yield* Effect.promise(() =>
          ctx.db
            .select()
            .from(files)
            .where(inArray(files.id, [...fileIds])),
        )
      : [];

  return {
    item,
    files: fileRows,
  };
});

// --- Writes ---

export const createRepeatableItem = Effect.fn("repeatableItems.createRepeatableItem")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof createRepeatableItemInput>,
) {
  const user = yield* requireUser(ctx);
  const { blockId, parentItemId, fieldName, content, settings, afterPosition, nestedItems } =
    yield* decodeInput(createRepeatableItemInput, rawInput);
  const access = yield* assertBlockAccess(ctx.db, blockId, user.id);

  const now = Date.now();

  const schema = (yield* loadBlockSchemas(ctx.db, access.projectId, blockId))?.contentSchema;
  const rootPath = yield* resolveItemFieldNamePath(
    ctx.db,
    blockId,
    parentItemId ?? null,
    fieldName,
  );
  const repeater = yield* descendRepeaterSchema(schema, rootPath);
  const sanitizedContent = yield* prepareItemContent(content, repeater?.items, "content", schema);
  const sanitizedSettings = yield* prepareItemSettings(
    settings,
    repeater?.itemSettingsSchema,
    "settings",
    schema,
  );
  yield* validateItemSeeds(nestedItems ?? [], repeater?.items?.properties, "nestedItems", schema);

  // Complete every schema check and normalization before inserting the parent.
  const seedSchemas = new Map<string, FieldSchema | undefined>();
  const preparedSeeds = [];
  for (const [index, seed] of (nestedItems ?? []).entries()) {
    const parentSchema =
      seed.parentTempId === null ? repeater?.items : seedSchemas.get(seed.parentTempId);
    const seedRepeater = yield* descendRepeaterSchema(parentSchema, [seed.fieldName]);
    seedSchemas.set(seed.tempId, seedRepeater?.items);
    preparedSeeds.push({
      ...seed,
      content: yield* prepareItemContent(
        seed.content,
        seedRepeater?.items,
        `nestedItems[${index}].content`,
        schema,
      ),
      settings: yield* prepareItemSettings(
        seed.settings,
        seedRepeater?.itemSettingsSchema,
        `nestedItems[${index}].settings`,
        schema,
      ),
    });
  }
  const contentWithItems = yield* contentWithSeeds(
    sanitizedContent,
    preparedSeeds,
    repeater?.items,
  );
  yield* validateContent(contentWithItems, repeater?.items, {
    path: "content",
    partial: false,
    rootSchema: schema,
  });
  yield* validateReferenceValues(
    ctx,
    yield* blockScope(ctx, access.block),
    repeater?.items,
    contentWithItems,
  );

  // Get siblings to determine correct position
  const siblings = (yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(repeatableItems)
      .where(and(eq(repeatableItems.blockId, blockId), eq(repeatableItems.fieldName, fieldName))),
  ))
    .filter((item) => item.parentItemId === (parentItemId ?? null))
    .sort((a, b) => comparePositions(a.position, b.position));
  yield* validateRepeaterCount(repeater, siblings.length + 1, rootPath.join("."));

  let position: string;
  if (afterPosition === undefined || afterPosition === null) {
    const lastItem = siblings[siblings.length - 1];
    position = generateKeyBetween(lastItem?.position ?? null, null);
  } else if (afterPosition === "") {
    const firstItem = siblings[0];
    position = generateKeyBetween(null, firstItem?.position ?? null);
  } else {
    const afterIndex = findLastIndexLe(siblings, afterPosition);
    const nextItem = afterIndex >= 0 ? siblings[afterIndex + 1] : siblings[0];
    position = generateKeyBetween(
      afterIndex >= 0 ? siblings[afterIndex].position : null,
      nextItem?.position ?? null,
    );
  }

  const result = yield* Effect.promise(() =>
    ctx.db
      .insert(repeatableItems)
      .values({
        blockId,
        parentItemId: parentItemId ?? null,
        fieldName,
        content: sanitizedContent,
        settings: sanitizedSettings,
        summary: "",
        position,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get(),
  );

  // Insert client-provided nested item seeds
  if (preparedSeeds.length > 0) {
    const tempIdToRealId = new Map<string, number>();

    for (const seed of preparedSeeds) {
      // null parentTempId means child of the item being created
      const seedParentId = seed.parentTempId
        ? (tempIdToRealId.get(seed.parentTempId) ?? result.id)
        : result.id;
      const inserted = yield* Effect.promise(() =>
        ctx.db
          .insert(repeatableItems)
          .values({
            blockId,
            parentItemId: seedParentId,
            fieldName: seed.fieldName,
            content: seed.content,
            settings: seed.settings,
            summary: "",
            position: seed.position,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get(),
      );
      tempIdToRealId.set(seed.tempId, inserted.id);
    }
  }

  yield* syncBlockData(ctx, blockId);
  yield* bumpContentUpdatedAt(ctx.db, access.block);

  ctx.waitUntil(
    scheduleAiJob(ctx.env.AI_JOB_SCHEDULER, {
      entityTable: "repeatableItems",
      entityId: result.id,
      type: "summary",
      delayMs: 0,
    }),
  );
  // Granular invalidation: refetch the parent block bundle (includes new item)
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    projectId: access.projectId,
    targets: [
      queryKeys.blocks.get(blockId, "draft"),
      ...(access.pagePath
        ? [queryKeys.pages.getByPath(access.pagePath, "draft")]
        : [queryKeys.pages.getByPathAll]),
      queryKeys.pages.list,
      queryKeys.blocks.getUsageCounts,
    ],
  });

  return result;
});

export const updateRepeatableItemContent = Effect.fn("repeatableItems.updateRepeatableItemContent")(
  function* (ctx: ServiceContext, rawInput: z.input<typeof updateRepeatableItemContentInput>) {
    const user = yield* requireUser(ctx);
    const { id, content } = yield* decodeInput(updateRepeatableItemContentInput, rawInput);
    const access = yield* assertRepeatableItemAccess(ctx.db, id, user.id);

    // Resolve schema for the patch and sanitize asset leaks before merging.
    const schema = (yield* loadBlockSchemas(ctx.db, access.projectId, access.item.blockId))
      ?.contentSchema;
    const itemPath = yield* resolveItemFieldNamePath(
      ctx.db,
      access.item.blockId,
      access.item.parentItemId,
      access.item.fieldName,
    );
    const itemSchema = (yield* descendRepeaterSchema(schema, itemPath))?.items;
    yield* validateContent(content, itemSchema, {
      path: "content",
      partial: true,
      rootSchema: schema,
    });
    const sanitizedPatch = yield* sanitizeItemContent(content, itemSchema?.properties, schema);
    const block = yield* Effect.promise(() =>
      ctx.db.select().from(blocks).where(eq(blocks.id, access.item.blockId)).get(),
    );
    if (!block) return yield* new NotFoundError();
    yield* validateReferenceValues(ctx, yield* blockScope(ctx, block), itemSchema, sanitizedPatch);

    // Merge partial content into existing content (frontend sends single-field patches)
    const merged = {
      ...(access.item.content as Record<string, unknown>),
      ...sanitizedPatch,
    };
    const result = yield* Effect.promise(() =>
      ctx.db
        .update(repeatableItems)
        .set({ content: merged, updatedAt: Date.now() })
        .where(eq(repeatableItems.id, id))
        .returning()
        .get(),
    );

    yield* syncBlockData(ctx, access.item.blockId);
    yield* bumpContentUpdatedAtForBlock(ctx.db, access.item.blockId);

    ctx.waitUntil(
      scheduleAiJob(ctx.env.AI_JOB_SCHEDULER, {
        entityTable: "repeatableItems",
        entityId: id,
        type: "summary",
        delayMs: 5000,
      }),
    );
    // Granular invalidation: only refetch the parent block bundle (draft source)
    broadcastInvalidation({
      waitUntil: ctx.waitUntil,
      projectRoomNamespace: ctx.env.ProjectRoom,
      projectId: access.projectId,
      targets: [
        queryKeys.blocks.get(access.item.blockId, "draft"),
        ...(access.pagePath
          ? [queryKeys.pages.getByPath(access.pagePath, "draft")]
          : [queryKeys.pages.getByPathAll]),
        queryKeys.pages.list,
      ],
    });

    return result;
  },
);

export const updateRepeatableItemSettings = Effect.fn(
  "repeatableItems.updateRepeatableItemSettings",
)(function* (ctx: ServiceContext, rawInput: z.input<typeof updateRepeatableItemSettingsInput>) {
  const user = yield* requireUser(ctx);
  const { id, settings } = yield* decodeInput(updateRepeatableItemSettingsInput, rawInput);
  const access = yield* assertRepeatableItemAccess(ctx.db, id, user.id);

  const schema = (yield* loadBlockSchemas(ctx.db, access.projectId, access.item.blockId))
    ?.contentSchema;
  const itemPath = yield* resolveItemFieldNamePath(
    ctx.db,
    access.item.blockId,
    access.item.parentItemId,
    access.item.fieldName,
  );
  const settingsSchema = (yield* descendRepeaterSchema(schema, itemPath))?.itemSettingsSchema;
  yield* validateContent(settings, settingsSchema, {
    path: "settings",
    partial: true,
    rootSchema: schema,
  });

  const merged = {
    ...(access.item.settings as Record<string, unknown> | null),
    ...(settings as Record<string, unknown>),
  };
  const result = yield* Effect.promise(() =>
    ctx.db
      .update(repeatableItems)
      .set({ settings: merged, updatedAt: Date.now() })
      .where(eq(repeatableItems.id, id))
      .returning()
      .get(),
  );

  yield* syncBlockData(ctx, access.item.blockId);
  yield* bumpContentUpdatedAtForBlock(ctx.db, access.item.blockId);

  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    projectId: access.projectId,
    targets: [
      queryKeys.blocks.get(access.item.blockId, "draft"),
      ...(access.pagePath
        ? [queryKeys.pages.getByPath(access.pagePath, "draft")]
        : [queryKeys.pages.getByPathAll]),
      queryKeys.pages.list,
    ],
  });

  return result;
});

export const updateRepeatableItemPosition = Effect.fn(
  "repeatableItems.updateRepeatableItemPosition",
)(function* (ctx: ServiceContext, rawInput: z.input<typeof updateRepeatableItemPositionInput>) {
  const user = yield* requireUser(ctx);
  const { id, afterPosition, beforePosition } = yield* decodeInput(
    updateRepeatableItemPositionInput,
    rawInput,
  );
  const access = yield* assertRepeatableItemAccess(ctx.db, id, user.id);

  const item = access.item;
  const siblings = (yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(repeatableItems)
      .where(
        and(
          eq(repeatableItems.blockId, item.blockId),
          eq(repeatableItems.fieldName, item.fieldName),
        ),
      ),
  ))
    .filter((s) => s.id !== id && s.parentItemId === item.parentItemId)
    .sort((a, b) => comparePositions(a.position, b.position));

  const after = afterPosition || null;
  const before = beforePosition || null;

  let position: string;
  if (!after && !before) {
    const last = siblings[siblings.length - 1];
    position = generateKeyBetween(last?.position ?? null, null);
  } else if (!after) {
    const firstIdx = siblings.findIndex((b) => b.position >= before!);
    position = generateKeyBetween(null, siblings[firstIdx]?.position ?? null);
  } else {
    const afterIdx = findLastIndexLe(siblings, after);
    const nextPos = siblings[afterIdx + 1]?.position ?? null;
    position = generateKeyBetween(siblings[afterIdx]?.position ?? null, nextPos);
  }

  const result = yield* Effect.promise(() =>
    ctx.db
      .update(repeatableItems)
      .set({ position, updatedAt: Date.now() })
      .where(eq(repeatableItems.id, id))
      .returning()
      .get(),
  );
  yield* syncBlockData(ctx, access.item.blockId);
  yield* bumpContentUpdatedAtForBlock(ctx.db, access.item.blockId);
  // Granular invalidation: only refetch the parent block bundle (draft source)
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    projectId: access.projectId,
    targets: [
      queryKeys.blocks.get(access.item.blockId, "draft"),
      ...(access.pagePath
        ? [queryKeys.pages.getByPath(access.pagePath, "draft")]
        : [queryKeys.pages.getByPathAll]),
      queryKeys.pages.list,
    ],
  });
  return result;
});

export const duplicateRepeatableItem = Effect.fn("repeatableItems.duplicateRepeatableItem")(
  function* (ctx: ServiceContext, rawInput: z.input<typeof duplicateRepeatableItemInput>) {
    const user = yield* requireUser(ctx);
    const { id } = yield* decodeInput(duplicateRepeatableItemInput, rawInput);
    const access = yield* assertRepeatableItemAccess(ctx.db, id, user.id);
    const original = access.item;

    const schema = (yield* loadBlockSchemas(ctx.db, access.projectId, original.blockId))
      ?.contentSchema;
    const itemPath = yield* resolveItemFieldNamePath(
      ctx.db,
      original.blockId,
      original.parentItemId,
      original.fieldName,
    );
    const repeater = yield* descendRepeaterSchema(schema, itemPath);
    const now = Date.now();

    // Find the next sibling to insert between original and next
    const siblings = (yield* Effect.promise(() =>
      ctx.db
        .select()
        .from(repeatableItems)
        .where(
          and(
            eq(repeatableItems.blockId, original.blockId),
            eq(repeatableItems.fieldName, original.fieldName),
          ),
        ),
    ))
      .filter((item) => item.parentItemId === original.parentItemId)
      .sort((a, b) => comparePositions(a.position, b.position));
    yield* validateRepeaterCount(repeater, siblings.length + 1, itemPath.join("."));
    const originalIndex = siblings.findIndex((s) => s.id === id);
    const nextItem = originalIndex >= 0 ? siblings[originalIndex + 1] : undefined;
    const position = generateKeyBetween(original.position, nextItem?.position ?? null);

    const result = yield* Effect.promise(() =>
      ctx.db
        .insert(repeatableItems)
        .values({
          blockId: original.blockId,
          parentItemId: original.parentItemId,
          fieldName: original.fieldName,
          content: original.content,
          settings: original.settings,
          summary: original.summary,
          position,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get(),
    );
    yield* syncBlockData(ctx, original.blockId);
    yield* bumpContentUpdatedAtForBlock(ctx.db, original.blockId);
    // Granular invalidation: refetch the parent block bundle (includes new item)
    broadcastInvalidation({
      waitUntil: ctx.waitUntil,
      projectRoomNamespace: ctx.env.ProjectRoom,
      projectId: access.projectId,
      targets: [
        queryKeys.blocks.get(original.blockId, "draft"),
        ...(access.pagePath
          ? [queryKeys.pages.getByPath(access.pagePath, "draft")]
          : [queryKeys.pages.getByPathAll]),
        queryKeys.pages.list,
        queryKeys.blocks.getUsageCounts,
      ],
    });
    return result;
  },
);

export const generateRepeatableItemSummary = Effect.fn(
  "repeatableItems.generateRepeatableItemSummary",
)(function* (ctx: ServiceContext, rawInput: z.input<typeof generateRepeatableItemSummaryInput>) {
  const user = yield* requireUser(ctx);
  const { id } = yield* decodeInput(generateRepeatableItemSummaryInput, rawInput);
  const access = yield* assertRepeatableItemAccess(ctx.db, id, user.id);

  const cascade = yield* executeRepeatableItemSummary(ctx.db, ctx.env.OPEN_ROUTER_API_KEY, id);
  if (cascade) {
    ctx.waitUntil(
      scheduleAiJob(ctx.env.AI_JOB_SCHEDULER, {
        entityTable: "blocks",
        entityId: cascade.blockId,
        type: "summary",
        delayMs: 5000,
      }),
    );
  }
  // Granular invalidation: refetch the parent block bundle (includes updated summary)
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    projectId: access.projectId,
    targets: [queryKeys.blocks.get(access.item.blockId, "draft"), queryKeys.blocks.getUsageCounts],
  });
  const updated = yield* Effect.promise(() =>
    ctx.db.select().from(repeatableItems).where(eq(repeatableItems.id, id)).get(),
  );
  return updated;
});

export const deleteRepeatableItem = Effect.fn("repeatableItems.deleteRepeatableItem")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof deleteRepeatableItemInput>,
) {
  const user = yield* requireUser(ctx);
  const { id } = yield* decodeInput(deleteRepeatableItemInput, rawInput);
  const access = yield* assertRepeatableItemAccess(ctx.db, id, user.id);

  const blockId = access.item.blockId;
  const schema = (yield* loadBlockSchemas(ctx.db, access.projectId, blockId))?.contentSchema;
  const itemPath = yield* resolveItemFieldNamePath(
    ctx.db,
    blockId,
    access.item.parentItemId,
    access.item.fieldName,
  );
  const repeater = yield* descendRepeaterSchema(schema, itemPath);
  const siblings = (yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(repeatableItems)
      .where(
        and(
          eq(repeatableItems.blockId, blockId),
          eq(repeatableItems.fieldName, access.item.fieldName),
        ),
      ),
  )).filter((item) => item.parentItemId === access.item.parentItemId);
  yield* validateRepeaterCount(repeater, siblings.length - 1, itemPath.join("."));
  const result = yield* Effect.promise(() =>
    ctx.db.delete(repeatableItems).where(eq(repeatableItems.id, id)).returning().get(),
  );
  yield* syncBlockData(ctx, blockId);
  yield* bumpContentUpdatedAtForBlock(ctx.db, blockId);
  // Granular invalidation: refetch the parent block bundle (item removed)
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    projectId: access.projectId,
    targets: [
      queryKeys.blocks.get(blockId, "draft"),
      ...(access.pagePath
        ? [queryKeys.pages.getByPath(access.pagePath, "draft")]
        : [queryKeys.pages.getByPathAll]),
      queryKeys.pages.list,
      queryKeys.blocks.getUsageCounts,
    ],
  });
  return result;
});
