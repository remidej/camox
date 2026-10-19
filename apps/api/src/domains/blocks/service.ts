import { uuidv7Schema } from "@camox/api-contract/ids";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Effect, type Scope } from "effect";
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";

import type { Database } from "../../db";
import { AiModel } from "../../lib/ai-model";
import { contentToMarkdown, stripArtifactSources } from "../../lib/content-markdown";
import {
  ConflictError,
  decodeInput,
  InvalidInputError,
  NotFoundError,
  type ServiceError,
} from "../../lib/errors";
import type { Journal } from "../../lib/journal";
import type { AiCallError } from "../../lib/retry-ai-call";
import {
  blockDefinitions,
  blocks,
  layouts,
  pages,
  repeatableItems,
  sharedContents,
} from "../../schema";
import { nestChildItems } from "../_shared/block-markers";
import { conformBlocks } from "../_shared/conform-content";
import { definitionsIn } from "../_shared/definitions";
import type { ServiceContext } from "../_shared/service-context";
import { blockScope, validateReferenceValues } from "../collections/references";
import { type BlockMarkdown, contentReader, type ContentReader } from "../content/reader";
import { accessTo, type ContentAccess } from "../drafts/access";
import * as overlay from "../drafts/overlay";
import { draftIn, type Draft, type DraftScope, type ReadScope } from "../drafts/scope";
import { generateNow, requestGeneration, type Stale } from "../generated-values/generation";
import {
  copyValue,
  homeOf,
  readValue,
  saveValue,
  settleRequest,
} from "../generated-values/service";
import { blocksOfOwner, layoutNamed } from "../layouts/identity";
import { servesPages } from "../layouts/route-ownership";
import { itemsUnder, rootColumns, type ItemRoot } from "../repeatable-items/roots";
import { artifactWarnings, withWarnings } from "./artifact-warnings";
import { normalizeFieldValue } from "./asset-value";
import { loadBlockContentSchema, loadBlockSchemas } from "./content-schema";
import { type FieldSchema } from "./normalize-content";
import { prepareBlockContent, prepareContentPatch } from "./prepare-content";
import {
  adoptSharedContent,
  contentOwnerOf,
  sharedPlacementId,
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
  Journal | Scope.Scope
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
    overlay.sortByPosition(shown.items),
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
 * summary changed: its SEO describes the block.
 */
export const executeBlockSummary = Effect.fn("blocks.executeBlockSummary")(function* (
  db: Database,
  scope: DraftScope,
  blockId: string,
  startedAt: number,
): Effect.fn.Return<Stale | null, AiCallError, AiModel | Journal> {
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

  const model = yield* AiModel;
  const summary = yield* model.summarize({
    type: block.type,
    markdown,
    previousSummary: previous,
  });

  const home = homeOf(scope, projectId);
  yield* saveValue(db, home, key, { summary }, startedAt);
  // The job ran through the placement: settle its request too.
  if (owner.shared) yield* settleRequest(db, home, summaryKeyOf(blockId, null), startedAt);

  const pageId = block.pageId;
  if (summary === previous || !pageId) return null;
  const page = yield* overlay.get(db, scope, pages, pageId);
  return page ? { projectId, target: { entity: "page", row: page } } : null;
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
  scope: Draft,
  block: { root: ItemRoot; content: unknown },
  patch: Record<string, unknown>,
  contentSchema: unknown,
  now: number,
): Effect.fn.Return<Record<string, unknown>, ServiceError, Journal> {
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
  const writes: Effect.Effect<unknown, never, Journal>[] = [];
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
    writes: Effect.Effect<unknown, never, Journal>[];
  },
): Effect.fn.Return<void, ServiceError, Journal> {
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
  const { project, scope, entity } = yield* accessTo(ctx, { block: id }, "public");
  return yield* blockView(
    contentReader(ctx, { projectId: project.id, draft: scope }),
    entity.block,
  );
}, Effect.scoped);

/** A block as a scope's readers see it, with its items and the files and records they use. */
const blockView = Effect.fn("blocks.blockView")(function* (
  reader: ContentReader,
  stored: typeof blocks.$inferSelect,
) {
  const bundle = yield* reader.blocks([{ block: stored }]);
  return { block: bundle.blocks[0]!, repeatableItems: bundle.repeatableItems, files: bundle.files };
});

