import { queryKeys } from "@camox/api-contract/query-keys";
import { chat } from "@tanstack/ai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { Effect } from "effect";
import { generateKeyBetween } from "fractional-indexing";
import { outdent } from "outdent";
import { z } from "zod";

import { assertBlockAccess, assertPageAccess, requireUser } from "../../authorization";
import type { Database } from "../../db";
import { broadcastInvalidation } from "../../lib/broadcast-invalidation";
import {
  bumpContentUpdatedAt,
  bumpContentUpdatedAtForBlocks,
} from "../../lib/bump-content-updated-at";
import { contentToMarkdown } from "../../lib/content-markdown";
import { decodeInput, InvalidInputError, NotFoundError, type ServiceError } from "../../lib/errors";
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
import { blockScope, hydrateReferences, validateReferenceValues } from "../collections/references";
import { buildFileMap, collectFileIds } from "../pages/ai";
import { readLayoutSnapshot, readPageSnapshot } from "../pages/service";
import { normalizeFieldValue } from "./asset-value";
import { loadBlockContentSchema, loadBlockSchemas } from "./content-schema";
import { type FieldSchema } from "./normalize-content";
import { prepareBlockContent, prepareContentPatch } from "./prepare-content";
import { syncBlockData } from "./synced";
import { resolveSyncedLiveData } from "./synced-live";
import { validateContent } from "./validate-content";

// --- Input Schemas ---
// Exported so adapters (oRPC, MCP, CLI) share the same canonical contract.
// Services .parse() them on entry — service is the trust boundary.

const repeatableItemSeedSchema = z.object({
  tempId: z.string(),
  parentTempId: z.string().nullable(),
  fieldName: z.string(),
  content: z.unknown(),
  settings: z.unknown().optional(),
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
export const resolveBlockPosition = Effect.fn("blocks.resolveBlockPosition")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof resolveBlockPositionInput>,
  opts: { mode: "create" | "move" },
): Effect.fn.Return<
  { afterPosition?: string | null; beforePosition?: string | null },
  ServiceError
> {
  const input = yield* decodeInput(resolveBlockPositionInput, rawInput);
  const passed = [
    input.afterPosition !== undefined ? "afterPosition" : null,
    input.beforePosition !== undefined ? "beforePosition" : null,
    input.afterId !== undefined ? "afterId" : null,
    input.beforeId !== undefined ? "beforeId" : null,
    input.position !== undefined ? "position" : null,
  ].filter((x): x is string => x != null);
  if (passed.length > 1) {
    return yield* new InvalidInputError({
      message: `Pass at most one positioning input — got: ${passed.join(", ")}.`,
    });
  }

  if (input.afterPosition !== undefined || input.beforePosition !== undefined) {
    return { afterPosition: input.afterPosition, beforePosition: input.beforePosition };
  }

  const lookupSibling = Effect.fn("lookupSibling")(function* (id: number) {
    const sibling = yield* Effect.promise(() =>
      ctx.db
        .select({ position: blocks.position, pageId: blocks.pageId })
        .from(blocks)
        .where(eq(blocks.id, id))
        .get(),
    );
    if (!sibling) return yield* new NotFoundError({ message: `No block with id ${id}.` });
    if (input.pageId != null && sibling.pageId !== input.pageId) {
      return yield* new InvalidInputError({
        message: `Block ${id} is not on page ${input.pageId}.`,
      });
    }
    return sibling;
  });

  if (input.afterId !== undefined) {
    const sibling = yield* lookupSibling(input.afterId);
    return { afterPosition: sibling.position };
  }
  if (input.beforeId !== undefined) {
    const sibling = yield* lookupSibling(input.beforeId);
    return { beforePosition: sibling.position };
  }

  if (input.position === "last") return {};
  if (input.position === "first") {
    if (opts.mode === "create") return { afterPosition: "" };
    let pageId = input.pageId;
    const blockId = input.blockId;
    if (pageId == null && blockId != null) {
      const target = yield* Effect.promise(() =>
        ctx.db.select({ pageId: blocks.pageId }).from(blocks).where(eq(blocks.id, blockId)).get(),
      );
      pageId = target?.pageId ?? undefined;
    }
    if (pageId == null) return {};
    const first = yield* Effect.promise(() =>
      ctx.db
        .select({ position: blocks.position })
        .from(blocks)
        .where(eq(blocks.pageId, pageId))
        .orderBy(blocks.position)
        .get(),
    );
    return { beforePosition: first?.position ?? null };
  }

  return {};
});

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

