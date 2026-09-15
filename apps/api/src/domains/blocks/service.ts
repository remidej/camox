import { queryKeys } from "@camox/api-contract/query-keys";
import { ORPCError } from "@orpc/server";
import { chat } from "@tanstack/ai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { outdent } from "outdent";
import { z } from "zod";

import { assertBlockAccess, assertPageAccess } from "../../authorization";
import type { Database } from "../../db";
import { broadcastInvalidation } from "../../lib/broadcast-invalidation";
import {
  bumpContentUpdatedAt,
  bumpContentUpdatedAtForBlocks,
} from "../../lib/bump-content-updated-at";
import { contentToMarkdown } from "../../lib/content-markdown";
import { resolveEnvironment } from "../../lib/resolve-environment";
import { scheduleAiJob } from "../../lib/schedule-ai-job";
import {
  blockDefinitions,
  blocks,
  files,
  layoutCheckpoints,
  layouts,
  member,
  pageCheckpoints,
  pages,
  projects,
  repeatableItems,
} from "../../schema";
import { pageSourceSchema, type PageSource } from "../_shared/page-source";
import type { ServiceContext } from "../_shared/service-context";
import {
  layoutSnapshotSchema,
  pageSnapshotSchema,
  type SnapshotBlock,
  type SnapshotRepeatableItem,
} from "../_shared/snapshot-schemas";
import { buildFileMap, collectFileIds } from "../pages/ai";
import { readLayoutSnapshot, readPageSnapshot } from "../pages/service";
import { normalizeBlockContent, sanitizeAssetValue, type BlockItemSeed } from "./normalize-content";
import { syncBlockData } from "./synced";
import { resolveSyncedLiveData } from "./synced-live";

// --- Input Schemas ---
// Exported so adapters (oRPC, MCP, CLI) share the same canonical contract.
// Services .parse() them on entry — service is the trust boundary.

const repeatableItemSeedSchema = z.object({
  tempId: z.string(),
  parentTempId: z.string().nullable(),
  fieldName: z.string(),
  content: z.unknown(),
  position: z.string(),
});

export const getBlockInput = z.object({
  id: z.number(),
  source: pageSourceSchema.optional().default("live"),
});
export const getPageMarkdownInput = z.object({
  pageId: z.number(),
  source: pageSourceSchema.optional().default("draft"),
});
export const getBlocksUsageCountsInput = z.object({ projectId: z.number() });
export const createBlockInput = z.object({
  pageId: z.number(),
  type: z.string(),
  content: z.unknown(),
  settings: z.unknown().optional(),
  afterPosition: z.string().nullable().optional(),
  beforePosition: z.string().nullable().optional(),
  repeatableItems: z.array(repeatableItemSeedSchema).optional(),
});
export const updateBlockContentInput = z.object({ id: z.number(), content: z.unknown() });
export const updateBlockSettingsInput = z.object({ id: z.number(), settings: z.unknown() });
export const updateBlockPositionInput = z.object({
  id: z.number(),
  afterPosition: z.string().nullable().optional(),
  beforePosition: z.string().nullable().optional(),
});
export const deleteBlockInput = z.object({ id: z.number() });
export const resolveBlockPositionInput = z.object({
  pageId: z.number().optional(),
  blockId: z.number().optional(),
  afterPosition: z.string().nullable().optional(),
  beforePosition: z.string().nullable().optional(),
  afterId: z.number().optional(),
  beforeId: z.number().optional(),
  position: z.enum(["first", "last"]).optional(),
});
export const deleteBlocksInput = z.object({ blockIds: z.array(z.number()) });
export const generateBlockSummaryInput = z.object({ id: z.number() });
export const duplicateBlockInput = z.object({ id: z.number() });

// --- Internal helpers ---

function assertUser(ctx: ServiceContext) {
  if (!ctx.user) throw new ORPCError("UNAUTHORIZED");
  return ctx.user;
}

function comparePositions(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function sortByPosition<T extends { position: string }>(items: T[]): T[] {
  return items.sort((a, b) => comparePositions(a.position, b.position));
}

/**
 * Reduce high-level positioning helpers (`afterId`, `beforeId`, `position`) to
 * the fractional-index strings the create/move services consume. Exactly one
 * positioning input is permitted; passing none returns `{}` (the caller's
 * services treat that as "append to the end").
 *
 * `pageId` is used for `position: "first"` on a move (we need the current
 * first sibling so the service can compute a key strictly before it). For
 * create, "first" is encoded as `afterPosition: ""`, so no lookup is needed.
 */
export async function resolveBlockPosition(
  ctx: ServiceContext,
  rawInput: z.input<typeof resolveBlockPositionInput>,
  opts: { mode: "create" | "move" },
): Promise<{ afterPosition?: string | null; beforePosition?: string | null }> {
  const input = resolveBlockPositionInput.parse(rawInput);
  const passed = [
    input.afterPosition !== undefined ? "afterPosition" : null,
    input.beforePosition !== undefined ? "beforePosition" : null,
    input.afterId !== undefined ? "afterId" : null,
    input.beforeId !== undefined ? "beforeId" : null,
    input.position !== undefined ? "position" : null,
  ].filter((x): x is string => x != null);
  if (passed.length > 1) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Pass at most one positioning input — got: ${passed.join(", ")}.`,
    });
  }

  if (input.afterPosition !== undefined || input.beforePosition !== undefined) {
    return { afterPosition: input.afterPosition, beforePosition: input.beforePosition };
  }

  const lookupSibling = async (id: number) => {
    const sibling = await ctx.db
      .select({ position: blocks.position, pageId: blocks.pageId })
      .from(blocks)
      .where(eq(blocks.id, id))
      .get();
    if (!sibling) throw new ORPCError("NOT_FOUND", { message: `No block with id ${id}.` });
    if (input.pageId != null && sibling.pageId !== input.pageId) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Block ${id} is not on page ${input.pageId}.`,
      });
    }
    return sibling;
  };

  if (input.afterId !== undefined) {
    const sibling = await lookupSibling(input.afterId);
    return { afterPosition: sibling.position };
  }
  if (input.beforeId !== undefined) {
    const sibling = await lookupSibling(input.beforeId);
    return { beforePosition: sibling.position };
  }

  if (input.position === "last") return {};
  if (input.position === "first") {
    if (opts.mode === "create") return { afterPosition: "" };
    let pageId = input.pageId;
    if (pageId == null && input.blockId != null) {
      const target = await ctx.db
        .select({ pageId: blocks.pageId })
        .from(blocks)
        .where(eq(blocks.id, input.blockId))
        .get();
      pageId = target?.pageId ?? undefined;
    }
    if (pageId == null) return {};
    const first = await ctx.db
      .select({ position: blocks.position })
      .from(blocks)
      .where(eq(blocks.pageId, pageId))
      .orderBy(blocks.position)
      .get();
    return { beforePosition: first?.position ?? null };
  }

  return {};
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

