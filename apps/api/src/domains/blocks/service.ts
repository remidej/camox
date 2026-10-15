import { uuidv7Schema } from "@camox/api-contract/ids";
import { queryKeys } from "@camox/api-contract/query-keys";
import { chat } from "@tanstack/ai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import { and, eq, inArray, sql } from "drizzle-orm";
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
import { contentToMarkdown, stripArtifactSources } from "../../lib/content-markdown";
import {
  ConflictError,
  decodeInput,
  InvalidInputError,
  NotFoundError,
  type ServiceError,
} from "../../lib/errors";
import { resolveEnvironment } from "../../lib/resolve-environment";
import { scheduleAiJob } from "../../lib/schedule-ai-job";
import {
  blockDefinitions,
  blocks,
  comments,
  environments,
  files,
  layouts,
  member,
  pages,
  projects,
  repeatableItems,
  sharedContents,
} from "../../schema";
import { conformBlocks, conformBlocksIn } from "../_shared/conform-content";
import { readOwnerBlocks } from "../_shared/owner-blocks";
import type { ServiceContext } from "../_shared/service-context";
import {
  blockScope,
  hydrateItemReferences,
  hydrateReferences,
  type ResolvedReferences,
  validateReferenceValues,
} from "../collections/references";
import * as overlay from "../drafts/overlay";
import type { DraftScope } from "../drafts/scope";
import { draftScopeOfJob } from "../drafts/service";
import { blocksOfOwner, layoutNamed } from "../layouts/identity";
import { servesPages } from "../layouts/route-ownership";
import { buildFileMap, collectFileIds, sortItemsByPosition } from "../pages/ai";
import { descendantIdsOf, itemsUnder, rootColumns, type ItemRoot } from "../repeatable-items/roots";
import { artifactWarnings, withWarnings } from "./artifact-warnings";
import { normalizeFieldValue } from "./asset-value";
import { loadBlockContentSchema, loadBlockSchemas } from "./content-schema";
import { type FieldSchema } from "./normalize-content";
import { prepareBlockContent, prepareContentPatch } from "./prepare-content";
import {
  adoptSharedContent,
  broadcastSharedContentChange,
  bumpPlacementOwners,
  contentOwnerOf,
  definitionOf,
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
// A Block Definition within a project's current environment.
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
 * Bumps the Live page or layout owning a block. Skipped for draft writes, which must leave
 * Live pages and layouts untouched until pages move into drafts (#238).
 */
const bumpLiveOwner = (ctx: ServiceContext, scope: DraftScope, parent: BlockParent) =>
  scope ? Effect.void : bumpContentUpdatedAt(ctx.db, parent);

type BlockParent = Parameters<typeof bumpContentUpdatedAt>[1];

/**
 * Once no scope holds a deleted block any more, deletes the repeatable items it owns and
 * unanchors its comments, which hold no foreign key to it and live in Live (ADR 0005). A block
 * deleted on Live keeps them while a draft's copy still shows it; a block a draft created takes
 * them along when the draft deletes it.
 */
const deleteBlockDependents = Effect.fn("blocks.deleteBlockDependents")(function* (
  ctx: ServiceContext,
  blockIds: string[],
) {
  const held = yield* overlay.idsHeldAnywhere(ctx.db, blocks, blockIds);
  const gone = blockIds.filter((id) => !held.has(id));
  if (gone.length === 0) return;
  yield* Effect.promise(() =>
    ctx.db.batch([
      ctx.db.delete(repeatableItems).where(inArray(repeatableItems.blockId, gone)),
      ctx.db.update(comments).set({ blockId: null }).where(inArray(comments.blockId, gone)),
    ]),
  );
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
  scope: DraftScope,
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

  // Get block definition for content schema and field order. Scope by
  // environmentId — the same blockId can exist with different shapes across
  // environments (e.g. mid-migration).
  const environmentId = stored.environmentId;
  const environment = yield* Effect.promise(() =>
    db.select().from(environments).where(eq(environments.id, environmentId)).get(),
  );
  const projectId = environment?.projectId ?? null;

  const def = projectId
    ? yield* Effect.promise(() =>
        db
          .select()
          .from(blockDefinitions)
          .where(
            and(
              eq(blockDefinitions.projectId, projectId),
              eq(blockDefinitions.environmentId, environmentId),
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
    return { block, content: ordered, contentSchema };
  }

  return { block, content, contentSchema };
});

/**
 * Generates and stores a summary for a block as a scope reads it.
 * Returns `{ pageId }` if the parent page has AI SEO enabled (caller should cascade).
 *
 * In a draft, the summary is written only onto a block or shared content the draft already
 * holds, never copying one into it, and nothing cascades to Live's page SEO.
 */
/** Saves a generated summary where the block's content lives: its shared content, or itself. */
const saveSummary = Effect.fn("blocks.saveSummary")(function* (
  db: Database,
  scope: DraftScope,
  blockId: string,
  shared: SharedContentRow | null,
  summary: string,
) {
  const updatedAt = Date.now();
  if (!shared) {
    yield* overlay.updateExisting(db, scope, blocks, blockId, { summary, updatedAt });
    return;
  }
  yield* overlay.updateExisting(db, scope, sharedContents, shared.id, { summary, updatedAt });
});

export const executeBlockSummary = Effect.fn("blocks.executeBlockSummary")(function* (
  db: Database,
  apiKey: string,
  blockId: string,
  scope: DraftScope,
  abortController?: AbortController,
): Effect.fn.Return<{ pageId: string } | null> {
  // A draft summarises only the blocks it holds; the others are Live's to summarise.
  if (scope && !(yield* overlay.getStored(db, scope, blocks, blockId))) return null;
  const assembled = yield* assembleBlockContent(db, blockId, scope);
  if (!assembled) return null;

  const { block, content, contentSchema } = assembled;
  // A synced placement's summary is its shared content's.
  const owner = yield* contentOwnerOf(db, scope, block);

  const markdown =
    contentSchema?.toMarkdown && contentSchema?.properties
      ? contentToMarkdown(contentSchema.toMarkdown, contentSchema.properties, content, {
          settings: block.settings as Record<string, unknown> | null | undefined,
        })
      : JSON.stringify(stripArtifactSources(contentSchema?.properties, content));

  const summary = yield* generateObjectSummary(
    apiKey,
    { type: block.type, markdown, previousSummary: block.summary },
    abortController,
  );

  yield* saveSummary(db, scope, blockId, owner.shared, summary);

  // Check if we should cascade to page SEO
  const pageId = block.pageId;
  if (summary !== block.summary && pageId && !scope) {
    const page = yield* Effect.promise(() =>
      db
        .select()
        .from(pages)
        .where(and(eq(pages.id, pageId), overlay.storedIn(pages, null)))
        .get(),
    );
    if (page?.aiSeoEnabled !== false) {
      return { pageId };
    }
  }

  return null;
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
  return yield* executeBlockSummary(db, apiKey, job.entityId, scope, abortController);
});

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
  scope: DraftScope,
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
  scope: DraftScope,
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
          summary: "",
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
              summary: "",
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

  // Delete unreferenced existing items. On Live their nested children go with them; a draft's
  // tombstone hides them.
  for (const item of scopeItems) {
    if (referenced.has(item.id)) continue;
    writes.push(
      Effect.gen(function* () {
        if (!scope) {
          const nested = descendantIdsOf(allItems, item.id);
          if (nested.length > 0) {
            yield* Effect.promise(() =>
              ctx.db
                .delete(repeatableItems)
                .where(
                  and(inArray(repeatableItems.id, nested), overlay.storedIn(repeatableItems, null)),
                ),
            );
          }
        }
        yield* overlay.remove(ctx.db, scope, repeatableItems, item.id);
      }),
    );
  }
});

// --- Reads ---

export const getBlock = Effect.fn("blocks.getBlock")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getBlockInput>,
  scope: DraftScope,
) {
  const { id } = yield* decodeInput(getBlockInput, rawInput);
  const stored = yield* overlay.get(ctx.db, scope, blocks, id);
  if (!stored) return yield* new NotFoundError();
  const shown = yield* withSharedContent(
    ctx.db,
    scope,
    [stored],
    yield* overlay.select(ctx.db, scope, repeatableItems, eq(repeatableItems.blockId, stored.id)),
  );
  const conformed = yield* conformBlocksIn(ctx, stored, shown.blocks, shown.items);
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

  const referenceScope = yield* blockScope(ctx, block);
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
  scope: { projectId: number; environmentId: number },
  blockRows: RenderableBlock[],
  itemRows: RenderableItem[],
) {
  // Get block definitions for content schemas and Markdown representations. Scope
  // by environmentId — the same blockId can exist with different shapes across
  // environments (e.g. mid-migration).
  const defs = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(blockDefinitions)
      .where(
        and(
          eq(blockDefinitions.projectId, scope.projectId),
          eq(blockDefinitions.environmentId, scope.environmentId),
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
  const fileMap = yield* buildFileMap(ctx.db, fileIds);

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
  scope: DraftScope,
) {
  const { pageId } = yield* decodeInput(getPageMarkdownInput, rawInput);

  const page = yield* Effect.promise(() =>
    ctx.db.select().from(pages).where(eq(pages.id, pageId)).get(),
  );
  if (!page) return yield* new NotFoundError();
  const pageLayout = yield* Effect.promise(() =>
    ctx.db.select().from(layouts).where(layoutNamed(page.environmentId, page.layoutId)).get(),
  );
  if (!servesPages(pageLayout)) return yield* new NotFoundError();

  const { blocks: sorted, items: allItems } = yield* readOwnerBlocks(ctx, { pageId }, scope);
  const { blocks: sortedLayout, items: layoutAllItems } = yield* readOwnerBlocks(
    ctx,
    { environmentId: page.environmentId, layoutId: page.layoutId },
    scope,
  );

  const render = yield* renderBlocksMarkdown(
    ctx,
    page,
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
});

/**
 * The Markdown of a code-owned layout's before and after slots, for pages
 * without a page row (singleton and derived layouts).
 */
export const getLayoutMarkdown = Effect.fn("blocks.getLayoutMarkdown")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getLayoutMarkdownInput>,
  scope: DraftScope,
) {
  const { projectSlug, layoutId } = yield* decodeInput(getLayoutMarkdownInput, rawInput);
  const project = yield* Effect.promise(() =>
    ctx.db.select().from(projects).where(eq(projects.slug, projectSlug)).get(),
  );
  if (!project) return yield* new NotFoundError();
  const environment = yield* resolveEnvironment(ctx.db, project.id, ctx.environmentName);
  const layout = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(layouts)
      .where(and(eq(layouts.environmentId, environment.id), eq(layouts.layoutId, layoutId)))
      .get(),
  );
  if (!layout) return yield* new NotFoundError();
  const { blocks: layoutBlocks, items } = yield* readOwnerBlocks(ctx, layout, scope);
  const render = yield* renderBlocksMarkdown(ctx, layout, layoutBlocks, items);
  return layoutSlotsMarkdown(layoutBlocks, render.markdown);
});

