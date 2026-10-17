import { uuidv7Schema } from "@camox/api-contract/ids";
import { queryKeys } from "@camox/api-contract/query-keys";
import { chat } from "@tanstack/ai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Effect, type Scope } from "effect";
import { generateKeyBetween } from "fractional-indexing";
import { outdent } from "outdent";
import { z } from "zod";

import type { Database } from "../../db";
import { broadcastInvalidation } from "../../lib/broadcast-invalidation";
import { contentToMarkdown, stripArtifactSources } from "../../lib/content-markdown";
import {
  ConflictError,
  decodeInput,
  InvalidInputError,
  NotFoundError,
  type ServiceError,
} from "../../lib/errors";
import {
  blockDefinitions,
  blocks,
  layouts,
  pages,
  repeatableItems,
  sharedContents,
} from "../../schema";
import { conformBlocks, conformBlocksIn } from "../_shared/conform-content";
import { definitionsIn } from "../_shared/definitions";
import { readOwnerBlocks } from "../_shared/owner-blocks";
import type { ServiceContext } from "../_shared/service-context";
import type { ContentScope } from "../collections/identity";
import {
  blockScope,
  hydrateItemReferences,
  hydrateReferences,
  type ResolvedReferences,
  validateReferenceValues,
} from "../collections/references";
import { accessTo, type ContentAccess } from "../drafts/access";
import * as overlay from "../drafts/overlay";
import type { Draft, DraftScope } from "../drafts/scope";
import { draftScopeOfJob } from "../drafts/service";
import {
  copyValue,
  type GenerationDeps,
  homeOf,
  readValue,
  requestGeneration,
  saveValue,
  settleRequest,
} from "../generated-values/service";
import { blocksOfOwner, layoutNamed } from "../layouts/identity";
import { servesPages } from "../layouts/route-ownership";
import { buildFileMap, collectFileIds, sortItemsByPosition } from "../pages/ai";
import { seoGenerated } from "../pages/generated-seo";
import { requestPageSeo } from "../pages/service";
import { itemsUnder, rootColumns, type ItemRoot } from "../repeatable-items/roots";
import { artifactWarnings, withWarnings } from "./artifact-warnings";
import { normalizeFieldValue } from "./asset-value";
import { loadBlockContentSchema, loadBlockSchemas } from "./content-schema";
import { type FieldSchema } from "./normalize-content";
import { prepareBlockContent, prepareContentPatch } from "./prepare-content";
import {
  adoptSharedContent,
  broadcastSharedContentChange,
  contentOwnerOf,
  sharedPlacementId,
  shownBlock,
  withSharedContent,
  type SharedContentRow,
} from "./shared-content";
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

export const getBlockInput = z.object({ id: uuidv7Schema });
export const getPageMarkdownInput = z.object({ pageId: uuidv7Schema });
export const getLayoutMarkdownInput = z.object({
  projectSlug: z.string(),
  layoutId: z.string(),
});
export const getBlocksUsageCountsInput = z.object({ projectId: z.number() });
// A Block Definition within a project.
export const blockTypeInput = z.object({ projectId: z.number(), type: z.string() });
/** The server mints the id; a client may mint one for an optimistic insert. */
export const createBlockInput = z.object({
  id: uuidv7Schema.optional(),
  pageId: uuidv7Schema,
  type: z.string(),
  content: z.unknown(),
  settings: z.unknown().optional(),
  afterPosition: z.string().nullable().optional(),
  beforePosition: z.string().nullable().optional(),
  repeatableItems: z.array(repeatableItemSeedSchema).optional(),
});
export const updateBlockContentInput = z.object({ id: uuidv7Schema, content: z.unknown() });
export const updateBlockSettingsInput = z.object({ id: uuidv7Schema, settings: z.unknown() });
export const updateBlockPositionInput = z.object({
  id: uuidv7Schema,
  afterPosition: z.string().nullable().optional(),
  beforePosition: z.string().nullable().optional(),
});
export const deleteBlockInput = z.object({ id: uuidv7Schema });
export const resolveBlockPositionInput = z.object({
  pageId: uuidv7Schema.optional(),
  blockId: uuidv7Schema.optional(),
  afterPosition: z.string().nullable().optional(),
  beforePosition: z.string().nullable().optional(),
  afterId: uuidv7Schema.optional(),
  beforeId: uuidv7Schema.optional(),
  position: z.enum(["first", "last"]).optional(),
});
export const deleteBlocksInput = z.object({ blockIds: z.array(uuidv7Schema) });
export const generateBlockSummaryInput = z.object({ id: uuidv7Schema });
export const duplicateBlockInput = z.object({ id: uuidv7Schema });

// --- Internal helpers ---

const { sortByPosition } = overlay;

/**
 * Deletes the repeatable items of blocks a draft created and then deleted, which hold no foreign
 * key to them (ADR 0005). A Live block the draft deleted keeps its items: publishing deletes them
 * with it.
 */
