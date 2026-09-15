import { queryKeys } from "@camox/api-contract/query-keys";
import { ORPCError } from "@orpc/server";
import { chat } from "@tanstack/ai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import { and, eq, inArray } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { outdent } from "outdent";
import { z } from "zod";

import { assertBlockAccess, assertRepeatableItemAccess } from "../../authorization";
import type { Database } from "../../db";
import { broadcastInvalidation } from "../../lib/broadcast-invalidation";
import {
  bumpContentUpdatedAt,
  bumpContentUpdatedAtForBlock,
} from "../../lib/bump-content-updated-at";
import { scheduleAiJob } from "../../lib/schedule-ai-job";
import { blockDefinitions, blocks, files, repeatableItems } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
import { sanitizeItemContent, type SchemaProps } from "../blocks/normalize-content";
import { syncBlockData } from "../blocks/synced";
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

function assertUser(ctx: ServiceContext) {
  if (!ctx.user) throw new ORPCError("UNAUTHORIZED");
  return ctx.user;
}

// --- Schema resolution for item content normalization ---

async function loadBlockDefSchema(
  db: Database,
  projectId: number,
  blockId: number,
): Promise<{ properties?: SchemaProps } | null> {
  const block = await db.select().from(blocks).where(eq(blocks.id, blockId)).get();
  if (!block) return null;
  const def = await db
    .select()
    .from(blockDefinitions)
    .where(and(eq(blockDefinitions.projectId, projectId), eq(blockDefinitions.blockId, block.type)))
    .get();
  return (def?.contentSchema as { properties?: SchemaProps } | null) ?? null;
}

/** Walk `rootProps` descending into `[fieldName].items.properties` for each path entry. */
function descendItemsProperties(
  rootProps: SchemaProps | undefined,
  fieldNamePath: string[],
): SchemaProps | undefined {
  let props = rootProps;
  for (const fieldName of fieldNamePath) {
    if (!props) return undefined;
    props = props[fieldName]?.items?.properties;
  }
  return props;
}

/**
 * Build the contentSchema field-name path that leads to this item's
 * `items.properties` — i.e. the schema describing the item's own content.
 * Walks the parentItemId chain in the DB to compose the ancestor list.
 */
async function resolveItemFieldNamePath(
  db: Database,
  blockId: number,
  parentItemId: number | null,
  fieldName: string,
): Promise<string[]> {
  if (parentItemId == null) return [fieldName];
  const all = await db
    .select({
      id: repeatableItems.id,
      parentItemId: repeatableItems.parentItemId,
      fieldName: repeatableItems.fieldName,
    })
    .from(repeatableItems)
    .where(eq(repeatableItems.blockId, blockId));
  const byId = new Map(all.map((i) => [i.id, i]));
  const ancestors: string[] = [];
  let cur: number | null = parentItemId;
  while (cur != null) {
    const item = byId.get(cur);
    if (!item) break;
    ancestors.unshift(item.fieldName);
    cur = item.parentItemId;
  }
  return [...ancestors, fieldName];
}

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

async function generateObjectSummary(
  apiKey: string,
  options: { type: string; markdown: string; previousSummary?: string },
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

  return await chat({
    adapter: createOpenRouterText("openai/gpt-oss-20b", apiKey),
    stream: false,
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
  });
}

/**
 * Generates and stores a summary for a repeatable item.
 * Returns `{ blockId }` so the caller can cascade to block summary regeneration.
 */
export async function executeRepeatableItemSummary(
  db: Database,
  apiKey: string,
  itemId: number,
): Promise<{ blockId: number } | null> {
  const item = await db.select().from(repeatableItems).where(eq(repeatableItems.id, itemId)).get();
  if (!item) return null;

  const block = await db.select().from(blocks).where(eq(blocks.id, item.blockId)).get();
  if (!block) return null;

  const summary = await generateObjectSummary(apiKey, {
    type: block.type,
    markdown: JSON.stringify(item.content),
    previousSummary: item.summary,
  });

  await db
    .update(repeatableItems)
    .set({ summary, updatedAt: Date.now() })
    .where(eq(repeatableItems.id, itemId));

  if (summary !== item.summary) {
    return { blockId: item.blockId };
  }

  return null;
}

// --- Reads ---

export async function getRepeatableItem(
  ctx: ServiceContext,
  rawInput: z.input<typeof getRepeatableItemInput>,
) {
  const { id } = getRepeatableItemInput.parse(rawInput);
  const item = await ctx.db.select().from(repeatableItems).where(eq(repeatableItems.id, id)).get();
  if (!item) throw new ORPCError("NOT_FOUND");

  // Collect and fetch referenced files
  const fileIds = new Set<number>();
  collectFileIds(item.content as Record<string, unknown>, fileIds);

  const fileRows =
    fileIds.size > 0
      ? await ctx.db
          .select()
          .from(files)
          .where(inArray(files.id, [...fileIds]))
      : [];

  return {
    item,
    files: fileRows,
  };
}