export const getBlocksUsageCounts = Effect.fn("blocks.getBlocksUsageCounts")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getBlocksUsageCountsInput>,
  scope: DraftScope,
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
      .where(and(overlay.visibleIn(blocks, scope), eq(blocks.environmentId, environment.id)))
      .groupBy(blocks.type),
  );
});

/**
 * The distinct Pages of the current environment that place a Block Definition.
 * Unlike usage counts, several placements on one Page count once, and layout
 * placements don't count, since they aren't on a Page.
 */
export const getPagesUsingBlock = Effect.fn("blocks.getPagesUsingBlock")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof blockTypeInput>,
  scope: DraftScope,
) {
  const { projectId, type } = yield* decodeInput(blockTypeInput, rawInput);
  const environment = yield* resolveEnvironment(ctx.db, projectId, ctx.environmentName);
  return yield* Effect.promise(() =>
    ctx.db
      .selectDistinct({ id: pages.id, nickname: pages.nickname, fullPath: pages.fullPath })
      .from(blocks)
      .innerJoin(pages, eq(blocks.pageId, pages.id))
      .where(
        and(
          overlay.visibleIn(blocks, scope),
          eq(blocks.type, type),
          eq(pages.environmentId, environment.id),
        ),
      )
      .orderBy(pages.fullPath),
  );
});