/** Joins the Markdown of a layout's before and after slots, skipping blocks without Markdown. */
function layoutSlotsMarkdown(rendered: readonly BlockMarkdown[]) {
  const slot = (name: "before" | "after") =>
    rendered
      .filter((block) => block.pageId === null && block.slot === name && block.markdown)
      .map((block) => block.markdown)
      .join("\n\n");
  return { before: slot("before"), after: slot("after") };
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

  const rendered = yield* contentReader(ctx, { projectId: page.projectId, draft: scope }).markdown([
    { pageId },
    { layoutId: page.layoutId },
  ]);
  const { before, after } = layoutSlotsMarkdown(rendered);
  const blockMarkdowns = rendered
    .filter((block) => block.pageId === pageId)
    .map((block) => ({
      id: block.id,
      position: block.position,
      markdown: block.markdown ?? block.json,
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
  return layoutSlotsMarkdown(
    yield* contentReader(ctx, { projectId: project.id, draft: scope }).markdown([
      { layoutId: layout.layoutId },
    ]),
  );
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
  return yield* blockView(contentReader(ctx, { projectId, draft: scope }), stored);
}, Effect.scoped);

// --- Writes ---

/** A block as readers see it, for a write's response. */
const shownBlock = Effect.fn("blocks.shownBlock")(function* (
  ctx: ServiceContext,
  projectId: number,
  scope: ReadScope,
  block: typeof blocks.$inferSelect,
) {
  return (yield* contentReader(ctx, { projectId, draft: scope }).shown.blocks([block]))[0]!;
});

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
  const { block } = access;
  if (!shared) {
    const result = yield* overlay.update(ctx.db, scope, blocks, block.id, values);
    if (!result) return yield* new NotFoundError();
    return result;
  }
  // In a draft, the first write copies the shared content, which every placement in the draft
  // then shows.
  const updated = yield* overlay.update(ctx.db, scope, sharedContents, shared.id, values);
  if (!updated) return yield* new NotFoundError();
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

  yield* requestGeneration(
    ctx.db,
    homeOf(scope, page.projectId),
    { entity: "block", row: result },
    { immediately: true },
  );

  const stored = (yield* overlay.get(ctx.db, scope, blocks, result.id))!;
  const created = yield* shownBlock(ctx, page.projectId, scope, stored);
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

  yield* requestGeneration(ctx.db, homeOf(scope, project.id), {
    entity: "block",
    row: { id },
  });

  return yield* shownBlock(ctx, project.id, scope, result);
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
  return yield* shownBlock(ctx, project.id, scope, result);
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
  return yield* shownBlock(ctx, project.id, scope, result);
}, Effect.scoped);

export const deleteBlock = Effect.fn("blocks.deleteBlock")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof deleteBlockInput>,
) {
  const { id } = yield* decodeInput(deleteBlockInput, rawInput);
  const { scope, project } = yield* accessTo(ctx, { block: id }, "write");

  // In a draft, a tombstone hides the block from the draft only.
  const result = yield* overlay.remove(ctx.db, scope, blocks, id);
  if (result) yield* deleteBlockDependents(ctx, scope, [result]);
  return result && (yield* shownBlock(ctx, project.id, scope, result));
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
  return yield* contentReader(ctx, { projectId: project.id, draft: scope }).shown.blocks(result);
}, Effect.scoped);

export const generateBlockSummary = Effect.fn("blocks.generateBlockSummary")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof generateBlockSummaryInput>,
) {
  const { id } = yield* decodeInput(generateBlockSummaryInput, rawInput);
  const { scope, project } = yield* accessTo(ctx, { block: id }, "member");

  yield* generateNow(ctx.db, draftIn(scope), "block", id).pipe(Effect.orDie);
  const stored = yield* overlay.get(ctx.db, scope, blocks, id);
  return stored && (yield* shownBlock(ctx, project.id, scope, stored));
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
  return yield* shownBlock(ctx, project.id, scope, result);
}, Effect.scoped);