/** Recursively nest child items into their parent item's content. */
function nestChildItems(
  allItems: { id: number; parentItemId: number | null; fieldName: string; content: unknown }[],
) {
  const childrenByParent = new Map<number, Map<string, typeof allItems>>();
  for (const item of allItems) {
    if (item.parentItemId === null) continue;
    let fieldMap = childrenByParent.get(item.parentItemId);
    if (!fieldMap) {
      fieldMap = new Map();
      childrenByParent.set(item.parentItemId, fieldMap);
    }
    const list = fieldMap.get(item.fieldName) ?? [];
    list.push(item);
    fieldMap.set(item.fieldName, list);
  }
  for (const item of allItems) {
    const childFields = childrenByParent.get(item.id);
    if (!childFields) continue;
    const content = item.content as Record<string, unknown>;
    for (const [fieldName, children] of childFields) {
      content[fieldName] = children;
    }
  }
}

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

async function assembleBlockContent(db: Database, blockId: number) {
  const block = await db.select().from(blocks).where(eq(blocks.id, blockId)).get();
  if (!block) return null;

  // Get block definition for content schema and field order. Scope by
  // environmentId — the same blockId can exist with different shapes across
  // environments (e.g. mid-migration).
  let projectId: number | null = null;
  let environmentId: number | null = null;
  if (block.pageId) {
    const page = await db.select().from(pages).where(eq(pages.id, block.pageId)).get();
    projectId = page?.projectId ?? null;
    environmentId = page?.environmentId ?? null;
  } else if (block.layoutId) {
    const layout = await db.select().from(layouts).where(eq(layouts.id, block.layoutId)).get();
    projectId = layout?.projectId ?? null;
    environmentId = layout?.environmentId ?? null;
  }

  const def =
    projectId && environmentId
      ? await db
          .select()
          .from(blockDefinitions)
          .where(
            and(
              eq(blockDefinitions.projectId, projectId),
              eq(blockDefinitions.environmentId, environmentId),
              eq(blockDefinitions.blockId, block.type),
            ),
          )
          .get()
      : null;

  const contentSchema = (def?.contentSchema as Record<string, any>) ?? null;
  const fieldOrder = contentSchema?.properties
    ? Object.keys(contentSchema.properties as Record<string, unknown>)
    : undefined;

  // Merge repeatable items into content
  const items = sortByPosition(
    await db.select().from(repeatableItems).where(eq(repeatableItems.blockId, blockId)),
  );

  nestChildItems(items);

  const content = { ...(block.content as Record<string, unknown>) };
  const topLevelFieldNames = new Set(
    items.filter((item) => item.parentItemId === null).map((item) => item.fieldName),
  );
  for (const fieldName of topLevelFieldNames) {
    content[fieldName] = items.filter((i) => i.fieldName === fieldName && i.parentItemId === null);
  }

  // Reorder keys to match field order from block definition
  if (fieldOrder) {
    const ordered: Record<string, unknown> = {};
    for (const key of fieldOrder) {
      if (key in content) ordered[key] = content[key];
    }
    for (const key of Object.keys(content)) {
      if (!(key in ordered)) ordered[key] = content[key];
    }
    return { block, content: ordered, contentSchema };
  }

  return { block, content, contentSchema };
}

/**
 * Generates and stores a summary for a block.
 * Returns `{ pageId }` if the parent page has AI SEO enabled (caller should cascade).
 */
export async function executeBlockSummary(
  db: Database,
  apiKey: string,
  blockId: number,
): Promise<{ pageId: number } | null> {
  const assembled = await assembleBlockContent(db, blockId);
  if (!assembled) return null;

  const { block, content, contentSchema } = assembled;

  const markdown =
    contentSchema?.toMarkdown && contentSchema?.properties
      ? contentToMarkdown(contentSchema.toMarkdown, contentSchema.properties, content, {
          settings: block.settings as Record<string, unknown> | null | undefined,
        })
      : JSON.stringify(content);

  const summary = await generateObjectSummary(apiKey, {
    type: block.type,
    markdown,
    previousSummary: block.summary,
  });

  await db.update(blocks).set({ summary, updatedAt: Date.now() }).where(eq(blocks.id, blockId));

  // Check if we should cascade to page SEO
  if (summary !== block.summary && block.pageId) {
    const page = await db.select().from(pages).where(eq(pages.id, block.pageId)).get();
    if (page?.aiSeoEnabled !== false) {
      return { pageId: block.pageId };
    }
  }

  return null;
}

type FieldSchema = {
  fieldType?: string;
  items?: { properties?: Record<string, FieldSchema> };
};

/**
 * Apply a partial content patch to a block, with replace-within-field semantics
 * for any Repeater fields present in the patch:
 *   - `{ _itemId: N }` keeps existing item N (re-positioned in array order).
 *   - `{ _itemId: N, ...overrides }` updates item N's content; nested repeatable
 *     overrides recurse via this same diff logic.
 *   - Plain inline objects insert new items (with nested children if present).
 *   - Existing items at the same scope not referenced in the new array are deleted
 *     (cascades to nested children via the parentItemId FK).
 *
 * Repeater fields not present in the patch are untouched.
 *
 * Returns the new merged block.content with all Repeater fields stripped —
 * the items table is the source of truth and `getBlock` re-injects markers on read.
 */