/**
 * A Synced Block's shared content in the current environment, as a
 * block bundle. Null when the block isn't synced or has no placement yet.
 */
export const getSyncedBlockContent = Effect.fn("blocks.getSyncedBlockContent")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof blockTypeInput>,
  scope: DraftScope,
) {
  const { projectId, type } = yield* decodeInput(blockTypeInput, rawInput);
  const environment = yield* resolveEnvironment(ctx.db, projectId, ctx.environmentName);
  const id = yield* sharedPlacementId(ctx.db, scope, { environmentId: environment.id, type });
  if (id === null) return null;
  return yield* getBlock(ctx, { id }, scope);
});

// --- Writes ---

/**
 * Writes a block's content or settings where they live: the block itself, or its synced
 * definition's shared content, which every placement shows. Returns the block as readers see it.
 */
const writeBlockData = Effect.fn("writeBlockData")(function* (
  ctx: ServiceContext,
  access: { block: typeof blocks.$inferSelect; projectId: number },
  shared: SharedContentRow | null,
  values: { content?: unknown; settings?: unknown; updatedAt: number },
  scope: DraftScope,
) {
  const { block, projectId } = access;
  if (!shared) {
    const result = yield* overlay.update(ctx.db, scope, blocks, block.id, values);
    if (!result) return yield* new NotFoundError();
    yield* bumpLiveOwner(ctx, scope, block);
    return result;
  }
  // In a draft, the first write copies the shared content, which every placement in the draft
  // then shows.
  const updated = yield* overlay.update(ctx.db, scope, sharedContents, shared.id, values);
  if (!updated) return yield* new NotFoundError();
  if (!scope) yield* bumpPlacementOwners(ctx.db, definitionOf(shared));
  broadcastSharedContentChange(ctx, scope, projectId, shared.type);
  return {
    ...block,
    content: updated.content,
    settings: updated.settings,
    summary: updated.summary,
  };
});