const deleteBlockDependents = Effect.fn("blocks.deleteBlockDependents")(function* (
  ctx: ServiceContext,
  scope: Draft,
  removed: (typeof blocks.$inferSelect)[],
) {
  const created = removed
    .filter((block) => block.draftId === scope.id && block.baseVersion == null)
    .map((block) => block.id);
  if (created.length === 0) return;
  const items = yield* overlay.select(
    ctx.db,
    scope,
    repeatableItems,
    inArray(repeatableItems.blockId, created),
  );
  for (const item of items) yield* overlay.remove(ctx.db, scope, repeatableItems, item.id);
});

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
  ServiceError,
  Scope.Scope
> {
  const input = yield* decodeInput(resolveBlockPositionInput, rawInput);
  if (!input.blockId && !input.pageId) {
    return yield* new InvalidInputError({ message: "Pass the block or the page to position in." });
  }
  const ref = input.blockId ? { block: input.blockId } : { page: input.pageId! };
  const { scope } = yield* accessTo(ctx, ref, "write");
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

  const lookupSibling = Effect.fn("lookupSibling")(function* (id: string) {
    const sibling = yield* overlay.get(ctx.db, scope, blocks, id);
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
      const target = yield* overlay.get(ctx.db, scope, blocks, blockId);
      pageId = target?.pageId ?? undefined;
    }
    if (pageId == null) return {};
    const [first] = sortByPosition(
      yield* overlay.select(ctx.db, scope, blocks, eq(blocks.pageId, pageId)),
    );
    return { beforePosition: first?.position ?? null };
  }

  return {};
}, Effect.scoped);

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
  allItems: { id: string; parentItemId: string | null; fieldName: string; content: unknown }[],
) {
  const childrenByParent = new Map<string, Map<string, typeof allItems>>();
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
  blockId: string,
  scope: DraftScope,
) {
  const stored = yield* overlay.get(db, scope, blocks, blockId);
  if (!stored) return null;

  // Get block definition for content schema and field order, in the block's project.
  const projectId = stored.projectId;

  const def = projectId
    ? yield* Effect.promise(() =>
        db
          .select()
          .from(blockDefinitions)
          .where(
            and(
              eq(blockDefinitions.projectId, projectId),
              definitionsIn(blockDefinitions, scope),
              eq(blockDefinitions.blockId, stored.type),
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
  const shown = yield* withSharedContent(
    db,
    scope,
    [stored],
    yield* overlay.select(db, scope, repeatableItems, eq(repeatableItems.blockId, blockId)),
  );
  const conformed = conformBlocks(
    new Map(def ? [[def.blockId, def]] : []),
    shown.blocks,
    sortItemsByPosition(shown.items),
  );
  const block = conformed.blocks[0];
  const items = conformed.items;

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
    return { block, content: ordered, contentSchema, projectId };
  }

  return { block, content, contentSchema, projectId };
});

/** Where a block's summary lives: its shared content's for a synced placement, or its own. */
const summaryKeyOf = (blockId: string, shared: SharedContentRow | null) =>
  shared
    ? ({ entity: "sharedContent", entityId: shared.id, type: "summary" } as const)
    : ({ entity: "block", entityId: blockId, type: "summary" } as const);

/**
 * Generates a block's summary as a scope reads it, into the scope's generated values: never into
 * the block, so it never copies one into a draft (ADR 0012). Returns the block's page when the
 * summary changed and the page's SEO is generated, so the caller requests it again.
 */
export const executeBlockSummary = Effect.fn("blocks.executeBlockSummary")(function* (
  db: Database,
  apiKey: string,
  blockId: string,
  scope: DraftScope,
  abortController?: AbortController,
): Effect.fn.Return<{ page: typeof pages.$inferSelect } | null> {
  const startedAt = Date.now();
  const assembled = yield* assembleBlockContent(db, blockId, scope);
  if (!assembled?.projectId) return null;

  const { block, content, contentSchema, projectId } = assembled;
  // A synced placement's summary is its shared content's.
  const owner = yield* contentOwnerOf(db, scope, block);
  const key = summaryKeyOf(blockId, owner.shared);
  const previous = (yield* readValue(db, scope, key)).value?.summary ?? "";

  const markdown =
    contentSchema?.toMarkdown && contentSchema?.properties
      ? contentToMarkdown(contentSchema.toMarkdown, contentSchema.properties, content, {
          settings: block.settings as Record<string, unknown> | null | undefined,
        })
      : JSON.stringify(stripArtifactSources(contentSchema?.properties, content));

  const summary = yield* generateObjectSummary(
    apiKey,
    { type: block.type, markdown, previousSummary: previous },
    abortController,
  );

  const home = homeOf(scope, projectId);
  yield* saveValue(db, home, key, { summary }, startedAt);
  // The job ran through the placement: settle its request too.
  if (owner.shared) yield* settleRequest(db, home, summaryKeyOf(blockId, null), startedAt);

  const pageId = block.pageId;
  if (summary === previous || !pageId) return null;
  const page = yield* overlay.get(db, scope, pages, pageId);
  return page && seoGenerated(page) ? { page } : null;
});

/**
 * Runs a block summary job in the draft it was scheduled from, or in Live. A job whose draft
 * has ended does nothing.
 */
export const runBlockSummaryJob = Effect.fn("blocks.runBlockSummaryJob")(function* (
  db: Database,
  apiKey: string,
  job: { entityId: string; draftId: string | null },
  abortController?: AbortController,
) {
  const scope = yield* draftScopeOfJob(db, job.draftId);
  if (scope === undefined) return null;
  const stale = yield* executeBlockSummary(db, apiKey, job.entityId, scope, abortController);
  return stale ? { ...stale, scope } : null;
});

/** Requests a block's summary in the scope it was written in (ADR 0012). */
export const requestBlockSummary = (
  ctx: GenerationDeps,
  scope: DraftScope,
  projectId: number,
  blockId: string,
  delayMs: number,
) =>
  requestGeneration(ctx, homeOf(scope, projectId), { entity: "block", entityId: blockId, delayMs });

/**
 * Apply a partial content patch to a block, with replace-within-field semantics
 * for any Repeater fields present in the patch:
 *   - `{ _itemId: N }` keeps existing item N (re-positioned in array order).
 *   - `{ _itemId: N, ...overrides }` updates item N's content; nested repeatable
 *     overrides recurse via this same diff logic.
 *   - Plain inline objects insert new items (with nested children if present).
 *   - Existing items at the same scope not referenced in the new array are deleted, and
 *     their nested children read as gone with them.
 *
 * Repeater fields not present in the patch are untouched.
 *
 * Returns the new merged block.content with all Repeater fields stripped —
 * the items table is the source of truth and `getBlock` re-injects markers on read.
 */
const applyContentPatch = Effect.fn("applyContentPatch")(function* (
  ctx: ServiceContext,
  scope: Draft,
  block: { root: ItemRoot; content: unknown },
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
    if (allItems === null) allItems = yield* fetchBlockItems(ctx, scope, block.root);
    yield* applyRepeatableFieldPatch(ctx, scope, {
      root: block.root,
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
  scope: DraftScope,
  root: ItemRoot,
) {
  return yield* overlay.select(ctx.db, scope, repeatableItems, itemsUnder(root));
});

const applyRepeatableFieldPatch = Effect.fn("applyRepeatableFieldPatch")(function* (
  ctx: ServiceContext,
  scope: Draft,
  args: {
    root: ItemRoot;
    parentItemId: string | null;
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
    root,
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
  const referenced = new Set<string>();

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
    const parsedItemId = uuidv7Schema.safeParse(rawItemId);
    const itemId = parsedItemId.success ? parsedItemId.data : null;
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
          yield* applyRepeatableFieldPatch(ctx, scope, {
            root,
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
        overlay.update(ctx.db, scope, repeatableItems, itemId, {
          content: newContent,
          position,
          updatedAt: now,
        }),
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
        const inserted = (yield* overlay.insert(ctx.db, scope, repeatableItems, {
          ...rootColumns(root),
          parentItemId,
          fieldName,
          content: itemContent,
          settings: itemSettings,
          position,
          createdAt: now,
          updatedAt: now,
        }))!;

        if (childSeeds.length > 0) {
          const tempIdToRealId = new Map<string, string>();
          for (const seed of childSeeds) {
            // parentTempId === null → child of the just-inserted item; otherwise resolve.
            const seedParent = seed.parentTempId
              ? (tempIdToRealId.get(seed.parentTempId) ?? inserted.id)
              : inserted.id;
            const sub = (yield* overlay.insert(ctx.db, scope, repeatableItems, {
              ...rootColumns(root),
              parentItemId: seedParent,
              fieldName: seed.fieldName,
              content: seed.content,
              settings: seed.settings,
              position: seed.position,
              createdAt: now,
              updatedAt: now,
            }))!;
            tempIdToRealId.set(seed.tempId, sub.id);
          }
        }
      }),
    );
  }

  // Delete unreferenced existing items: the draft's tombstone hides their nested children too.
  for (const item of scopeItems) {
    if (referenced.has(item.id)) continue;
    writes.push(overlay.remove(ctx.db, scope, repeatableItems, item.id));
  }
});

// --- Reads ---

export const getBlock = Effect.fn("blocks.getBlock")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getBlockInput>,
) {
  const { id } = yield* decodeInput(getBlockInput, rawInput);
  const { scope, entity } = yield* accessTo(ctx, { block: id }, "public");
  return yield* blockView(ctx, scope, entity.block);
}, Effect.scoped);