async function applyContentPatch(
  ctx: ServiceContext,
  block: { id: number; content: unknown },
  patch: Record<string, unknown>,
  contentSchema: unknown,
  now: number,
): Promise<Record<string, unknown>> {
  const props = (contentSchema as { properties?: Record<string, FieldSchema> } | null)?.properties;

  // Start from existing content with all known repeatable fields stripped (items
  // table is truth). This also clears any pre-existing ghost data.
  const merged: Record<string, unknown> = { ...(block.content as Record<string, unknown>) };
  if (props) {
    for (const [key, fieldSchema] of Object.entries(props)) {
      if (fieldSchema.fieldType === "Repeater") delete merged[key];
    }
  }

  let allItems: Awaited<ReturnType<typeof fetchBlockItems>> | null = null;
  for (const [key, value] of Object.entries(patch)) {
    const fieldSchema = props?.[key];
    if (fieldSchema?.fieldType !== "Repeater") {
      if (fieldSchema?.fieldType === "Image" || fieldSchema?.fieldType === "File") {
        merged[key] = sanitizeAssetValue(value);
      } else {
        merged[key] = value;
      }
      continue;
    }
    if (allItems === null) allItems = await fetchBlockItems(ctx, block.id);
    await applyRepeatableFieldPatch(ctx, {
      blockId: block.id,
      parentItemId: null,
      fieldName: key,
      newArray: value,
      allItems,
      itemSchemaProps: fieldSchema.items?.properties,
      now,
    });
  }
  return merged;
}

async function fetchBlockItems(ctx: ServiceContext, blockId: number) {
  return await ctx.db.select().from(repeatableItems).where(eq(repeatableItems.blockId, blockId));
}