export const createBlock = Effect.fn("blocks.createBlock")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof createBlockInput>,
  scope: DraftScope,
) {
  const user = yield* requireUser(ctx);
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
  const access = yield* assertPageAccess(ctx.db, pageId, user.id, scope);
  // A draft holds content of its own project only.
  if (scope && scope.projectId !== access.page.projectId) return yield* new NotFoundError();

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
  yield* validateReferenceValues(ctx, access.page, def?.contentSchema, prepared.bundle);

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
    environmentId: access.page.environmentId,
    pageId,
    type,
    content: prepared.content,
    settings: prepared.settings,
    position,
    summary: "",
    createdAt: now,
    updatedAt: now,
  });
  if (!result) return yield* new ConflictError({ message: `Block ${id} already exists` });

  // Insert repeatable item seeds in topological order (parents before children). Items are
  // stored in Live even for a block created in a draft, until they move into drafts (#238).
  if (allSeeds.length > 0) {
    const tempIdToRealId = new Map<string, string>();

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

  yield* adoptSharedContent(ctx, scope, result);
  yield* bumpLiveOwner(ctx, scope, { pageId });

  ctx.waitUntil(
    scheduleAiJob(ctx.env.AI_JOB_SCHEDULER, {
      entityTable: "blocks",
      entityId: result.id,
      type: "summary",
      delayMs: 0,
      draftId: scope?.id ?? null,
    }),
  );
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    draftId: scope?.id ?? null,
    projectId: access.page.projectId,
    targets: [
      // Block create/delete/duplicate restructures the page — refetch the
      // page view and the page list, whose rows carry `content_updated_at`.
      queryKeys.pages.getByPath(access.page.fullPath),
      queryKeys.pages.list,
      queryKeys.blocks.getPageMarkdown(pageId),
      queryKeys.blocks.getUsageCounts,
    ],
  });

  const stored = (yield* overlay.get(ctx.db, scope, blocks, result.id))!;
  const created = yield* shownBlock(ctx.db, scope, stored);
  return withWarnings(created, artifactWarnings(def?.contentSchema as FieldSchema, content));
});