// --- Writes ---

export async function createRepeatableItem(
  ctx: ServiceContext,
  rawInput: z.input<typeof createRepeatableItemInput>,
) {
  const user = assertUser(ctx);
  const { blockId, parentItemId, fieldName, content, settings, afterPosition, nestedItems } =
    createRepeatableItemInput.parse(rawInput);
  const access = await assertBlockAccess(ctx.db, blockId, user.id);
  if (!access) throw new ORPCError("NOT_FOUND");

  const now = Date.now();

  // Resolve schema for sanitization. The root item's content is described by
  // `descendItemsProperties(schema.properties, [...ancestors, fieldName])`.
  const schema = await loadBlockDefSchema(ctx.db, access.projectId, blockId);
  const rootPath = await resolveItemFieldNamePath(ctx.db, blockId, parentItemId ?? null, fieldName);
  const rootItemProps = descendItemsProperties(schema?.properties, rootPath);
  const sanitizedContent = sanitizeItemContent(content, rootItemProps);

  // Get siblings to determine correct position
  const siblings = (
    await ctx.db
      .select()
      .from(repeatableItems)
      .where(and(eq(repeatableItems.blockId, blockId), eq(repeatableItems.fieldName, fieldName)))
  ).sort((a, b) => comparePositions(a.position, b.position));

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

  const result = await ctx.db
    .insert(repeatableItems)
    .values({
      blockId,
      parentItemId: parentItemId ?? null,
      fieldName,
      content: sanitizedContent,
      settings: (settings as Record<string, unknown> | undefined) ?? null,
      summary: "",
      position,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  // Insert client-provided nested item seeds
  if (nestedItems && nestedItems.length > 0) {
    const tempIdToRealId = new Map<string, number>();
    const seedById = new Map(nestedItems.map((s) => [s.tempId, s]));

    // Build the path of fieldNames from the root contentSchema down to a seed's
    // own items.properties. Walks the seed's parentTempId chain in-memory and
    // prepends the just-created root item's path.
    const seedPath = (seed: (typeof nestedItems)[number]): string[] => {
      const chain: string[] = [];
      let cur: string | null = seed.tempId;
      while (cur != null) {
        const s = seedById.get(cur);
        if (!s) break;
        chain.unshift(s.fieldName);
        cur = s.parentTempId;
      }
      return [...rootPath, ...chain];
    };

    for (const seed of nestedItems) {
      // null parentTempId means child of the item being created
      const seedParentId = seed.parentTempId
        ? (tempIdToRealId.get(seed.parentTempId) ?? result.id)
        : result.id;
      const seedItemProps = descendItemsProperties(schema?.properties, seedPath(seed));
      const sanitizedSeedContent = sanitizeItemContent(seed.content, seedItemProps);
      const inserted = await ctx.db
        .insert(repeatableItems)
        .values({
          blockId,
          parentItemId: seedParentId,
          fieldName: seed.fieldName,
          content: sanitizedSeedContent,
          settings: (seed.settings as Record<string, unknown> | undefined) ?? null,
          summary: "",
          position: seed.position,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      tempIdToRealId.set(seed.tempId, inserted.id);
    }
  }

  await syncBlockData(ctx, blockId);
  await bumpContentUpdatedAt(ctx.db, access.block);

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
}

export async function updateRepeatableItemContent(
  ctx: ServiceContext,
  rawInput: z.input<typeof updateRepeatableItemContentInput>,
) {
  const user = assertUser(ctx);
  const { id, content } = updateRepeatableItemContentInput.parse(rawInput);
  const access = await assertRepeatableItemAccess(ctx.db, id, user.id);
  if (!access) throw new ORPCError("NOT_FOUND");

  // Resolve schema for the patch and sanitize asset leaks before merging.
  const schema = await loadBlockDefSchema(ctx.db, access.projectId, access.item.blockId);
  const itemPath = await resolveItemFieldNamePath(
    ctx.db,
    access.item.blockId,
    access.item.parentItemId,
    access.item.fieldName,
  );
  const itemProps = descendItemsProperties(schema?.properties, itemPath);
  const sanitizedPatch = sanitizeItemContent(content, itemProps);

  // Merge partial content into existing content (frontend sends single-field patches)
  const merged = {
    ...(access.item.content as Record<string, unknown>),
    ...sanitizedPatch,
  };
  const result = await ctx.db
    .update(repeatableItems)
    .set({ content: merged, updatedAt: Date.now() })
    .where(eq(repeatableItems.id, id))
    .returning()
    .get();

  await syncBlockData(ctx, access.item.blockId);
  await bumpContentUpdatedAtForBlock(ctx.db, access.item.blockId);

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
}

export async function updateRepeatableItemSettings(
  ctx: ServiceContext,
  rawInput: z.input<typeof updateRepeatableItemSettingsInput>,
) {
  const user = assertUser(ctx);
  const { id, settings } = updateRepeatableItemSettingsInput.parse(rawInput);
  const access = await assertRepeatableItemAccess(ctx.db, id, user.id);
  if (!access) throw new ORPCError("NOT_FOUND");

  const merged = {
    ...(access.item.settings as Record<string, unknown> | null),
    ...(settings as Record<string, unknown>),
  };
  const result = await ctx.db
    .update(repeatableItems)
    .set({ settings: merged, updatedAt: Date.now() })
    .where(eq(repeatableItems.id, id))
    .returning()
    .get();

  await syncBlockData(ctx, access.item.blockId);
  await bumpContentUpdatedAtForBlock(ctx.db, access.item.blockId);

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
}

export async function updateRepeatableItemPosition(
  ctx: ServiceContext,
  rawInput: z.input<typeof updateRepeatableItemPositionInput>,
) {
  const user = assertUser(ctx);
  const { id, afterPosition, beforePosition } = updateRepeatableItemPositionInput.parse(rawInput);
  const access = await assertRepeatableItemAccess(ctx.db, id, user.id);
  if (!access) throw new ORPCError("NOT_FOUND");

  const item = access.item;
  const siblings = (
    await ctx.db
      .select()
      .from(repeatableItems)
      .where(
        and(
          eq(repeatableItems.blockId, item.blockId),
          eq(repeatableItems.fieldName, item.fieldName),
        ),
      )
  )
    .filter((s) => s.id !== id)
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

  const result = await ctx.db
    .update(repeatableItems)
    .set({ position, updatedAt: Date.now() })
    .where(eq(repeatableItems.id, id))
    .returning()
    .get();
  await syncBlockData(ctx, access.item.blockId);
  await bumpContentUpdatedAtForBlock(ctx.db, access.item.blockId);
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
}

export async function duplicateRepeatableItem(
  ctx: ServiceContext,
  rawInput: z.input<typeof duplicateRepeatableItemInput>,
) {
  const user = assertUser(ctx);
  const { id } = duplicateRepeatableItemInput.parse(rawInput);
  const access = await assertRepeatableItemAccess(ctx.db, id, user.id);
  if (!access) throw new ORPCError("NOT_FOUND");
  const original = access.item;

  const now = Date.now();

  // Find the next sibling to insert between original and next
  const siblings = (
    await ctx.db
      .select()
      .from(repeatableItems)
      .where(
        and(
          eq(repeatableItems.blockId, original.blockId),
          eq(repeatableItems.fieldName, original.fieldName),
        ),
      )
  ).sort((a, b) => comparePositions(a.position, b.position));
  const originalIndex = siblings.findIndex((s) => s.id === id);
  const nextItem = originalIndex >= 0 ? siblings[originalIndex + 1] : undefined;
  const position = generateKeyBetween(original.position, nextItem?.position ?? null);

  const result = await ctx.db
    .insert(repeatableItems)
    .values({
      blockId: original.blockId,
      fieldName: original.fieldName,
      content: original.content,
      settings: original.settings,
      summary: original.summary,
      position,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  await syncBlockData(ctx, original.blockId);
  await bumpContentUpdatedAtForBlock(ctx.db, original.blockId);
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
}

export async function generateRepeatableItemSummary(
  ctx: ServiceContext,
  rawInput: z.input<typeof generateRepeatableItemSummaryInput>,
) {
  const user = assertUser(ctx);
  const { id } = generateRepeatableItemSummaryInput.parse(rawInput);
  const access = await assertRepeatableItemAccess(ctx.db, id, user.id);
  if (!access) throw new ORPCError("NOT_FOUND");

  const cascade = await executeRepeatableItemSummary(ctx.db, ctx.env.OPEN_ROUTER_API_KEY, id);
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
  const updated = await ctx.db
    .select()
    .from(repeatableItems)
    .where(eq(repeatableItems.id, id))
    .get();
  return updated;
}

export async function deleteRepeatableItem(
  ctx: ServiceContext,
  rawInput: z.input<typeof deleteRepeatableItemInput>,
) {
  const user = assertUser(ctx);
  const { id } = deleteRepeatableItemInput.parse(rawInput);
  const access = await assertRepeatableItemAccess(ctx.db, id, user.id);
  if (!access) throw new ORPCError("NOT_FOUND");

  const blockId = access.item.blockId;
  const result = await ctx.db
    .delete(repeatableItems)
    .where(eq(repeatableItems.id, id))
    .returning()
    .get();
  await syncBlockData(ctx, blockId);
  await bumpContentUpdatedAtForBlock(ctx.db, blockId);
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
}