/** A block as a scope's readers see it, with its items and the files and records they use. */
const blockView = Effect.fn("blocks.blockView")(function* (
  ctx: ServiceContext,
  scope: DraftScope,
  stored: typeof blocks.$inferSelect,
) {
  const shown = yield* withSharedContent(
    ctx.db,
    scope,
    [stored],
    yield* overlay.select(ctx.db, scope, repeatableItems, eq(repeatableItems.blockId, stored.id)),
  );
  const conformed = yield* conformBlocksIn(ctx, stored, scope, shown.blocks, shown.items);
  const block = conformed.blocks[0];
  const sorted = sortItemsByPosition(conformed.items);

  // Build a map of parentItemId → grouped children by fieldName
  const childrenByParent = new Map<string | null, Map<string, typeof sorted>>();
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

  const referenceScope = blockScope(block, scope);
  const hydratedBlock = (yield* hydrateReferences(ctx, referenceScope, [{ ...block, content }]))[0];
  const hydratedItems = yield* hydrateItemReferences(ctx, referenceScope, [block], sorted);

  // Resolve sources before collecting assets: UUID selections themselves contain no file IDs.
  const fileIds = new Set<string>();
  collectFileIds(content, fileIds);
  collectFileIds(hydratedBlock.references, fileIds);
  for (const item of hydratedItems) {
    collectFileIds(item.content as Record<string, unknown>, fileIds);
    collectFileIds(item.references, fileIds);
  }

  const fileRows = [...(yield* buildFileMap(ctx.db, fileIds, scope)).values()];

  return {
    block: hydratedBlock,
    repeatableItems: hydratedItems,
    files: fileRows,
  };
});