/** CLI/AI edits may submit both fields; reject either invalid patch before writing either. */
export const editBlock = Effect.fn("blocks.editBlock")(function* (
  ctx: ServiceContext,
  input: { id: string; content?: unknown; settings?: unknown },
  scope: DraftScope,
) {
  const user = yield* requireUser(ctx);
  const access = yield* assertBlockAccess(ctx.db, input.id, user.id, scope);
  if (input.content === undefined && input.settings === undefined) {
    return yield* new InvalidInputError({ message: "Provide content or settings" });
  }
  const schemas = yield* loadBlockSchemas(ctx.db, access.projectId, input.id);
  if (input.settings !== undefined) {
    yield* validateContent(input.settings, schemas?.settingsSchema, { path: "settings" });
  }
  let result: object = {};
  if (input.content !== undefined) {
    result = yield* updateBlockContent(ctx, { id: input.id, content: input.content }, scope);
  }
  if (input.settings !== undefined) {
    result = yield* updateBlockSettings(ctx, { id: input.id, settings: input.settings }, scope);
  }
  return withWarnings(result, artifactWarnings(schemas?.contentSchema, input.content));
});

export const updateBlockContent = Effect.fn("blocks.updateBlockContent")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof updateBlockContentInput>,
  scope: DraftScope,
) {
  const user = yield* requireUser(ctx);
  const { id, content } = yield* decodeInput(updateBlockContentInput, rawInput);
  const access = yield* assertBlockAccess(ctx.db, id, user.id, scope);

  const now = Date.now();

  const contentSchema = yield* loadBlockContentSchema(ctx.db, access.projectId, id);

  const patch = yield* prepareContentPatch(content, contentSchema);
  yield* validateContent(patch, contentSchema, { allowItemReferences: true });
  yield* validateReferenceValues(ctx, yield* blockScope(ctx, access.block), contentSchema, patch);
  const owner = yield* contentOwnerOf(ctx.db, scope, access.block);
  // Repeater patches write the Live repeatable items, even from a draft, until items move into
  // drafts (#238).
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
    access,
    owner.shared,
    { content: merged, updatedAt: now },
    scope,
  );

  ctx.waitUntil(
    scheduleAiJob(ctx.env.AI_JOB_SCHEDULER, {
      entityTable: "blocks",
      entityId: id,
      type: "summary",
      delayMs: 5000,
      draftId: scope?.id ?? null,
    }),
  );
  // Granular invalidation: only refetch this block, not the entire page.
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    draftId: scope?.id ?? null,
    projectId: access.projectId,
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
  scope: DraftScope,
) {
  const user = yield* requireUser(ctx);
  const { id, settings } = yield* decodeInput(updateBlockSettingsInput, rawInput);
  const access = yield* assertBlockAccess(ctx.db, id, user.id, scope);

  const schemas = yield* loadBlockSchemas(ctx.db, access.projectId, id);
  yield* validateContent(settings, schemas?.settingsSchema, { path: "settings" });
  const owner = yield* contentOwnerOf(ctx.db, scope, access.block);
  const merged = {
    ...((owner.shared ?? access.block).settings as Record<string, unknown> | null),
    ...(settings as Record<string, unknown>),
  };
  const result = yield* writeBlockData(
    ctx,
    access,
    owner.shared,
    { settings: merged, updatedAt: Date.now() },
    scope,
  );
  // Granular invalidation: only refetch this block, not the entire page.
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    draftId: scope?.id ?? null,
    projectId: access.projectId,
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
  scope: DraftScope,
) {
  const user = yield* requireUser(ctx);
  const { id, afterPosition, beforePosition } = yield* decodeInput(
    updateBlockPositionInput,
    rawInput,
  );
  const access = yield* assertBlockAccess(ctx.db, id, user.id, scope);

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
  yield* bumpLiveOwner(ctx, scope, access.block);
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    draftId: scope?.id ?? null,
    projectId: access.projectId,
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
});