async function applyRepeatableFieldPatch(
  ctx: ServiceContext,
  args: {
    blockId: number;
    parentItemId: number | null;
    fieldName: string;
    newArray: unknown;
    allItems: Awaited<ReturnType<typeof fetchBlockItems>>;
    itemSchemaProps: Record<string, FieldSchema> | undefined;
    now: number;
  },
): Promise<void> {
  const { blockId, parentItemId, fieldName, newArray, allItems, itemSchemaProps, now } = args;
  if (newArray == null) return;
  if (!Array.isArray(newArray)) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Field "${fieldName}" is repeatable; expected an array`,
      data: { field: fieldName },
    });
  }

  const scopeItems = allItems.filter(
    (i) => i.parentItemId === parentItemId && i.fieldName === fieldName,
  );
  const existingById = new Map(scopeItems.map((i) => [i.id, i]));
  const referenced = new Set<number>();

  let prevPos: string | null = null;
  for (const element of newArray) {
    if (element == null || typeof element !== "object" || Array.isArray(element)) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Field "${fieldName}" element must be an object`,
        data: { field: fieldName },
      });
    }
    const elementObj = element as Record<string, unknown>;
    const rawItemId = elementObj._itemId;
    const itemId = typeof rawItemId === "number" ? rawItemId : null;
    const position = generateKeyBetween(prevPos, null);
    prevPos = position;

    if (itemId === null && rawItemId !== undefined) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Field "${fieldName}" element has invalid _itemId`,
        data: { field: fieldName },
      });
    }

    if (itemId !== null) {
      const existing = existingById.get(itemId);
      if (!existing) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Field "${fieldName}" references item ${itemId} but no such item exists at this scope`,
          data: { field: fieldName },
        });
      }
      referenced.add(itemId);

      // Build content overrides + recurse into any nested repeatable overrides.
      const nonRepeatableOverrides: Record<string, unknown> = {};
      let hasOverride = false;
      for (const [k, v] of Object.entries(elementObj)) {
        if (k === "_itemId") continue;
        const subSchema = itemSchemaProps?.[k];
        if (subSchema?.fieldType === "Repeater") {
          await applyRepeatableFieldPatch(ctx, {
            blockId,
            parentItemId: itemId,
            fieldName: k,
            newArray: v,
            allItems,
            itemSchemaProps: subSchema.items?.properties,
            now,
          });
          continue;
        }
        nonRepeatableOverrides[k] = v;
        hasOverride = true;
      }

      const existingContent = (existing.content as Record<string, unknown> | null) ?? {};
      const newContent: Record<string, unknown> = hasOverride
        ? { ...existingContent, ...nonRepeatableOverrides }
        : { ...existingContent };
      // Strip stale repeatable fields from item content (items table is truth).
      if (itemSchemaProps) {
        for (const [k, schema] of Object.entries(itemSchemaProps)) {
          if (schema.fieldType === "Repeater") delete newContent[k];
        }
      }

      await ctx.db
        .update(repeatableItems)
        .set({ content: newContent, position, updatedAt: now })
        .where(eq(repeatableItems.id, itemId));
      continue;
    }

    // New inline item — normalize against the item schema, insert it, then insert
    // any nested-repeatable seeds it produced as descendants of the new item.
    const { content: itemContent, seeds: childSeeds } = normalizeBlockContent(elementObj, {
      properties: itemSchemaProps,
    });
    const inserted = await ctx.db
      .insert(repeatableItems)
      .values({
        blockId,
        parentItemId,
        fieldName,
        content: itemContent,
        summary: "",
        position,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    if (childSeeds.length > 0) {
      const tempIdToRealId = new Map<string, number>();
      for (const seed of childSeeds) {
        // parentTempId === null → child of the just-inserted item; otherwise resolve.
        const seedParent = seed.parentTempId
          ? (tempIdToRealId.get(seed.parentTempId) ?? inserted.id)
          : inserted.id;
        const sub = await ctx.db
          .insert(repeatableItems)
          .values({
            blockId,
            parentItemId: seedParent,
            fieldName: seed.fieldName,
            content: seed.content,
            summary: "",
            position: seed.position,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        tempIdToRealId.set(seed.tempId, sub.id);
      }
    }
  }

  // Delete unreferenced existing items (cascades to nested children via FK).
  for (const item of scopeItems) {
    if (referenced.has(item.id)) continue;
    await ctx.db.delete(repeatableItems).where(eq(repeatableItems.id, item.id));
  }
}

// --- Reads ---

async function loadBlockBundle(
  ctx: ServiceContext,
  blockId: number,
  source: PageSource,
): Promise<{ block: SnapshotBlock | null; items: SnapshotRepeatableItem[] }> {
  if (source === "draft") {
    const block = (await ctx.db.select().from(blocks).where(eq(blocks.id, blockId)).get()) ?? null;
    if (!block) return { block: null, items: [] };
    const items = await ctx.db
      .select()
      .from(repeatableItems)
      .where(eq(repeatableItems.blockId, block.id));
    // The drizzle row shape is structurally compatible with SnapshotBlock /
    // SnapshotRepeatableItem (same columns, same nullability), so casting
    // through the union return type is safe here.
    return { block, items };
  }

  // Non-draft: find the parent (page or layout) by the live block row's
  // parent ids, then pull the block + its items out of the parent's snapshot.
  const liveBlock = await ctx.db.select().from(blocks).where(eq(blocks.id, blockId)).get();
  if (!liveBlock) return { block: null, items: [] };

  if (liveBlock.pageId != null) {
    const parentPage = await ctx.db
      .select()
      .from(pages)
      .where(eq(pages.id, liveBlock.pageId))
      .get();
    if (!parentPage) return { block: null, items: [] };
    const checkpointId =
      source === "live" ? parentPage.livePublishedCheckpointId : source.checkpointId;
    if (checkpointId == null) return { block: null, items: [] };
    const checkpoint = await ctx.db
      .select()
      .from(pageCheckpoints)
      .where(eq(pageCheckpoints.id, checkpointId))
      .get();
    if (!checkpoint) return { block: null, items: [] };
    if (typeof source === "object" && checkpoint.pageId !== parentPage.id) {
      return { block: null, items: [] };
    }
    const stored = pageSnapshotSchema.parse(JSON.parse(checkpoint.snapshot));
    const snapshot =
      source === "live"
        ? await resolveSyncedLiveData(ctx, parentPage.environmentId, stored)
        : stored;
    const block = snapshot.blocks.find((b) => b.id === blockId) ?? null;
    if (!block) return { block: null, items: [] };
    return { block, items: snapshot.repeatableItems.filter((i) => i.blockId === blockId) };
  }
  if (liveBlock.layoutId != null) {
    const parentLayout = await ctx.db
      .select()
      .from(layouts)
      .where(eq(layouts.id, liveBlock.layoutId))
      .get();
    if (!parentLayout) return { block: null, items: [] };
    // See readLayoutSnapshot in pages/service.ts: in phase 1 the layout side
    // always follows its own live pointer regardless of source.
    const checkpointId = parentLayout.livePublishedCheckpointId;
    if (checkpointId == null) return { block: null, items: [] };
    const checkpoint = await ctx.db
      .select()
      .from(layoutCheckpoints)
      .where(eq(layoutCheckpoints.id, checkpointId))
      .get();
    if (!checkpoint) return { block: null, items: [] };
    const snapshot = await resolveSyncedLiveData(
      ctx,
      parentLayout.environmentId,
      layoutSnapshotSchema.parse(JSON.parse(checkpoint.snapshot)),
    );
    const block = snapshot.blocks.find((b) => b.id === blockId) ?? null;
    if (!block) return { block: null, items: [] };
    return { block, items: snapshot.repeatableItems.filter((i) => i.blockId === blockId) };
  }
  return { block: null, items: [] };
}

export async function getBlock(ctx: ServiceContext, rawInput: z.input<typeof getBlockInput>) {
  const { id, source } = getBlockInput.parse(rawInput);
  // For non-draft reads, locate the block + its items inside the parent
  // page/layout's snapshot rather than the live tables. Mildly wasteful — we
  // parse the whole snapshot to pull one block — but blocks.get against
  // 'live' / { checkpointId } is never the hot path. The edit loop stays on
  // 'draft'.
  const { block, items: sourcedItems } = await loadBlockBundle(ctx, id, source);
  if (!block) throw new ORPCError("NOT_FOUND");
  const sorted = sourcedItems.sort((a, b) => comparePositions(a.position, b.position));

  // Build a map of parentItemId → grouped children by fieldName
  const childrenByParent = new Map<number | null, Map<string, typeof sorted>>();
  for (const item of sorted) {
    let fieldMap = childrenByParent.get(item.parentItemId);
    if (!fieldMap) {
      fieldMap = new Map();
      childrenByParent.set(item.parentItemId, fieldMap);
    }
    const list = fieldMap.get(item.fieldName) ?? [];
    list.push(item);
    fieldMap.set(item.fieldName, list);
  }

  // Inject _itemId markers only for Repeater fields — i.e., where content
  // doesn't already hold the field's data. Asset list arrays keep their inline
  // _fileId markers stored on the parent; any stray child rows for those fields
  // are ignored.
  const hasInlineArray = (c: Record<string, unknown>, key: string) => {
    const v = c[key];
    return Array.isArray(v) && v.length > 0;
  };

  const content = { ...(block.content as Record<string, unknown>) };
  const topLevelFields = childrenByParent.get(null);
  if (topLevelFields) {
    for (const [fieldName, fieldItems] of topLevelFields) {
      if (hasInlineArray(content, fieldName)) continue;
      content[fieldName] = fieldItems.map((i) => ({ _itemId: i.id }));
    }
  }

  for (const item of sorted) {
    const nestedFields = childrenByParent.get(item.id);
    if (!nestedFields) continue;
    const itemContent = { ...(item.content as Record<string, unknown>) };
    for (const [fieldName, fieldItems] of nestedFields) {
      if (hasInlineArray(itemContent, fieldName)) continue;
      itemContent[fieldName] = fieldItems.map((i) => ({ _itemId: i.id }));
    }
    (item as any).content = itemContent;
  }

  // Collect and fetch referenced files
  const fileIds = new Set<number>();
  collectFileIds(content, fileIds);
  for (const item of sorted) {
    collectFileIds(item.content as Record<string, unknown>, fileIds);
  }

  const fileRows =
    fileIds.size > 0
      ? await ctx.db
          .select()
          .from(files)
          .where(inArray(files.id, [...fileIds]))
      : [];

  return {
    block: { ...block, content },
    repeatableItems: sorted,
    files: fileRows,
  };
}

export async function getPageMarkdown(
  ctx: ServiceContext,
  rawInput: z.input<typeof getPageMarkdownInput>,
) {
  const { pageId, source } = getPageMarkdownInput.parse(rawInput);

  const page = await ctx.db.select().from(pages).where(eq(pages.id, pageId)).get();
  if (!page) throw new ORPCError("NOT_FOUND");

  // Get block definitions for content schemas and toMarkdown templates. Scope
  // by environmentId — the same blockId can exist with different shapes across
  // environments (e.g. mid-migration).
  const defs = await ctx.db
    .select()
    .from(blockDefinitions)
    .where(
      and(
        eq(blockDefinitions.projectId, page.projectId),
        eq(blockDefinitions.environmentId, page.environmentId),
      ),
    );
  const schemaByType = new Map<
    string,
    { title: string; properties: Record<string, any>; toMarkdown?: readonly string[] }
  >();
  for (const def of defs) {
    const schema = def.contentSchema as Record<string, unknown> | null;
    if (schema?.properties) {
      schemaByType.set(def.blockId, {
        title: def.title,
        properties: schema.properties as Record<string, any>,
        toMarkdown: schema.toMarkdown as readonly string[] | undefined,
      });
    }
  }

  // Page blocks + their items, sourced from either the live tables (draft) or
  // the published checkpoint (live / pinned). SnapshotBlock and the drizzle
  // row shape are structurally compatible — same columns, same nullability —
  // so the renderer below works against either.
  type RenderableBlock = SnapshotBlock;
  type RenderableItem = SnapshotRepeatableItem;
  let sorted: RenderableBlock[];
  let allItems: RenderableItem[];
  let sortedLayout: RenderableBlock[] = [];
  let layoutAllItems: RenderableItem[] = [];

  if (source === "draft") {
    const pageBlocks = await ctx.db.select().from(blocks).where(eq(blocks.pageId, pageId));
    sorted = pageBlocks.sort((a, b) => comparePositions(a.position, b.position));
    const blockIds = sorted.map((b) => b.id);
    allItems =
      blockIds.length > 0
        ? sortByPosition(
            await ctx.db
              .select()
              .from(repeatableItems)
              .where(inArray(repeatableItems.blockId, blockIds)),
          )
        : [];
    if (page.layoutId) {
      const layoutBlocks = await ctx.db
        .select()
        .from(blocks)
        .where(eq(blocks.layoutId, page.layoutId));
      sortedLayout = layoutBlocks.sort((a, b) => comparePositions(a.position, b.position));
      const layoutBlockIds = sortedLayout.map((b) => b.id);
      layoutAllItems =
        layoutBlockIds.length > 0
          ? sortByPosition(
              await ctx.db
                .select()
                .from(repeatableItems)
                .where(inArray(repeatableItems.blockId, layoutBlockIds)),
            )
          : [];
    }
  } else {
    const pageSnapshot = await readPageSnapshot(ctx, page, source);
    if (!pageSnapshot) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "Page has not been published. Run `camox pages publish` first, or omit --live to read the draft.",
      });
    }
    sorted = sortByPosition(pageSnapshot.blocks);
    allItems = sortByPosition(pageSnapshot.repeatableItems);
    // Phase 1 contract: the layout side always follows its own live pointer
    // when reading a non-draft page (see readLayoutSnapshot). If the layout
    // is unpublished, treat it as empty rather than failing the page read.
    if (page.layoutId) {
      const layout = await ctx.db.select().from(layouts).where(eq(layouts.id, page.layoutId)).get();
      if (layout) {
        const layoutSnapshot = await readLayoutSnapshot(ctx, layout);
        sortedLayout = layoutSnapshot ? sortByPosition(layoutSnapshot.blocks) : [];
        layoutAllItems = layoutSnapshot ? sortByPosition(layoutSnapshot.repeatableItems) : [];
      }
    }
  }

  nestChildItems(allItems);
  const itemsByBlock = new Map<number, RenderableItem[]>();
  for (const item of allItems) {
    if (item.parentItemId !== null) continue;
    const list = itemsByBlock.get(item.blockId) ?? [];
    list.push(item);
    itemsByBlock.set(item.blockId, list);
  }

  const layoutItemsByBlock = new Map<number, RenderableItem[]>();
  if (sortedLayout.length > 0) {
    nestChildItems(layoutAllItems);
    for (const item of layoutAllItems) {
      if (item.parentItemId !== null) continue;
      const list = layoutItemsByBlock.get(item.blockId) ?? [];
      list.push(item);
      layoutItemsByBlock.set(item.blockId, list);
    }
  }

  // Collect every referenced file so {{image}} / {{file}} placeholders resolve to real URLs
  const fileIds = new Set<number>();
  for (const block of [...sorted, ...sortedLayout]) {
    collectFileIds(block.content as Record<string, unknown>, fileIds);
  }
  for (const list of [...itemsByBlock.values(), ...layoutItemsByBlock.values()]) {
    for (const item of list) collectFileIds(item.content as Record<string, unknown>, fileIds);
  }
  const fileMap = await buildFileMap(ctx.db, fileIds);

  const renderBlock = (block: RenderableBlock, items: RenderableItem[]) => {
    const schema = schemaByType.get(block.type);
    if (!schema?.toMarkdown) return JSON.stringify(block.content);
    const content = { ...(block.content as Record<string, unknown>) };
    for (const fieldName of new Set(items.map((i) => i.fieldName))) {
      content[fieldName] = items.filter((i) => i.fieldName === fieldName);
    }
    return `<!-- ${schema.title} -->\n${contentToMarkdown(
      schema.toMarkdown,
      schema.properties,
      content,
      { settings: block.settings as Record<string, unknown> | null | undefined, files: fileMap },
    )}`;
  };

  const beforeParts: string[] = [];
  const afterParts: string[] = [];
  for (const block of sortedLayout) {
    const schema = schemaByType.get(block.type);
    if (!schema?.toMarkdown) continue;
    const md = renderBlock(block, layoutItemsByBlock.get(block.id) ?? []);
    if (block.placement === "before") beforeParts.push(md);
    else afterParts.push(md);
  }
  const beforeMarkdown = beforeParts.join("\n\n");
  const afterMarkdown = afterParts.join("\n\n");

  // Convert page blocks to markdown
  const blockMarkdowns = sorted.map((block) => ({
    id: block.id,
    position: block.position,
    markdown: renderBlock(block, itemsByBlock.get(block.id) ?? []),
  }));

  const parts = [beforeMarkdown, ...blockMarkdowns.map((b) => b.markdown), afterMarkdown].filter(
    Boolean,
  );
  return { markdown: parts.join("\n\n"), blocks: blockMarkdowns };
}