type RenderableBlock = typeof blocks.$inferSelect;
type RenderableItem = typeof repeatableItems.$inferSelect & {
  blockId: string;
  references?: ResolvedReferences;
};

/**
 * Renders each block's Markdown Representation, resolving its references and files.
 * `markdown` is undefined for a block whose definition declares no Markdown; `json` is
 * its raw content instead, with artifact sources replaced by their titles.
 */
const renderBlocksMarkdown = Effect.fn("blocks.renderBlocksMarkdown")(function* (
  ctx: ServiceContext,
  scope: ContentScope,
  blockRows: RenderableBlock[],
  itemRows: RenderableItem[],
) {
  // Get the project's block definitions for content schemas and Markdown representations.
  const defs = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(blockDefinitions)
      .where(
        and(
          eq(blockDefinitions.projectId, scope.projectId),
          definitionsIn(blockDefinitions, scope.draft),
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

  const items: RenderableItem[] = yield* hydrateItemReferences(ctx, scope, blockRows, itemRows);
  nestChildItems(items);
  const itemsByBlock = new Map<string, RenderableItem[]>();
  for (const item of items) {
    if (item.parentItemId !== null) continue;
    const list = itemsByBlock.get(item.blockId) ?? [];
    list.push(item);
    itemsByBlock.set(item.blockId, list);
  }

  const hydrated = yield* hydrateReferences(ctx, scope, blockRows);
  // Collect every referenced file so {{image}} / {{file}} placeholders resolve to real URLs
  const fileIds = new Set<string>();
  for (const block of hydrated) {
    collectFileIds(block.content as Record<string, unknown>, fileIds);
    collectFileIds(block.references, fileIds);
  }
  for (const item of items) {
    collectFileIds(item.content as Record<string, unknown>, fileIds);
    collectFileIds(item.references ?? {}, fileIds);
  }
  const fileMap = yield* buildFileMap(ctx.db, fileIds, scope.draft);

  const referencesByBlock = new Map(hydrated.map((block) => [block.id, block.references]));
  const json = (block: RenderableBlock) =>
    JSON.stringify(
      stripArtifactSources(
        schemaByType.get(block.type)?.properties,
        block.content as Record<string, unknown>,
      ),
    );
  const markdown = (block: RenderableBlock): string | undefined => {
    const schema = schemaByType.get(block.type);
    if (!schema?.toMarkdown) return undefined;
    const blockItems = itemsByBlock.get(block.id) ?? [];
    const content = { ...(block.content as Record<string, unknown>) };
    for (const fieldName of new Set(blockItems.map((i) => i.fieldName))) {
      content[fieldName] = blockItems.filter((i) => i.fieldName === fieldName);
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
  /** A block whose definition is gone renders nothing, not even its JSON. */
  const rendersNothing = (block: RenderableBlock) =>
    !defs.some((def) => def.blockId === block.type);
  return { markdown, json, rendersNothing };
});

/** Joins the Markdown of a layout's before and after slots, skipping blocks without Markdown. */
function layoutSlotsMarkdown(
  layoutBlocks: RenderableBlock[],
  render: (block: RenderableBlock) => string | undefined,
) {
  const before: string[] = [];
  const after: string[] = [];
  for (const block of layoutBlocks) {
    const markdown = render(block);
    if (!markdown) continue;
    if (block.slot === "before") before.push(markdown);
    else after.push(markdown);
  }
  return { before: before.join("\n\n"), after: after.join("\n\n") };
}

export const getPageMarkdown = Effect.fn("blocks.getPageMarkdown")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getPageMarkdownInput>,
) {
  const { pageId } = yield* decodeInput(getPageMarkdownInput, rawInput);
  const { scope, entity: page } = yield* accessTo(ctx, { page: pageId }, "public");
  const pageLayout = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(layouts)
      .where(and(layoutNamed(page.projectId, page.layoutId), definitionsIn(layouts, scope)))
      .get(),
  );
  if (!servesPages(pageLayout)) return yield* new NotFoundError();

  const { blocks: sorted, items: allItems } = yield* readOwnerBlocks(ctx, { pageId }, scope);
  const { blocks: sortedLayout, items: layoutAllItems } = yield* readOwnerBlocks(
    ctx,
    { projectId: page.projectId, layoutId: page.layoutId },
    scope,
  );

  const render = yield* renderBlocksMarkdown(
    ctx,
    { ...page, draft: scope },
    [...sorted, ...sortedLayout],
    [...allItems, ...layoutAllItems],
  );
  const { before, after } = layoutSlotsMarkdown(sortedLayout, render.markdown);

  // Convert page blocks to markdown
  const blockMarkdowns = sorted
    .filter((block) => !render.rendersNothing(block))
    .map((block) => ({
      id: block.id,
      position: block.position,
      markdown: render.markdown(block) ?? render.json(block),
    }));

  const parts = [before, ...blockMarkdowns.map((b) => b.markdown), after].filter(Boolean);
  return { markdown: parts.join("\n\n"), blocks: blockMarkdowns };
}, Effect.scoped);

/**
 * The Markdown of a code-owned layout's before and after slots, for pages
 * without a page row (singleton and derived layouts).
 */
export const getLayoutMarkdown = Effect.fn("blocks.getLayoutMarkdown")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getLayoutMarkdownInput>,
) {
  const { projectSlug, layoutId } = yield* decodeInput(getLayoutMarkdownInput, rawInput);
  const { scope, project } = yield* accessTo(ctx, { projectSlug }, "public");
  const layout = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(layouts)
      .where(
        and(
          eq(layouts.projectId, project.id),
          eq(layouts.layoutId, layoutId),
          definitionsIn(layouts, scope),
        ),
      )
      .get(),
  );
  if (!layout) return yield* new NotFoundError();
  const { blocks: layoutBlocks, items } = yield* readOwnerBlocks(ctx, layout, scope);
  const render = yield* renderBlocksMarkdown(ctx, { ...layout, draft: scope }, layoutBlocks, items);
  return layoutSlotsMarkdown(layoutBlocks, render.markdown);
}, Effect.scoped);