export const deleteBlock = Effect.fn("blocks.deleteBlock")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof deleteBlockInput>,
  scope: DraftScope,
) {
  const user = yield* requireUser(ctx);
  const { id } = yield* decodeInput(deleteBlockInput, rawInput);
  const access = yield* assertBlockAccess(ctx.db, id, user.id, scope);

  // In a draft, a tombstone hides the block from the draft only.
  const result = yield* overlay.remove(ctx.db, scope, blocks, id);
  yield* deleteBlockDependents(ctx, [id]);
  yield* bumpLiveOwner(ctx, scope, access.block);
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    draftId: scope?.id ?? null,
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
  scope: DraftScope,
) {
  const user = yield* requireUser(ctx);
  const { blockIds } = yield* decodeInput(deleteBlocksInput, rawInput);
  if (blockIds.length === 0) return [];

  // Verify all blocks, as the scope reads them, belong to an org the user is a member of
  const authorizedBlocks = yield* Effect.promise(() =>
    ctx.db
      .select({ id: blocks.id, projectId: projects.id })
      .from(blocks)
      .innerJoin(environments, eq(environments.id, blocks.environmentId))
      .innerJoin(projects, eq(projects.id, environments.projectId))
      .innerJoin(
        member,
        and(eq(member.organizationId, projects.organizationId), eq(member.userId, user.id)),
      )
      .where(and(overlay.visibleIn(blocks, scope), inArray(blocks.id, blockIds))),
  );
  if (authorizedBlocks.length !== blockIds.length) {
    return yield* new NotFoundError();
  }
  // A draft holds content of its own project only.
  if (scope && authorizedBlocks.some((block) => block.projectId !== scope.projectId)) {
    return yield* new NotFoundError();
  }
  // Bump first — once the rows are gone, we can't recover their parents.
  if (!scope) yield* bumpContentUpdatedAtForBlocks(ctx.db, blockIds);
  const result: (typeof blocks.$inferSelect)[] = [];
  for (const id of blockIds) {
    const removed = yield* overlay.remove(ctx.db, scope, blocks, id);
    if (removed) result.push(removed);
  }
  yield* deleteBlockDependents(ctx, blockIds);
  const projectId = authorizedBlocks[0]?.projectId;
  if (projectId) {
    broadcastInvalidation({
      waitUntil: ctx.waitUntil,
      projectRoomNamespace: ctx.env.ProjectRoom,
      draftId: scope?.id ?? null,
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
  scope: DraftScope,
) {
  const user = yield* requireUser(ctx);
  const { id } = yield* decodeInput(generateBlockSummaryInput, rawInput);
  const access = yield* assertBlockAccess(ctx.db, id, user.id, scope);

  const seoStale = yield* executeBlockSummary(ctx.db, ctx.env.OPEN_ROUTER_API_KEY, id, scope);
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
    draftId: scope?.id ?? null,
    projectId: access.projectId,
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
});

export const duplicateBlock = Effect.fn("blocks.duplicateBlock")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof duplicateBlockInput>,
  scope: DraftScope,
) {
  const user = yield* requireUser(ctx);
  const { id } = yield* decodeInput(duplicateBlockInput, rawInput);
  const access = yield* assertBlockAccess(ctx.db, id, user.id, scope);
  const original = access.block;

  const now = Date.now();

  // Find the next block after the original to insert between them
  const owner = blocksOfOwner(original);
  const siblings = owner ? sortByPosition(yield* overlay.select(ctx.db, scope, blocks, owner)) : [];
  // Skip siblings sharing the original's position (ADR 0005): no key fits between them.
  const nextBlock = siblings.find((b) => b.position > original.position);
  const position = generateKeyBetween(original.position, nextBlock?.position ?? null);

  const result = yield* overlay.insert(ctx.db, scope, blocks, {
    environmentId: original.environmentId,
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
  });
  if (!result) return yield* new ConflictError({ message: "The duplicate's id is taken." });
  yield* adoptSharedContent(ctx, scope, result);
  yield* bumpLiveOwner(ctx, scope, original);
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    draftId: scope?.id ?? null,
    projectId: access.projectId,
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
});