export async function getBlocksUsageCounts(
  ctx: ServiceContext,
  rawInput: z.input<typeof getBlocksUsageCountsInput>,
) {
  const { projectId } = getBlocksUsageCountsInput.parse(rawInput);
  const environment = await resolveEnvironment(ctx.db, projectId, ctx.environmentName);
  return await ctx.db
    .select({
      type: blocks.type,
      count: sql<number>`count(*)`,
    })
    .from(blocks)
    .leftJoin(pages, eq(blocks.pageId, pages.id))
    .leftJoin(layouts, eq(blocks.layoutId, layouts.id))
    .where(or(eq(pages.environmentId, environment.id), eq(layouts.environmentId, environment.id)))
    .groupBy(blocks.type);
}

// --- Writes ---

export async function createBlock(ctx: ServiceContext, rawInput: z.input<typeof createBlockInput>) {
  const user = assertUser(ctx);
  const {
    pageId,
    type,
    content,
    settings,
    afterPosition,
    beforePosition,
    repeatableItems: itemSeeds,
  } = createBlockInput.parse(rawInput);
  const access = await assertPageAccess(ctx.db, pageId, user.id);
  if (!access) throw new ORPCError("NOT_FOUND");

  const now = Date.now();

  // Look up the block definition's content schema and normalize inline repeatable
  // arrays into seeds, so the agent (and any caller) can produce a flat shape.
  // Scope by environmentId — the same blockId can exist with different shapes
  // across environments (e.g. mid-migration).
  const def = await ctx.db
    .select()
    .from(blockDefinitions)
    .where(
      and(
        eq(blockDefinitions.projectId, access.page.projectId),
        eq(blockDefinitions.environmentId, access.page.environmentId),
        eq(blockDefinitions.blockId, type),
      ),
    )
    .get();
  const { content: normalizedContent, seeds: autoSeeds } = normalizeBlockContent(
    content,
    def?.contentSchema ?? null,
  );
  const allSeeds: BlockItemSeed[] = [...(itemSeeds ?? []), ...autoSeeds];

  // Get all blocks for this page to determine correct position
  const pageBlocks = sortByPosition(
    await ctx.db.select().from(blocks).where(eq(blocks.pageId, pageId)),
  );

  if (afterPosition != null && beforePosition != null) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Pass at most one of afterPosition or beforePosition.",
    });
  }
  let position: string;
  if (afterPosition == null && beforePosition == null) {
    // Nothing provided → insert at the end
    const lastBlock = pageBlocks[pageBlocks.length - 1];
    position = generateKeyBetween(lastBlock?.position ?? null, null);
  } else if (afterPosition === "" || beforePosition != null) {
    // Insert before the specified position (empty afterPosition is a synonym for "before the first block")
    const target = beforePosition || null;
    if (!target) {
      const firstBlock = pageBlocks[0];
      position = generateKeyBetween(null, firstBlock?.position ?? null);
    } else {
      const beforeIdx = pageBlocks.findIndex((b) => b.position >= target);
      const nextBlock = beforeIdx >= 0 ? pageBlocks[beforeIdx] : null;
      const prevBlock = beforeIdx > 0 ? pageBlocks[beforeIdx - 1] : null;
      position = generateKeyBetween(prevBlock?.position ?? null, nextBlock?.position ?? null);
    }
  } else {
    // Insert after the specified position
    const afterIndex = findLastIndexLe(pageBlocks, afterPosition!);
    const nextBlock = afterIndex >= 0 ? pageBlocks[afterIndex + 1] : pageBlocks[0];
    position = generateKeyBetween(
      afterIndex >= 0 ? pageBlocks[afterIndex].position : null,
      nextBlock?.position ?? null,
    );
  }
  const result = await ctx.db
    .insert(blocks)
    .values({
      pageId,
      type,
      content: normalizedContent,
      settings: settings ?? null,
      position,
      summary: "",
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  // Insert repeatable item seeds in topological order (parents before children)
  if (allSeeds.length > 0) {
    const tempIdToRealId = new Map<string, number>();

    for (const seed of allSeeds) {
      const parentItemId = seed.parentTempId
        ? (tempIdToRealId.get(seed.parentTempId) ?? null)
        : null;
      const inserted = await ctx.db
        .insert(repeatableItems)
        .values({
          blockId: result.id,
          parentItemId,
          fieldName: seed.fieldName,
          content: seed.content,
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

  await syncBlockData(ctx, result.id, true);
  await bumpContentUpdatedAt(ctx.db, { pageId });

  ctx.waitUntil(
    scheduleAiJob(ctx.env.AI_JOB_SCHEDULER, {
      entityTable: "blocks",
      entityId: result.id,
      type: "summary",
      delayMs: 0,
    }),
  );
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    projectId: access.page.projectId,
    targets: [
      // Block create/delete/duplicate restructures the page — refetch the
      // draft page view. The live snapshot is untouched, so its cache stays.
      queryKeys.pages.getByPath(access.page.fullPath, "draft"),
      // Page list refetches so the derived publish-status badge picks up the
      // new `content_updated_at`.
      queryKeys.pages.list,
      queryKeys.blocks.getPageMarkdown(pageId),
      queryKeys.blocks.getUsageCounts,
    ],
  });

  return (await ctx.db.select().from(blocks).where(eq(blocks.id, result.id)).get())!;
}

export async function updateBlockContent(
  ctx: ServiceContext,
  rawInput: z.input<typeof updateBlockContentInput>,
) {
  const user = assertUser(ctx);
  const { id, content } = updateBlockContentInput.parse(rawInput);
  const access = await assertBlockAccess(ctx.db, id, user.id);
  if (!access) throw new ORPCError("NOT_FOUND");

  const now = Date.now();

  // Look up the block definition's content schema so the patch helper can detect
  // Repeater fields and apply replace-within-field semantics. Scope by
  // environmentId — definitions are per-environment, and the same blockId can
  // exist in dev and prod with different shapes (e.g. mid-migration from
  // `Type.RepeatableItem` to `Type.Repeater`).
  const environment = await resolveEnvironment(ctx.db, access.projectId, ctx.environmentName);
  const def = await ctx.db
    .select()
    .from(blockDefinitions)
    .where(
      and(
        eq(blockDefinitions.projectId, access.projectId),
        eq(blockDefinitions.environmentId, environment.id),
        eq(blockDefinitions.blockId, access.block.type),
      ),
    )
    .get();

  const patch = (content ?? {}) as Record<string, unknown>;
  const merged = await applyContentPatch(ctx, access.block, patch, def?.contentSchema ?? null, now);

  const result = await ctx.db
    .update(blocks)
    .set({ content: merged, updatedAt: now })
    .where(eq(blocks.id, id))
    .returning()
    .get();

  await syncBlockData(ctx, id);
  await bumpContentUpdatedAt(ctx.db, access.block);

  ctx.waitUntil(
    scheduleAiJob(ctx.env.AI_JOB_SCHEDULER, {
      entityTable: "blocks",
      entityId: id,
      type: "summary",
      delayMs: 5000,
    }),
  );
  // Granular invalidation: only refetch this block, not the entire page.
  // Draft source only — the live snapshot doesn't change on edits.
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    projectId: access.projectId,
    targets: [
      queryKeys.blocks.get(id, "draft"),
      ...(access.pagePath
        ? [queryKeys.pages.getByPath(access.pagePath, "draft")]
        : [queryKeys.pages.getByPathAll]),
      queryKeys.pages.list,
      ...(access.block.pageId ? [queryKeys.blocks.getPageMarkdown(access.block.pageId)] : []),
    ],
  });

  return result;
}

export async function updateBlockSettings(
  ctx: ServiceContext,
  rawInput: z.input<typeof updateBlockSettingsInput>,
) {
  const user = assertUser(ctx);
  const { id, settings } = updateBlockSettingsInput.parse(rawInput);
  const access = await assertBlockAccess(ctx.db, id, user.id);
  if (!access) throw new ORPCError("NOT_FOUND");

  const merged = {
    ...(access.block.settings as Record<string, unknown> | null),
    ...(settings as Record<string, unknown>),
  };
  const result = await ctx.db
    .update(blocks)
    .set({ settings: merged, updatedAt: Date.now() })
    .where(eq(blocks.id, id))
    .returning()
    .get();
  await syncBlockData(ctx, id);
  await bumpContentUpdatedAt(ctx.db, access.block);
  // Granular invalidation: only refetch this block, not the entire page.
  // Draft source only — the live snapshot doesn't change on edits.
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    projectId: access.projectId,
    targets: [
      queryKeys.blocks.get(id, "draft"),
      ...(access.pagePath
        ? [queryKeys.pages.getByPath(access.pagePath, "draft")]
        : [queryKeys.pages.getByPathAll]),
      queryKeys.pages.list,
      ...(access.block.pageId ? [queryKeys.blocks.getPageMarkdown(access.block.pageId)] : []),
    ],
  });
  return result;
}