const assembleBlockContent = Effect.fn("assembleBlockContent")(function* (
  db: Database,
  blockId: number,
) {
  const block = yield* Effect.promise(() =>
    db.select().from(blocks).where(eq(blocks.id, blockId)).get(),
  );
  if (!block) return null;

  // Get block definition for content schema and field order. Scope by
  // environmentId — the same blockId can exist with different shapes across
  // environments (e.g. mid-migration).
  let projectId: number | null = null;
  let environmentId: number | null = null;
  const { pageId, layoutId } = block;
  if (pageId) {
    const page = yield* Effect.promise(() =>
      db.select().from(pages).where(eq(pages.id, pageId)).get(),
    );
    projectId = page?.projectId ?? null;
    environmentId = page?.environmentId ?? null;
  } else if (layoutId) {
    const layout = yield* Effect.promise(() =>
      db.select().from(layouts).where(eq(layouts.id, layoutId)).get(),
    );
    projectId = layout?.projectId ?? null;
    environmentId = layout?.environmentId ?? null;
  }

  const def =
    projectId && environmentId
      ? yield* Effect.promise(() =>
          db
            .select()
            .from(blockDefinitions)
            .where(
              and(
                eq(blockDefinitions.projectId, projectId),
                eq(blockDefinitions.environmentId, environmentId),
                eq(blockDefinitions.blockId, block.type),
              ),
            )
            .get(),
        )
      : null;

  const contentSchema = (def?.contentSchema as Record<string, any>) ?? null;
  const fieldOrder = contentSchema?.properties
    ? Object.keys(contentSchema.properties as Record<string, unknown>)
    : undefined;

  // Merge repeatable items into content
  const items = sortByPosition(
    yield* Effect.promise(() =>
      db.select().from(repeatableItems).where(eq(repeatableItems.blockId, blockId)),
    ),
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
});

/**
 * Generates and stores a summary for a block.
 * Returns `{ pageId }` if the parent page has AI SEO enabled (caller should cascade).
 */
export const executeBlockSummary = Effect.fn("blocks.executeBlockSummary")(function* (
  db: Database,
  apiKey: string,
  blockId: number,
  abortController?: AbortController,
): Effect.fn.Return<{ pageId: number } | null> {
  const assembled = yield* assembleBlockContent(db, blockId);
  if (!assembled) return null;

  const { block, content, contentSchema } = assembled;

  const markdown =
    contentSchema?.toMarkdown && contentSchema?.properties
      ? contentToMarkdown(contentSchema.toMarkdown, contentSchema.properties, content, {
          settings: block.settings as Record<string, unknown> | null | undefined,
        })
      : JSON.stringify(content);

  const summary = yield* generateObjectSummary(
    apiKey,
    { type: block.type, markdown, previousSummary: block.summary },
    abortController,
  );

  yield* Effect.promise(() =>
    db.update(blocks).set({ summary, updatedAt: Date.now() }).where(eq(blocks.id, blockId)),
  );

  // Check if we should cascade to page SEO
  const pageId = block.pageId;
  if (summary !== block.summary && pageId) {
    const page = yield* Effect.promise(() =>
      db.select().from(pages).where(eq(pages.id, pageId)).get(),
    );
    if (page?.aiSeoEnabled !== false) {
      return { pageId };
    }
  }

  return null;
});

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
const applyContentPatch = Effect.fn("applyContentPatch")(function* (
  ctx: ServiceContext,
  block: { id: number; content: unknown },
  patch: Record<string, unknown>,
  contentSchema: unknown,
  now: number,
): Effect.fn.Return<Record<string, unknown>, ServiceError> {
  const props = (contentSchema as { properties?: Record<string, FieldSchema> } | null)?.properties;

  // Start from existing content with all known repeatable fields stripped (items
  // table is truth). This also clears any pre-existing ghost data.
  const merged: Record<string, unknown> = { ...(block.content as Record<string, unknown>) };
  if (props) {
    for (const [key, fieldSchema] of Object.entries(props)) {
      if (fieldSchema.fieldType === "Repeater") delete merged[key];
    }
  }

  let allItems: Effect.Success<ReturnType<typeof fetchBlockItems>> | null = null;
  // Build the entire mutation plan first: a later bad reference or value must
  // not leave earlier siblings repositioned, inserted, or deleted.
  const writes: Effect.Effect<unknown>[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const fieldSchema = props?.[key];
    if (fieldSchema?.fieldType !== "Repeater") {
      merged[key] = normalizeFieldValue(value, fieldSchema?.fieldType);
      continue;
    }
    if (allItems === null) allItems = yield* fetchBlockItems(ctx, block.id);
    yield* applyRepeatableFieldPatch(ctx, {
      blockId: block.id,
      parentItemId: null,
      fieldName: key,
      newArray: value,
      allItems,
      fieldSchema,
      rootSchema: contentSchema,
      now,
      writes,
    });
  }
  for (const write of writes) yield* write;
  return merged;
});

const fetchBlockItems = Effect.fn("fetchBlockItems")(function* (
  ctx: ServiceContext,
  blockId: number,
) {
  return yield* Effect.promise(() =>
    ctx.db.select().from(repeatableItems).where(eq(repeatableItems.blockId, blockId)),
  );
});

const applyRepeatableFieldPatch = Effect.fn("applyRepeatableFieldPatch")(function* (
  ctx: ServiceContext,
  args: {
    blockId: number;
    parentItemId: number | null;
    fieldName: string;
    newArray: unknown;
    allItems: Effect.Success<ReturnType<typeof fetchBlockItems>>;
    fieldSchema: FieldSchema;
    rootSchema: unknown;
    now: number;
    writes: Effect.Effect<unknown>[];
  },
): Effect.fn.Return<void, ServiceError> {
  const {
    blockId,
    parentItemId,
    fieldName,
    newArray,
    allItems,
    fieldSchema,
    rootSchema,
    now,
    writes,
  } = args;
  const itemSchemaProps = fieldSchema.items?.properties;
  if (newArray == null) return;
  if (!Array.isArray(newArray)) {
    return yield* new InvalidInputError({
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
      return yield* new InvalidInputError({
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
      return yield* new InvalidInputError({
        message: `Field "${fieldName}" element has invalid _itemId`,
        data: { field: fieldName },
      });
    }

    if (itemId !== null) {
      const existing = existingById.get(itemId);
      if (!existing) {
        return yield* new InvalidInputError({
          message: `Field "${fieldName}" references item ${itemId} but no such item exists at this scope`,
          data: { field: fieldName },
        });
      }
      if (referenced.has(itemId)) {
        return yield* new InvalidInputError({
          message: `Field "${fieldName}" references item ${itemId} more than once`,
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
          yield* applyRepeatableFieldPatch(ctx, {
            blockId,
            parentItemId: itemId,
            fieldName: k,
            newArray: v,
            allItems,
            fieldSchema: subSchema,
            rootSchema,
            now,
            writes,
          });
          continue;
        }
        nonRepeatableOverrides[k] = normalizeFieldValue(v, subSchema?.fieldType);
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

      writes.push(
        Effect.promise(() =>
          ctx.db
            .update(repeatableItems)
            .set({ content: newContent, position, updatedAt: now })
            .where(eq(repeatableItems.id, itemId)),
        ),
      );
      continue;
    }

    // New inline item — normalize against the item schema, insert it, then insert
    // any nested-repeatable seeds it produced as descendants of the new item.
    const {
      content: itemContent,
      settings: itemSettings,
      seeds: childSeeds,
    } = yield* prepareBlockContent(
      elementObj,
      undefined,
      undefined,
      fieldSchema.items,
      fieldSchema.itemSettingsSchema,
      { contentSchema: rootSchema, settingsSchema: rootSchema },
    );
    writes.push(
      Effect.gen(function* () {
        const inserted = yield* Effect.promise(() =>
          ctx.db
            .insert(repeatableItems)
            .values({
              blockId,
              parentItemId,
              fieldName,
              content: itemContent,
              settings: itemSettings,
              summary: "",
              position,
              createdAt: now,
              updatedAt: now,
            })
            .returning()
            .get(),
        );

        if (childSeeds.length > 0) {
          const tempIdToRealId = new Map<string, number>();
          for (const seed of childSeeds) {
            // parentTempId === null → child of the just-inserted item; otherwise resolve.
            const seedParent = seed.parentTempId
              ? (tempIdToRealId.get(seed.parentTempId) ?? inserted.id)
              : inserted.id;
            const sub = yield* Effect.promise(() =>
              ctx.db
                .insert(repeatableItems)
                .values({
                  blockId,
                  parentItemId: seedParent,
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
            tempIdToRealId.set(seed.tempId, sub.id);
          }
        }
      }),
    );
  }

  // Delete unreferenced existing items (cascades to nested children via FK).
  for (const item of scopeItems) {
    if (referenced.has(item.id)) continue;
    writes.push(
      Effect.promise(() => ctx.db.delete(repeatableItems).where(eq(repeatableItems.id, item.id))),
    );
  }
});

// --- Reads ---

const loadBlockBundle = Effect.fn("loadBlockBundle")(function* (
  ctx: ServiceContext,
  blockId: number,
  source: PageSource,
): Effect.fn.Return<{ block: SnapshotBlock | null; items: SnapshotRepeatableItem[] }> {
  if (source === "draft") {
    const block =
      (yield* Effect.promise(() =>
        ctx.db.select().from(blocks).where(eq(blocks.id, blockId)).get(),
      )) ?? null;
    if (!block) return { block: null, items: [] };
    const items = yield* Effect.promise(() =>
      ctx.db.select().from(repeatableItems).where(eq(repeatableItems.blockId, block.id)),
    );
    // The drizzle row shape is structurally compatible with SnapshotBlock /
    // SnapshotRepeatableItem (same columns, same nullability), so casting
    // through the union return type is safe here.
    return { block, items };
  }

  // Non-draft: find the parent (page or layout) by the live block row's
  // parent ids, then pull the block + its items out of the parent's snapshot.
  const liveBlock = yield* Effect.promise(() =>
    ctx.db.select().from(blocks).where(eq(blocks.id, blockId)).get(),
  );
  if (!liveBlock) return { block: null, items: [] };

  const { pageId, layoutId } = liveBlock;
  if (pageId != null) {
    const parentPage = yield* Effect.promise(() =>
      ctx.db.select().from(pages).where(eq(pages.id, pageId)).get(),
    );
    if (!parentPage) return { block: null, items: [] };
    const checkpointId =
      source === "live" ? parentPage.livePublishedCheckpointId : source.checkpointId;
    if (checkpointId == null) return { block: null, items: [] };
    const checkpoint = yield* Effect.promise(() =>
      ctx.db.select().from(pageCheckpoints).where(eq(pageCheckpoints.id, checkpointId)).get(),
    );
    if (!checkpoint) return { block: null, items: [] };
    if (typeof source === "object" && checkpoint.pageId !== parentPage.id) {
      return { block: null, items: [] };
    }
    const stored = pageSnapshotSchema.parse(JSON.parse(checkpoint.snapshot));
    const snapshot =
      source === "live"
        ? yield* resolveSyncedLiveData(ctx, parentPage.environmentId, stored)
        : stored;
    const block = snapshot.blocks.find((b) => b.id === blockId) ?? null;
    if (!block) return { block: null, items: [] };
    return { block, items: snapshot.repeatableItems.filter((i) => i.blockId === blockId) };
  }
  if (layoutId != null) {
    const parentLayout = yield* Effect.promise(() =>
      ctx.db.select().from(layouts).where(eq(layouts.id, layoutId)).get(),
    );
    if (!parentLayout) return { block: null, items: [] };
    // See readLayoutSnapshot in pages/service.ts: in phase 1 the layout side
    // always follows its own live pointer regardless of source.
    const checkpointId = parentLayout.livePublishedCheckpointId;
    if (checkpointId == null) return { block: null, items: [] };
    const checkpoint = yield* Effect.promise(() =>
      ctx.db.select().from(layoutCheckpoints).where(eq(layoutCheckpoints.id, checkpointId)).get(),
    );
    if (!checkpoint) return { block: null, items: [] };
    const snapshot = yield* resolveSyncedLiveData(
      ctx,
      parentLayout.environmentId,
      layoutSnapshotSchema.parse(JSON.parse(checkpoint.snapshot)),
    );
    const block = snapshot.blocks.find((b) => b.id === blockId) ?? null;
    if (!block) return { block: null, items: [] };
    return { block, items: snapshot.repeatableItems.filter((i) => i.blockId === blockId) };
  }
  return { block: null, items: [] };
});

export const getBlock = Effect.fn("blocks.getBlock")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getBlockInput>,
) {
  const { id, source } = yield* decodeInput(getBlockInput, rawInput);
  // For non-draft reads, locate the block + its items inside the parent
  // page/layout's snapshot rather than the live tables. Mildly wasteful — we
  // parse the whole snapshot to pull one block — but blocks.get against
  // 'live' / { checkpointId } is never the hot path. The edit loop stays on
  // 'draft'.
  const { block, items: sourcedItems } = yield* loadBlockBundle(ctx, id, source);
  if (!block) return yield* new NotFoundError();
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

  const hydratedBlock = (yield* hydrateReferences(
    ctx,
    yield* blockScope(ctx, block),
    [{ ...block, content }],
    source === "draft" ? "draft" : "live",
  ))[0];

  // Resolve sources before collecting assets: UUID selections themselves contain no file IDs.
  const fileIds = new Set<number>();
  collectFileIds(content, fileIds);
  collectFileIds(hydratedBlock.references, fileIds);
  for (const item of sorted) {
    collectFileIds(item.content as Record<string, unknown>, fileIds);
  }

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
    block: hydratedBlock,
    repeatableItems: sorted,
    files: fileRows,
  };
});

export const getPageMarkdown = Effect.fn("blocks.getPageMarkdown")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getPageMarkdownInput>,
) {
  const { pageId, source } = yield* decodeInput(getPageMarkdownInput, rawInput);

  const page = yield* Effect.promise(() =>
    ctx.db.select().from(pages).where(eq(pages.id, pageId)).get(),
  );
  if (!page) return yield* new NotFoundError();

  // Get block definitions for content schemas and Markdown representations. Scope
  // by environmentId — the same blockId can exist with different shapes across
  // environments (e.g. mid-migration).
  const defs = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(blockDefinitions)
      .where(
        and(
          eq(blockDefinitions.projectId, page.projectId),
          eq(blockDefinitions.environmentId, page.environmentId),
        ),
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
    const pageBlocks = yield* Effect.promise(() =>
      ctx.db.select().from(blocks).where(eq(blocks.pageId, pageId)),
    );
    sorted = pageBlocks.sort((a, b) => comparePositions(a.position, b.position));
    const blockIds = sorted.map((b) => b.id);
    allItems =
      blockIds.length > 0
        ? sortByPosition(
            yield* Effect.promise(() =>
              ctx.db
                .select()
                .from(repeatableItems)
                .where(inArray(repeatableItems.blockId, blockIds)),
            ),
          )
        : [];
    if (page.layoutId) {
      const layoutBlocks = yield* Effect.promise(() =>
        ctx.db.select().from(blocks).where(eq(blocks.layoutId, page.layoutId)),
      );
      sortedLayout = layoutBlocks.sort((a, b) => comparePositions(a.position, b.position));
      const layoutBlockIds = sortedLayout.map((b) => b.id);
      layoutAllItems =
        layoutBlockIds.length > 0
          ? sortByPosition(
              yield* Effect.promise(() =>
                ctx.db
                  .select()
                  .from(repeatableItems)
                  .where(inArray(repeatableItems.blockId, layoutBlockIds)),
              ),
            )
          : [];
    }
  } else {
    const pageSnapshot = yield* readPageSnapshot(ctx, page, source);
    if (!pageSnapshot) {
      return yield* new InvalidInputError({
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
      const layout = yield* Effect.promise(() =>
        ctx.db.select().from(layouts).where(eq(layouts.id, page.layoutId)).get(),
      );
      if (layout) {
        const layoutSnapshot = yield* readLayoutSnapshot(ctx, layout);
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

  const hydrated = yield* hydrateReferences(
    ctx,
    page,
    [...sorted, ...sortedLayout],
    source === "draft" ? "draft" : "live",
  );
  // Collect every referenced file so {{image}} / {{file}} placeholders resolve to real URLs
  const fileIds = new Set<number>();
  for (const block of hydrated) {
    collectFileIds(block.content as Record<string, unknown>, fileIds);
    collectFileIds(block.references, fileIds);
  }
  for (const list of [...itemsByBlock.values(), ...layoutItemsByBlock.values()]) {
    for (const item of list) collectFileIds(item.content as Record<string, unknown>, fileIds);
  }
  const fileMap = yield* buildFileMap(ctx.db, fileIds);

  const referencesByBlock = new Map(hydrated.map((block) => [block.id, block.references]));
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
      {
        settings: block.settings as Record<string, unknown> | null | undefined,
        files: fileMap,
        references: referencesByBlock.get(block.id),
      },
    )}`;
  };

  const beforeParts: string[] = [];
  const afterParts: string[] = [];
  for (const block of sortedLayout) {
    const schema = schemaByType.get(block.type);
    if (!schema?.toMarkdown) continue;
    const md = renderBlock(block, layoutItemsByBlock.get(block.id) ?? []);
    if (block.slot === "before") beforeParts.push(md);
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
});

export const getBlocksUsageCounts = Effect.fn("blocks.getBlocksUsageCounts")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getBlocksUsageCountsInput>,
) {
  const { projectId } = yield* decodeInput(getBlocksUsageCountsInput, rawInput);
  const environment = yield* resolveEnvironment(ctx.db, projectId, ctx.environmentName);
  return yield* Effect.promise(() =>
    ctx.db
      .select({
        type: blocks.type,
        count: sql<number>`count(*)`,
      })
      .from(blocks)
      .leftJoin(pages, eq(blocks.pageId, pages.id))
      .leftJoin(layouts, eq(blocks.layoutId, layouts.id))
      .where(or(eq(pages.environmentId, environment.id), eq(layouts.environmentId, environment.id)))
      .groupBy(blocks.type),
  );
});

// --- Writes ---

export const createBlock = Effect.fn("blocks.createBlock")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof createBlockInput>,
) {
  const user = yield* requireUser(ctx);
  const {
    pageId,
    type,
    content,
    settings,
    afterPosition,
    beforePosition,
    repeatableItems: itemSeeds,
  } = yield* decodeInput(createBlockInput, rawInput);
  const access = yield* assertPageAccess(ctx.db, pageId, user.id);

  const now = Date.now();

  // Look up the block definition's content schema and normalize inline repeatable
  // arrays into seeds, so the agent (and any caller) can produce a flat shape.
  // Scope by environmentId — the same blockId can exist with different shapes
  // across environments (e.g. mid-migration).
  const def = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(blockDefinitions)
      .where(
        and(
          eq(blockDefinitions.projectId, access.page.projectId),
          eq(blockDefinitions.environmentId, access.page.environmentId),
          eq(blockDefinitions.blockId, type),
        ),
      )
      .get(),
  );
  const prepared = yield* prepareBlockContent(
    content,
    settings,
    itemSeeds,
    def?.contentSchema,
    def?.settingsSchema,
  );
  const allSeeds = prepared.seeds;
  yield* validateReferenceValues(ctx, access.page, def?.contentSchema, prepared.content);

  // Get all blocks for this page to determine correct position
  const pageBlocks = sortByPosition(
    yield* Effect.promise(() => ctx.db.select().from(blocks).where(eq(blocks.pageId, pageId))),
  );

  if (afterPosition != null && beforePosition != null) {
    return yield* new InvalidInputError({
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
  const result = yield* Effect.promise(() =>
    ctx.db
      .insert(blocks)
      .values({
        pageId,
        type,
        content: prepared.content,
        settings: prepared.settings,
        position,
        summary: "",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get(),
  );

  // Insert repeatable item seeds in topological order (parents before children)
  if (allSeeds.length > 0) {
    const tempIdToRealId = new Map<string, number>();

    for (const seed of allSeeds) {
      const parentItemId = seed.parentTempId
        ? (tempIdToRealId.get(seed.parentTempId) ?? null)
        : null;
      const inserted = yield* Effect.promise(() =>
        ctx.db
          .insert(repeatableItems)
          .values({
            blockId: result.id,
            parentItemId,
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

  yield* syncBlockData(ctx, result.id, true);
  yield* bumpContentUpdatedAt(ctx.db, { pageId });

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

  return (yield* Effect.promise(() =>
    ctx.db.select().from(blocks).where(eq(blocks.id, result.id)).get(),
  ))!;
});

/** CLI/AI edits may submit both fields; reject either invalid patch before writing either. */
export const editBlock = Effect.fn("blocks.editBlock")(function* (
  ctx: ServiceContext,
  input: { id: number; content?: unknown; settings?: unknown },
) {
  const user = yield* requireUser(ctx);
  const access = yield* assertBlockAccess(ctx.db, input.id, user.id);
  if (input.content === undefined && input.settings === undefined) {
    return yield* new InvalidInputError({ message: "Provide content or settings" });
  }
  if (input.settings !== undefined) {
    const schemas = yield* loadBlockSchemas(ctx.db, access.projectId, input.id);
    yield* validateContent(input.settings, schemas?.settingsSchema, { path: "settings" });
  }
  let result: unknown;
  if (input.content !== undefined) {
    result = yield* updateBlockContent(ctx, { id: input.id, content: input.content });
  }
  if (input.settings !== undefined) {
    result = yield* updateBlockSettings(ctx, { id: input.id, settings: input.settings });
  }
  return result;
});

export const updateBlockContent = Effect.fn("blocks.updateBlockContent")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof updateBlockContentInput>,
) {
  const user = yield* requireUser(ctx);
  const { id, content } = yield* decodeInput(updateBlockContentInput, rawInput);
  const access = yield* assertBlockAccess(ctx.db, id, user.id);

  const now = Date.now();

  const contentSchema = yield* loadBlockContentSchema(ctx.db, access.projectId, id);

  const patch = yield* prepareContentPatch(content, contentSchema);
  yield* validateContent(patch, contentSchema, { allowItemReferences: true });
  yield* validateReferenceValues(ctx, yield* blockScope(ctx, access.block), contentSchema, patch);
  const merged = yield* applyContentPatch(ctx, access.block, patch, contentSchema, now);

  const result = yield* Effect.promise(() =>
    ctx.db
      .update(blocks)
      .set({ content: merged, updatedAt: now })
      .where(eq(blocks.id, id))
      .returning()
      .get(),
  );

  yield* syncBlockData(ctx, id);
  yield* bumpContentUpdatedAt(ctx.db, access.block);

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
});

export const updateBlockSettings = Effect.fn("blocks.updateBlockSettings")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof updateBlockSettingsInput>,
) {
  const user = yield* requireUser(ctx);
  const { id, settings } = yield* decodeInput(updateBlockSettingsInput, rawInput);
  const access = yield* assertBlockAccess(ctx.db, id, user.id);

  const schemas = yield* loadBlockSchemas(ctx.db, access.projectId, id);
  yield* validateContent(settings, schemas?.settingsSchema, { path: "settings" });
  const merged = {
    ...(access.block.settings as Record<string, unknown> | null),
    ...(settings as Record<string, unknown>),
  };
  const result = yield* Effect.promise(() =>
    ctx.db
      .update(blocks)
      .set({ settings: merged, updatedAt: Date.now() })
      .where(eq(blocks.id, id))
      .returning()
      .get(),
  );
  yield* syncBlockData(ctx, id);
  yield* bumpContentUpdatedAt(ctx.db, access.block);
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
});

export const updateBlockPosition = Effect.fn("blocks.updateBlockPosition")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof updateBlockPositionInput>,
) {
  const user = yield* requireUser(ctx);
  const { id, afterPosition, beforePosition } = yield* decodeInput(
    updateBlockPositionInput,
    rawInput,
  );
  const access = yield* assertBlockAccess(ctx.db, id, user.id);

  // Query siblings (excluding the block being moved) to compute a correct position
  const block = access.block;
  const parentColumn = block.pageId ? blocks.pageId : blocks.layoutId;
  const parentId = block.pageId ?? block.layoutId;
  const siblings = parentId
    ? sortByPosition(
        (yield* Effect.promise(() =>
          ctx.db.select().from(blocks).where(eq(parentColumn, parentId)),
        )).filter((b) => b.id !== id),
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

  const result = yield* Effect.promise(() =>
    ctx.db
      .update(blocks)
      .set({ position, updatedAt: Date.now() })
      .where(eq(blocks.id, id))
      .returning()
      .get(),
  );
  yield* bumpContentUpdatedAt(ctx.db, access.block);
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
});

export const deleteBlock = Effect.fn("blocks.deleteBlock")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof deleteBlockInput>,
) {
  const user = yield* requireUser(ctx);
  const { id } = yield* decodeInput(deleteBlockInput, rawInput);
  const access = yield* assertBlockAccess(ctx.db, id, user.id);

  const result = yield* Effect.promise(() =>
    ctx.db.delete(blocks).where(eq(blocks.id, id)).returning().get(),
  );
  yield* bumpContentUpdatedAt(ctx.db, access.block);
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
});

export const deleteBlocks = Effect.fn("blocks.deleteBlocks")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof deleteBlocksInput>,
) {
  const user = yield* requireUser(ctx);
  const { blockIds } = yield* decodeInput(deleteBlocksInput, rawInput);
  if (blockIds.length === 0) return [];

  // Verify all blocks belong to an org the user is a member of
  const authorizedBlocks = yield* Effect.promise(() =>
    ctx.db
      .select({ id: blocks.id, projectId: projects.id })
      .from(blocks)
      .leftJoin(pages, eq(blocks.pageId, pages.id))
      .leftJoin(layouts, eq(blocks.layoutId, layouts.id))
      .innerJoin(projects, or(eq(projects.id, pages.projectId), eq(projects.id, layouts.projectId)))
      .innerJoin(
        member,
        and(eq(member.organizationId, projects.organizationId), eq(member.userId, user.id)),
      )
      .where(inArray(blocks.id, blockIds)),
  );
  if (authorizedBlocks.length !== blockIds.length) {
    return yield* new NotFoundError();
  }
  // Bump first — once the rows are gone, we can't recover their parents.
  yield* bumpContentUpdatedAtForBlocks(ctx.db, blockIds);
  const result = yield* Effect.promise(() =>
    ctx.db.delete(blocks).where(inArray(blocks.id, blockIds)).returning(),
  );
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
});

export const generateBlockSummary = Effect.fn("blocks.generateBlockSummary")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof generateBlockSummaryInput>,
) {
  const user = yield* requireUser(ctx);
  const { id } = yield* decodeInput(generateBlockSummaryInput, rawInput);
  const access = yield* assertBlockAccess(ctx.db, id, user.id);

  const seoStale = yield* executeBlockSummary(ctx.db, ctx.env.OPEN_ROUTER_API_KEY, id);
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
  const updated = yield* Effect.promise(() =>
    ctx.db.select().from(blocks).where(eq(blocks.id, id)).get(),
  );
  return updated;
});

export const duplicateBlock = Effect.fn("blocks.duplicateBlock")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof duplicateBlockInput>,
) {
  const user = yield* requireUser(ctx);
  const { id } = yield* decodeInput(duplicateBlockInput, rawInput);
  const access = yield* assertBlockAccess(ctx.db, id, user.id);
  const original = access.block;

  const now = Date.now();

  // Find the next block after the original to insert between them
  const parentId = original.pageId ?? original.layoutId;
  const parentColumn = original.pageId ? blocks.pageId : blocks.layoutId;
  const siblings = parentId
    ? sortByPosition(
        yield* Effect.promise(() => ctx.db.select().from(blocks).where(eq(parentColumn, parentId))),
      )
    : [];
  const originalIndex = siblings.findIndex((b) => b.id === id);
  const nextBlock = originalIndex >= 0 ? siblings[originalIndex + 1] : undefined;
  const position = generateKeyBetween(original.position, nextBlock?.position ?? null);

  const result = yield* Effect.promise(() =>
    ctx.db
      .insert(blocks)
      .values({
        pageId: original.pageId,
        layoutId: original.layoutId,
        type: original.type,
        content: original.content,
        settings: original.settings,
        slot: original.slot,
        summary: original.summary,
        position,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get(),
  );
  yield* syncBlockData(ctx, result.id, true);
  yield* bumpContentUpdatedAt(ctx.db, original);
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
});