export const getBlocksUsageCounts = Effect.fn("blocks.getBlocksUsageCounts")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getBlocksUsageCountsInput>,
) {
  const { projectId } = yield* decodeInput(getBlocksUsageCountsInput, rawInput);
  const { scope } = yield* accessTo(ctx, { project: projectId }, "public");
  return yield* Effect.promise(() =>
    ctx.db
      .select({
        type: blocks.type,
        count: sql<number>`count(*)`,
      })
      .from(blocks)
      .where(and(overlay.visibleIn(blocks, scope), eq(blocks.projectId, projectId)))
      .groupBy(blocks.type),
  );
}, Effect.scoped);

/**
 * The distinct Pages of the project that place a Block Definition.
 * Unlike usage counts, several placements on one Page count once, and layout
 * placements don't count, since they aren't on a Page.
 */
export const getPagesUsingBlock = Effect.fn("blocks.getPagesUsingBlock")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof blockTypeInput>,
) {
  const { projectId, type } = yield* decodeInput(blockTypeInput, rawInput);
  const { scope } = yield* accessTo(ctx, { project: projectId }, "public");
  return yield* Effect.promise(() =>
    ctx.db
      .selectDistinct({ id: pages.id, nickname: pages.nickname, fullPath: pages.fullPath })
      .from(blocks)
      .innerJoin(pages, eq(blocks.pageId, pages.id))
      .where(
        and(
          overlay.visibleIn(blocks, scope),
          eq(blocks.type, type),
          eq(pages.projectId, projectId),
        ),
      )
      .orderBy(pages.fullPath),
  );
}, Effect.scoped);

/**
 * A Synced Block's shared content in the project, as a
 * block bundle. Null when the block isn't synced or has no placement yet.
 */
export const getSyncedBlockContent = Effect.fn("blocks.getSyncedBlockContent")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof blockTypeInput>,
) {
  const { projectId, type } = yield* decodeInput(blockTypeInput, rawInput);
  const { scope } = yield* accessTo(ctx, { project: projectId }, "public");
  const id = yield* sharedPlacementId(ctx.db, scope, { projectId: projectId, type });
  if (id === null) return null;
  const stored = yield* overlay.get(ctx.db, scope, blocks, id);
  if (!stored) return null;
  return yield* blockView(ctx, scope, stored);
}, Effect.scoped);