export async function updateBlockPosition(
  ctx: ServiceContext,
  rawInput: z.input<typeof updateBlockPositionInput>,
) {
  const user = assertUser(ctx);
  const { id, afterPosition, beforePosition } = updateBlockPositionInput.parse(rawInput);
  const access = await assertBlockAccess(ctx.db, id, user.id);
  if (!access) throw new ORPCError("NOT_FOUND");

  // Query siblings (excluding the block being moved) to compute a correct position
  const block = access.block;
  const parentColumn = block.pageId ? blocks.pageId : blocks.layoutId;
  const parentId = block.pageId ?? block.layoutId;
  const siblings = parentId
    ? sortByPosition(
        (await ctx.db.select().from(blocks).where(eq(parentColumn, parentId))).filter(
          (b) => b.id !== id,
        ),
      )
    : [];

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
    .update(blocks)
    .set({ position, updatedAt: Date.now() })
    .where(eq(blocks.id, id))
    .returning()
    .get();
  await bumpContentUpdatedAt(ctx.db, access.block);
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    projectId: access.projectId,
    targets: [
      ...(access.pagePath
        ? [queryKeys.pages.getByPath(access.pagePath, "draft")]
        : [queryKeys.pages.getByPathAll]),
      queryKeys.pages.list,
      ...(access.block.pageId ? [queryKeys.blocks.getPageMarkdown(access.block.pageId)] : []),
      queryKeys.blocks.getUsageCounts,
    ],
  });
  return result;
}

export async function deleteBlock(ctx: ServiceContext, rawInput: z.input<typeof deleteBlockInput>) {
  const user = assertUser(ctx);
  const { id } = deleteBlockInput.parse(rawInput);
  const access = await assertBlockAccess(ctx.db, id, user.id);
  if (!access) throw new ORPCError("NOT_FOUND");

  const result = await ctx.db.delete(blocks).where(eq(blocks.id, id)).returning().get();
  await bumpContentUpdatedAt(ctx.db, access.block);
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    projectId: access.projectId,
    targets: [
      // Deleting a block restructures the page. Invalidate all active page path
      // reads so Studio preview updates even when the browser path and stored
      // fullPath differ in normalization (for example trailing-slash redirects).
      queryKeys.pages.getByPathAll,
      queryKeys.pages.list,
      ...(access.block.pageId ? [queryKeys.blocks.getPageMarkdown(access.block.pageId)] : []),
      queryKeys.blocks.getUsageCounts,
    ],
  });
  return result;
}

export async function deleteBlocks(
  ctx: ServiceContext,
  rawInput: z.input<typeof deleteBlocksInput>,
) {
  const user = assertUser(ctx);
  const { blockIds } = deleteBlocksInput.parse(rawInput);
  if (blockIds.length === 0) return [];

  // Verify all blocks belong to an org the user is a member of
  const authorizedBlocks = await ctx.db
    .select({ id: blocks.id, projectId: projects.id })
    .from(blocks)
    .leftJoin(pages, eq(blocks.pageId, pages.id))
    .leftJoin(layouts, eq(blocks.layoutId, layouts.id))
    .innerJoin(projects, or(eq(projects.id, pages.projectId), eq(projects.id, layouts.projectId)))
    .innerJoin(
      member,
      and(eq(member.organizationId, projects.organizationId), eq(member.userId, user.id)),
    )
    .where(inArray(blocks.id, blockIds));
  if (authorizedBlocks.length !== blockIds.length) {
    throw new ORPCError("NOT_FOUND");
  }
  // Bump first — once the rows are gone, we can't recover their parents.
  await bumpContentUpdatedAtForBlocks(ctx.db, blockIds);
  const result = await ctx.db.delete(blocks).where(inArray(blocks.id, blockIds)).returning();
  const projectId = authorizedBlocks[0]?.projectId;
  if (projectId) {
    broadcastInvalidation({
      waitUntil: ctx.waitUntil,
      projectRoomNamespace: ctx.env.ProjectRoom,
      projectId,
      targets: [
        queryKeys.pages.getByPathAll,
        queryKeys.pages.list,
        queryKeys.blocks.getUsageCounts,
      ],
    });
  }
  return result;
}