// --- Writes ---

/** A request's access to write a block. */
type BlockWrite = ContentAccess<{ block: string }, "write">;

/**
 * Writes a block's content or settings where they live: the block itself, or its synced
 * definition's shared content, which every placement shows. Returns the block as readers see it.
 */
const writeBlockData = Effect.fn("writeBlockData")(function* (
  ctx: ServiceContext,
  access: { block: typeof blocks.$inferSelect; projectId: number },
  shared: SharedContentRow | null,
  values: { content?: unknown; settings?: unknown; updatedAt: number },
  scope: Draft,
) {
  const { block, projectId } = access;
  if (!shared) {
    const result = yield* overlay.update(ctx.db, scope, blocks, block.id, values);
    if (!result) return yield* new NotFoundError();
    return result;
  }
  // In a draft, the first write copies the shared content, which every placement in the draft
  // then shows.
  const updated = yield* overlay.update(ctx.db, scope, sharedContents, shared.id, values);
  if (!updated) return yield* new NotFoundError();
  broadcastSharedContentChange(ctx, scope, projectId, shared.type);
  return {
    ...block,
    content: updated.content,
    settings: updated.settings,
  };
});

export const createBlock = Effect.fn("blocks.createBlock")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof createBlockInput>,
) {
  const {
    id,
    pageId,
    type,
    content,
    settings,
    afterPosition,
    beforePosition,
    repeatableItems: itemSeeds,
  } = yield* decodeInput(createBlockInput, rawInput);
  const { scope, entity: page } = yield* accessTo(ctx, { page: pageId }, "write");

  const now = Date.now();

  // Look up the block definition's content schema and normalize inline repeatable
  // arrays into seeds, so the agent (and any caller) can produce a flat shape.
  const def = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(blockDefinitions)
      .where(
        and(
          eq(blockDefinitions.projectId, page.projectId),
          definitionsIn(blockDefinitions, scope),
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
  yield* validateReferenceValues(
    ctx,
    { ...page, draft: scope },
    def?.contentSchema,
    prepared.bundle,
  );

  // Get all blocks for this page to determine correct position
  const pageBlocks = sortByPosition(
    yield* overlay.select(ctx.db, scope, blocks, eq(blocks.pageId, pageId)),
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
  const result = yield* overlay.insert(ctx.db, scope, blocks, {
    id,
    projectId: page.projectId,
    pageId,
    type,
    content: prepared.content,
    settings: prepared.settings,
    position,
    createdAt: now,
    updatedAt: now,
  });
  if (!result) return yield* new ConflictError({ message: `Block ${id} already exists` });

  // Insert repeatable item seeds in topological order (parents before children).
  if (allSeeds.length > 0) {
    const tempIdToRealId = new Map<string, string>();

    for (const seed of allSeeds) {
      const parentItemId = seed.parentTempId
        ? (tempIdToRealId.get(seed.parentTempId) ?? null)
        : null;
      // A fresh id, so the scope can't already hold the item.
      const inserted = (yield* overlay.insert(ctx.db, scope, repeatableItems, {
        blockId: result.id,
        parentItemId,
        fieldName: seed.fieldName,
        content: seed.content,
        settings: seed.settings,
        position: seed.position,
        createdAt: now,
        updatedAt: now,
      }))!;
      tempIdToRealId.set(seed.tempId, inserted.id);
    }
  }

  yield* adoptSharedContent(ctx, scope, result);

  yield* requestBlockSummary(ctx, scope, page.projectId, result.id, 0);
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    draftId: scope.id,
    projectId: page.projectId,
    targets: [
      // Block create/delete/duplicate restructures the page — refetch the
      // page view and the page list, whose rows carry `content_updated_at`.
      queryKeys.pages.getByPath(page.fullPath),
      queryKeys.pages.list,
      queryKeys.blocks.getPageMarkdown(pageId),
      queryKeys.blocks.getUsageCounts,
    ],
  });

  const stored = (yield* overlay.get(ctx.db, scope, blocks, result.id))!;
  const created = yield* shownBlock(ctx.db, scope, stored);
  return withWarnings(created, artifactWarnings(def?.contentSchema as FieldSchema, content));
}, Effect.scoped);

/** CLI/AI edits may submit both fields; reject either invalid patch before writing either. */
export const editBlock = Effect.fn("blocks.editBlock")(function* (
  ctx: ServiceContext,
  input: { id: string; content?: unknown; settings?: unknown },
) {
  const granted = yield* accessTo(ctx, { block: input.id }, "write");
  if (input.content === undefined && input.settings === undefined) {
    return yield* new InvalidInputError({ message: "Provide content or settings" });
  }
  const schemas = yield* loadBlockSchemas(ctx.db, granted.project.id, input.id, granted.scope);
  if (input.settings !== undefined) {
    yield* validateContent(input.settings, schemas?.settingsSchema, { path: "settings" });
  }
  let result: object = {};
  if (input.content !== undefined) {
    result = yield* writeBlockContent(ctx, granted, input.content);
  }
  if (input.settings !== undefined) {
    result = yield* writeBlockSettings(ctx, granted, input.settings);
  }
  return withWarnings(result, artifactWarnings(schemas?.contentSchema, input.content));
}, Effect.scoped);

export const updateBlockContent = Effect.fn("blocks.updateBlockContent")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof updateBlockContentInput>,
) {
  const { id, content } = yield* decodeInput(updateBlockContentInput, rawInput);
  return yield* writeBlockContent(ctx, yield* accessTo(ctx, { block: id }, "write"), content);
}, Effect.scoped);

/** Writes a block's content, once the request's access to it is known. */
const writeBlockContent = Effect.fn("blocks.writeBlockContent")(function* (
  ctx: ServiceContext,
  { scope, project, entity: access }: BlockWrite,
  content: unknown,
) {
  const id = access.block.id;

  const now = Date.now();

  const contentSchema = yield* loadBlockContentSchema(ctx.db, project.id, id, scope);

  const patch = yield* prepareContentPatch(content, contentSchema);
  yield* validateContent(patch, contentSchema, { allowItemReferences: true });
  yield* validateReferenceValues(ctx, blockScope(access.block, scope), contentSchema, patch);
  const owner = yield* contentOwnerOf(ctx.db, scope, access.block);
  const merged = yield* applyContentPatch(
    ctx,
    scope,
    { root: owner.root, content: (owner.shared ?? access.block).content },
    patch,
    contentSchema,
    now,
  );
  const result = yield* writeBlockData(
    ctx,
    { block: access.block, projectId: project.id },
    owner.shared,
    { content: merged, updatedAt: now },
    scope,
  );

  yield* requestBlockSummary(ctx, scope, project.id, id, 5000);
  // Granular invalidation: only refetch this block, not the entire page.
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    draftId: scope.id,
    projectId: project.id,
    targets: [
      queryKeys.blocks.get(id),
      ...(access.pagePath
        ? [queryKeys.pages.getByPath(access.pagePath)]
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
  const { id, settings } = yield* decodeInput(updateBlockSettingsInput, rawInput);
  return yield* writeBlockSettings(ctx, yield* accessTo(ctx, { block: id }, "write"), settings);
}, Effect.scoped);

/** Writes a block's settings, once the request's access to it is known. */
const writeBlockSettings = Effect.fn("blocks.writeBlockSettings")(function* (
  ctx: ServiceContext,
  { scope, project, entity: access }: BlockWrite,
  settings: unknown,
) {
  const id = access.block.id;

  const schemas = yield* loadBlockSchemas(ctx.db, project.id, id, scope);
  yield* validateContent(settings, schemas?.settingsSchema, { path: "settings" });
  const owner = yield* contentOwnerOf(ctx.db, scope, access.block);
  const merged = {
    ...((owner.shared ?? access.block).settings as Record<string, unknown> | null),
    ...(settings as Record<string, unknown>),
  };
  const result = yield* writeBlockData(
    ctx,
    { block: access.block, projectId: project.id },
    owner.shared,
    { settings: merged, updatedAt: Date.now() },
    scope,
  );
  // Granular invalidation: only refetch this block, not the entire page.
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    draftId: scope.id,
    projectId: project.id,
    targets: [
      queryKeys.blocks.get(id),
      ...(access.pagePath
        ? [queryKeys.pages.getByPath(access.pagePath)]
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
  const { id, afterPosition, beforePosition } = yield* decodeInput(
    updateBlockPositionInput,
    rawInput,
  );
  const { scope, project, entity: access } = yield* accessTo(ctx, { block: id }, "write");

  // Query siblings (excluding the block being moved) to compute a correct position
  const block = access.block;
  const owner = blocksOfOwner(block);
  const siblings = owner
    ? sortByPosition(
        (yield* overlay.select(ctx.db, scope, blocks, owner)).filter((b) => b.id !== id),
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

  // In a draft, the first write copies the whole block: a move carries its content (ADR 0005).
  const result = yield* overlay.update(ctx.db, scope, blocks, id, {
    position,
    updatedAt: Date.now(),
  });
  if (!result) return yield* new NotFoundError();
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    draftId: scope.id,
    projectId: project.id,
    targets: [
      ...(access.pagePath
        ? [queryKeys.pages.getByPath(access.pagePath)]
        : [queryKeys.pages.getByPathAll]),
      queryKeys.pages.list,
      ...(access.block.pageId ? [queryKeys.blocks.getPageMarkdown(access.block.pageId)] : []),
      queryKeys.blocks.getUsageCounts,
    ],
  });
  return yield* shownBlock(ctx.db, scope, result);
}, Effect.scoped);

export const deleteBlock = Effect.fn("blocks.deleteBlock")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof deleteBlockInput>,
) {
  const { id } = yield* decodeInput(deleteBlockInput, rawInput);
  const { scope, project, entity: access } = yield* accessTo(ctx, { block: id }, "write");

  // In a draft, a tombstone hides the block from the draft only.
  const result = yield* overlay.remove(ctx.db, scope, blocks, id);
  if (result) yield* deleteBlockDependents(ctx, scope, [result]);
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    draftId: scope.id,
    projectId: project.id,
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
}, Effect.scoped);

export const deleteBlocks = Effect.fn("blocks.deleteBlocks")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof deleteBlocksInput>,
) {
  const { blockIds } = yield* decodeInput(deleteBlocksInput, rawInput);
  const [first] = blockIds;
  if (!first) return [];
  // Access to the first block names the project and draft; every block must be in them.
  const { scope, project } = yield* accessTo(ctx, { block: first }, "write");
  const shown = yield* overlay.select(
    ctx.db,
    scope,
    blocks,
    and(inArray(blocks.id, blockIds), eq(blocks.projectId, project.id)),
  );
  if (shown.length !== new Set(blockIds).size) return yield* new NotFoundError();
  const result: (typeof blocks.$inferSelect)[] = [];
  for (const id of blockIds) {
    const removed = yield* overlay.remove(ctx.db, scope, blocks, id);
    if (removed) result.push(removed);
  }
  yield* deleteBlockDependents(ctx, scope, result);
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    draftId: scope.id,
    projectId: project.id,
    targets: [queryKeys.pages.getByPathAll, queryKeys.pages.list, queryKeys.blocks.getUsageCounts],
  });
  return result;
}, Effect.scoped);