export async function generateBlockSummary(
  ctx: ServiceContext,
  rawInput: z.input<typeof generateBlockSummaryInput>,
) {
  const user = assertUser(ctx);
  const { id } = generateBlockSummaryInput.parse(rawInput);
  const access = await assertBlockAccess(ctx.db, id, user.id);
  if (!access) throw new ORPCError("NOT_FOUND");

  const seoStale = await executeBlockSummary(ctx.db, ctx.env.OPEN_ROUTER_API_KEY, id);
  if (seoStale) {
    ctx.waitUntil(
      scheduleAiJob(ctx.env.AI_JOB_SCHEDULER, {
        entityTable: "pages",
        entityId: seoStale.pageId,
        type: "seo",
        delayMs: 15000,
      }),
    );
  }
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    projectId: access.projectId,
    targets: [
      queryKeys.blocks.get(id, "draft"),
      ...(access.pagePath
        ? [queryKeys.pages.getByPath(access.pagePath, "draft")]
        : [queryKeys.pages.getByPathAll]),
      ...(access.block.pageId ? [queryKeys.blocks.getPageMarkdown(access.block.pageId)] : []),
      queryKeys.blocks.getUsageCounts,
    ],
  });
  const updated = await ctx.db.select().from(blocks).where(eq(blocks.id, id)).get();
  return updated;
}

export async function duplicateBlock(
  ctx: ServiceContext,
  rawInput: z.input<typeof duplicateBlockInput>,
) {
  const user = assertUser(ctx);
  const { id } = duplicateBlockInput.parse(rawInput);
  const access = await assertBlockAccess(ctx.db, id, user.id);
  if (!access) throw new ORPCError("NOT_FOUND");
  const original = access.block;

  const now = Date.now();

  // Find the next block after the original to insert between them
  const parentId = original.pageId ?? original.layoutId;
  const parentColumn = original.pageId ? blocks.pageId : blocks.layoutId;
  const siblings = parentId
    ? sortByPosition(await ctx.db.select().from(blocks).where(eq(parentColumn, parentId)))
    : [];
  const originalIndex = siblings.findIndex((b) => b.id === id);
  const nextBlock = originalIndex >= 0 ? siblings[originalIndex + 1] : undefined;
  const position = generateKeyBetween(original.position, nextBlock?.position ?? null);

  const result = await ctx.db
    .insert(blocks)
    .values({
      pageId: original.pageId,
      layoutId: original.layoutId,
      type: original.type,
      content: original.content,
      settings: original.settings,
      placement: original.placement,
      summary: original.summary,
      position,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  await syncBlockData(ctx, result.id, true);
  await bumpContentUpdatedAt(ctx.db, original);
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    projectId: access.projectId,
    targets: [
      ...(access.pagePath
        ? [queryKeys.pages.getByPath(access.pagePath, "draft")]
        : [queryKeys.pages.getByPathAll]),
      queryKeys.pages.list,
      ...(original.pageId ? [queryKeys.blocks.getPageMarkdown(original.pageId)] : []),
      queryKeys.blocks.getUsageCounts,
    ],
  });
  return result;
}