export const generateBlockSummary = Effect.fn("blocks.generateBlockSummary")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof generateBlockSummaryInput>,
) {
  const { id } = yield* decodeInput(generateBlockSummaryInput, rawInput);
  const { scope, project, entity: access } = yield* accessTo(ctx, { block: id }, "member");

  const seoStale = yield* executeBlockSummary(ctx.db, ctx.env.OPEN_ROUTER_API_KEY, id, scope);
  if (seoStale) yield* requestPageSeo(ctx, scope, seoStale.page, 15000);
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    draftId: scope?.id ?? null,
    projectId: project.id,
    targets: [
      queryKeys.blocks.get(id),
      ...(access.pagePath
        ? [queryKeys.pages.getByPath(access.pagePath)]
        : [queryKeys.pages.getByPathAll]),
      ...(access.block.pageId ? [queryKeys.blocks.getPageMarkdown(access.block.pageId)] : []),
      queryKeys.blocks.getUsageCounts,
    ],
  });
  return yield* overlay.get(ctx.db, scope, blocks, id);
}, Effect.scoped);

export const duplicateBlock = Effect.fn("blocks.duplicateBlock")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof duplicateBlockInput>,
) {
  const { id } = yield* decodeInput(duplicateBlockInput, rawInput);
  const { scope, project, entity: access } = yield* accessTo(ctx, { block: id }, "write");
  const original = access.block;

  const now = Date.now();

  // Find the next block after the original to insert between them
  const owner = blocksOfOwner(original);
  const siblings = owner ? sortByPosition(yield* overlay.select(ctx.db, scope, blocks, owner)) : [];
  // Skip siblings sharing the original's position (ADR 0005): no key fits between them.
  const nextBlock = siblings.find((b) => b.position > original.position);
  const position = generateKeyBetween(original.position, nextBlock?.position ?? null);

  const result = yield* overlay.insert(ctx.db, scope, blocks, {
    projectId: original.projectId,
    pageId: original.pageId,
    layoutId: original.layoutId,
    type: original.type,
    content: original.content,
    settings: original.settings,
    slot: original.slot,
    position,
    createdAt: now,
    updatedAt: now,
  });
  if (!result) return yield* new ConflictError({ message: "The duplicate's id is taken." });
  yield* adoptSharedContent(ctx, scope, result);
  yield* copyValue(
    ctx.db,
    scope,
    homeOf(scope, project.id),
    summaryKeyOf(original.id, null),
    result.id,
  );
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    draftId: scope.id,
    projectId: project.id,
    targets: [
      ...(access.pagePath
        ? [queryKeys.pages.getByPath(access.pagePath)]
        : [queryKeys.pages.getByPathAll]),
      queryKeys.pages.list,
      ...(original.pageId ? [queryKeys.blocks.getPageMarkdown(original.pageId)] : []),
      queryKeys.blocks.getUsageCounts,
    ],
  });
  return yield* shownBlock(ctx.db, scope, result);
}, Effect.scoped);
