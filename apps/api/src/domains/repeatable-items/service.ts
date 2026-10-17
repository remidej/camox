import { uuidv7Schema } from "@camox/api-contract/ids";
import { chat } from "@tanstack/ai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { generateKeyBetween } from "fractional-indexing";
import { outdent } from "outdent";
import { z } from "zod";

import type { Database } from "../../db";
import { stripArtifactSources } from "../../lib/content-markdown";
import { ConflictError, decodeInput, InvalidInputError, NotFoundError } from "../../lib/errors";
import { blocks, repeatableItems } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
import { loadDefinitionSchemas } from "../blocks/content-schema";
import { initializeBlockContent } from "../blocks/initialize-content";
import {
  sanitizeItemContent,
  validateItemSeeds,
  type FieldSchema,
} from "../blocks/normalize-content";
import { contentWithSeeds } from "../blocks/prepare-content";
import { requestBlockSummary } from "../blocks/service";
import { contentOwnerOf, definitionOf, sharedPlacementId } from "../blocks/shared-content";
import { validateContent } from "../blocks/validate-content";
import { blockScope, validateReferenceValues } from "../collections/references";
import { contentReader } from "../content/reader";
import { accessTo } from "../drafts/access";
import * as overlay from "../drafts/overlay";
import type { DraftScope } from "../drafts/scope";
import { draftScopeOfJob } from "../drafts/service";
import {
  copyValue,
  homeOf,
  readValue,
  requestGeneration,
  saveValue,
} from "../generated-values/service";
import { itemsUnder, rootColumns, rootOfItem, type DefinitionKey, type ItemRoot } from "./roots";

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

export const getRepeatableItemInput = z.object({ id: uuidv7Schema });
/** The server mints the id; a client may mint one for an optimistic insert. */
export const createRepeatableItemInput = z.object({
  id: uuidv7Schema.optional(),
  blockId: uuidv7Schema,
  parentItemId: uuidv7Schema.nullable().optional(),
  fieldName: z.string(),
  content: z.unknown(),
  settings: z.unknown().optional(),
  afterPosition: z.string().nullable().optional(),
  nestedItems: z.array(nestedItemSeedSchema).optional(),
});
export const updateRepeatableItemContentInput = z.object({
  id: uuidv7Schema,
  content: z.unknown(),
});
export const updateRepeatableItemSettingsInput = z.object({
  id: uuidv7Schema,
  settings: z.unknown(),
});
export const updateRepeatableItemPositionInput = z.object({
  id: uuidv7Schema,
  afterPosition: z.string().nullable().optional(),
  beforePosition: z.string().nullable().optional(),
});
export const duplicateRepeatableItemInput = z.object({ id: uuidv7Schema });
export const generateRepeatableItemSummaryInput = z.object({ id: uuidv7Schema });
export const deleteRepeatableItemInput = z.object({ id: uuidv7Schema });

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
  scope: DraftScope,
  root: ItemRoot,
  parentItemId: string | null,
  fieldName: string,
) {
  if (parentItemId == null) return [fieldName];
  const all = yield* itemsOfTree(db, scope, root);
  const byId = new Map(all.map((i) => [i.id, i]));
  const ancestors: string[] = [];
  const visited = new Set<string>();
  let cur: string | null = parentItemId;
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

/**
 * The item tree under a root, with the block definition shaping it: a block's, or a synced
 * definition's shared content, which every placement of the definition shows.
 */
type ItemTree = { root: ItemRoot; definition: DefinitionKey };

/** Every item in a tree as a scope reads it. */
const itemsOfTree = (db: Database, scope: DraftScope, root: ItemRoot) =>
  overlay.select(db, scope, repeatableItems, itemsUnder(root));

const treeOfRoot = Effect.fn("treeOfRoot")(function* (
  db: Database,
  scope: DraftScope,
  root: ItemRoot,
) {
  if ("sharedContent" in root) return { root, definition: root.sharedContent } satisfies ItemTree;
  const block = yield* overlay.get(db, scope, blocks, root.blockId);
  if (!block) return yield* new NotFoundError();
  return { root, definition: definitionOf(block) } satisfies ItemTree;
});

/** The tree new items of a block go in: the block's own, or its shared content's. */
const treeOfBlock = Effect.fn("treeOfBlock")(function* (
  db: Database,
  scope: DraftScope,
  block: typeof blocks.$inferSelect,
) {
  const owner = yield* contentOwnerOf(db, scope, block);
  return { root: owner.root, definition: definitionOf(block) } satisfies ItemTree;
});

const treeSchema = Effect.fn("treeSchema")(function* (
  db: Database,
  tree: ItemTree,
  scope: DraftScope,
) {
  return (yield* loadDefinitionSchemas(db, tree.definition, scope))?.contentSchema;
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

const itemSummaryKey = (itemId: string) =>
  ({ entity: "repeatableItem", entityId: itemId, type: "summary" }) as const;

/**
 * Generates a repeatable item's summary as a scope reads it, into the scope's generated values:
 * never into the item, so it never copies one into a draft (ADR 0012). Returns the block to
 * summarise again when the summary changed: the item's own, or a placement of its shared
 * content.
 */
export const executeRepeatableItemSummary = Effect.fn("repeatableItems.executeSummary")(function* (
  db: Database,
  apiKey: string,
  itemId: string,
  scope: DraftScope,
  abortController?: AbortController,
) {
  const startedAt = Date.now();
  const item = yield* overlay.get(db, scope, repeatableItems, itemId);
  if (!item) return null;

  const tree = yield* treeOfRoot(db, scope, rootOfItem(item)).pipe(
    Effect.orElseSucceed(() => null),
  );
  if (!tree) return null;
  const { projectId } = tree.definition;

  const schema = yield* treeSchema(db, tree, scope);
  const itemSchema = yield* Effect.gen(function* () {
    const path = yield* resolveItemFieldNamePath(
      db,
      scope,
      tree.root,
      item.parentItemId,
      item.fieldName,
    );
    return (yield* descendRepeaterSchema(schema, path))?.items;
  }).pipe(Effect.orElseSucceed(() => undefined));
  const content = stripArtifactSources(
    itemSchema?.properties,
    item.content as Record<string, unknown>,
  );

  const previous = (yield* readValue(db, scope, itemSummaryKey(itemId))).value?.summary ?? "";
  const summary = yield* generateObjectSummary(
    apiKey,
    {
      type: tree.definition.type,
      markdown: JSON.stringify(content),
      previousSummary: previous,
    },
    abortController,
  );

  yield* saveValue(db, homeOf(scope, projectId), itemSummaryKey(itemId), { summary }, startedAt);

  if (summary === previous) return null;
  // A shared content's summary is generated through any of its placements.
  const blockId =
    "blockId" in tree.root
      ? tree.root.blockId
      : yield* sharedPlacementId(db, scope, tree.definition);
  return blockId === null ? null : { blockId, projectId };
});

/** Runs an item summary job in the scope it was scheduled from; nothing once its draft ended. */
export const runRepeatableItemSummaryJob = Effect.fn("repeatableItems.runSummaryJob")(function* (
  db: Database,
  apiKey: string,
  job: { entityId: string; draftId: string | null },
  abortController?: AbortController,
) {
  const scope = yield* draftScopeOfJob(db, job.draftId);
  if (scope === undefined) return null;
  const cascade = yield* executeRepeatableItemSummary(
    db,
    apiKey,
    job.entityId,
    scope,
    abortController,
  );
  return cascade ? { ...cascade, scope } : null;
});

/** Requests an item's summary in the scope it was written in (ADR 0012). */
const requestSummary = (
  ctx: ServiceContext,
  scope: DraftScope,
  projectId: number,
  entityId: string,
  delayMs: number,
) =>
  requestGeneration(ctx, homeOf(scope, projectId), {
    entity: "repeatableItem",
    entityId,
    delayMs,
  });

/** The siblings of an item in its repeater, as a scope reads them, in order. */
const siblingsOf = Effect.fn("repeatableItems.siblingsOf")(function* (
  db: Database,
  scope: DraftScope,
  tree: ItemTree,
  fieldName: string,
  parentItemId: string | null,
) {
  const rows = yield* overlay.select(
    db,
    scope,
    repeatableItems,
    and(itemsUnder(tree.root), eq(repeatableItems.fieldName, fieldName)),
  );
  return overlay.sortByPosition(rows.filter((item) => item.parentItemId === parentItemId));
});

/** An item as readers see it, for a write's response. */
const shownItem = Effect.fn("repeatableItems.shownItem")(function* (
  ctx: ServiceContext,
  projectId: number,
  scope: DraftScope,
  item: typeof repeatableItems.$inferSelect,
) {
  const reader = contentReader(ctx, { projectId, draft: scope });
  return (yield* reader.shown.items([item]))[0]!;
});

// --- Reads ---

export const getRepeatableItem = Effect.fn("repeatableItems.getRepeatableItem")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getRepeatableItemInput>,
) {
  const { id } = yield* decodeInput(getRepeatableItemInput, rawInput);
  const { project, scope, entity } = yield* accessTo(ctx, { item: id }, "public");
  const reader = contentReader(ctx, { projectId: project.id, draft: scope });
  const view = yield* reader.item(entity.item);
  if (!view) return yield* new NotFoundError();
  return view;
}, Effect.scoped);

// --- Writes ---
//
// Every write lands in the request's draft scope. In a draft, the first write to an item copies
// it whole, so moving an item carries its content along; a deletion writes a tombstone for the
// item only, and its nested items read as gone with it (ADR 0005).

/** Adds an item to a block as the request's draft reads it, in that draft. */
export const createRepeatableItem = Effect.fn("repeatableItems.createRepeatableItem")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof createRepeatableItemInput>,
) {
  const { id, blockId, parentItemId, fieldName, content, settings, afterPosition, nestedItems } =
    yield* decodeInput(createRepeatableItemInput, rawInput);
  const { scope, project, entity: access } = yield* accessTo(ctx, { block: blockId }, "write");

  const now = Date.now();

  const tree = yield* treeOfBlock(ctx.db, scope, access.block);
  const schema = yield* treeSchema(ctx.db, tree, scope);
  const rootPath = yield* resolveItemFieldNamePath(
    ctx.db,
    scope,
    tree.root,
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
    blockScope(access.block, scope),
    repeater?.items,
    contentWithItems,
  );

  // Get siblings to determine correct position
  const siblings = yield* siblingsOf(ctx.db, scope, tree, fieldName, parentItemId ?? null);
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

  const result = yield* overlay.insert(ctx.db, scope, repeatableItems, {
    id,
    ...rootColumns(tree.root),
    parentItemId: parentItemId ?? null,
    fieldName,
    content: sanitizedContent,
    settings: sanitizedSettings,
    position,
    createdAt: now,
    updatedAt: now,
  });
  if (!result) return yield* new ConflictError({ message: `Repeatable item ${id} already exists` });

  // Insert client-provided nested item seeds
  if (preparedSeeds.length > 0) {
    const tempIdToRealId = new Map<string, string>();

    for (const seed of preparedSeeds) {
      // null parentTempId means child of the item being created
      const seedParentId = seed.parentTempId
        ? (tempIdToRealId.get(seed.parentTempId) ?? result.id)
        : result.id;
      const inserted = yield* overlay.insert(ctx.db, scope, repeatableItems, {
        ...rootColumns(tree.root),
        parentItemId: seedParentId,
        fieldName: seed.fieldName,
        content: seed.content,
        settings: seed.settings,
        position: seed.position,
        createdAt: now,
        updatedAt: now,
      });
      tempIdToRealId.set(seed.tempId, inserted!.id);
    }
  }
  yield* requestSummary(ctx, scope, project.id, result.id, 0);

  return yield* shownItem(ctx, project.id, scope, result);
}, Effect.scoped);

export const updateRepeatableItemContent = Effect.fn("repeatableItems.updateRepeatableItemContent")(
  function* (ctx: ServiceContext, rawInput: z.input<typeof updateRepeatableItemContentInput>) {
    const { id, content } = yield* decodeInput(updateRepeatableItemContentInput, rawInput);
    const { scope, project, entity: access } = yield* accessTo(ctx, { item: id }, "write");

    // Resolve schema for the patch and sanitize asset leaks before merging.
    const tree = yield* treeOfRoot(ctx.db, scope, rootOfItem(access.item));
    const schema = yield* treeSchema(ctx.db, tree, scope);
    const itemPath = yield* resolveItemFieldNamePath(
      ctx.db,
      scope,
      tree.root,
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
    yield* validateReferenceValues(
      ctx,
      blockScope(tree.definition, scope),
      itemSchema,
      sanitizedPatch,
    );

    // Merge partial content into existing content (frontend sends single-field patches)
    const merged = {
      ...(access.item.content as Record<string, unknown>),
      ...sanitizedPatch,
    };
    const result = yield* overlay.update(ctx.db, scope, repeatableItems, id, {
      content: merged,
      updatedAt: Date.now(),
    });
    yield* requestSummary(ctx, scope, project.id, id, 5000);

    return result && (yield* shownItem(ctx, project.id, scope, result));
  },
  Effect.scoped,
);

export const updateRepeatableItemSettings = Effect.fn(
  "repeatableItems.updateRepeatableItemSettings",
)(function* (ctx: ServiceContext, rawInput: z.input<typeof updateRepeatableItemSettingsInput>) {
  const { id, settings } = yield* decodeInput(updateRepeatableItemSettingsInput, rawInput);
  const { scope, project, entity: access } = yield* accessTo(ctx, { item: id }, "write");

  const tree = yield* treeOfRoot(ctx.db, scope, rootOfItem(access.item));
  const schema = yield* treeSchema(ctx.db, tree, scope);
  const itemPath = yield* resolveItemFieldNamePath(
    ctx.db,
    scope,
    tree.root,
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
  const result = yield* overlay.update(ctx.db, scope, repeatableItems, id, {
    settings: merged,
    updatedAt: Date.now(),
  });

  return result && (yield* shownItem(ctx, project.id, scope, result));
}, Effect.scoped);

export const updateRepeatableItemPosition = Effect.fn(
  "repeatableItems.updateRepeatableItemPosition",
)(function* (ctx: ServiceContext, rawInput: z.input<typeof updateRepeatableItemPositionInput>) {
  const { id, afterPosition, beforePosition } = yield* decodeInput(
    updateRepeatableItemPositionInput,
    rawInput,
  );
  const { scope, project, entity: access } = yield* accessTo(ctx, { item: id }, "write");

  const item = access.item;
  const tree = yield* treeOfRoot(ctx.db, scope, rootOfItem(item));
  const siblings = (yield* siblingsOf(
    ctx.db,
    scope,
    tree,
    item.fieldName,
    item.parentItemId,
  )).filter((s) => s.id !== id);

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

  // In a draft, moving an item copies its content along with its position (ADR 0005).
  const result = yield* overlay.update(ctx.db, scope, repeatableItems, id, {
    position,
    updatedAt: Date.now(),
  });
  return result && (yield* shownItem(ctx, project.id, scope, result));
}, Effect.scoped);

export const duplicateRepeatableItem = Effect.fn("repeatableItems.duplicateRepeatableItem")(
  function* (ctx: ServiceContext, rawInput: z.input<typeof duplicateRepeatableItemInput>) {
    const { id } = yield* decodeInput(duplicateRepeatableItemInput, rawInput);
    const { scope, project, entity: access } = yield* accessTo(ctx, { item: id }, "write");
    const original = access.item;

    const tree = yield* treeOfRoot(ctx.db, scope, rootOfItem(original));
    const schema = yield* treeSchema(ctx.db, tree, scope);
    const itemPath = yield* resolveItemFieldNamePath(
      ctx.db,
      scope,
      tree.root,
      original.parentItemId,
      original.fieldName,
    );
    const repeater = yield* descendRepeaterSchema(schema, itemPath);
    const now = Date.now();

    // Find the next sibling to insert between original and next
    const siblings = yield* siblingsOf(
      ctx.db,
      scope,
      tree,
      original.fieldName,
      original.parentItemId,
    );
    yield* validateRepeaterCount(repeater, siblings.length + 1, itemPath.join("."));
    const originalIndex = siblings.findIndex((s) => s.id === id);
    const nextItem = originalIndex >= 0 ? siblings[originalIndex + 1] : undefined;
    const position = generateKeyBetween(original.position, nextItem?.position ?? null);

    const result = yield* overlay.insert(ctx.db, scope, repeatableItems, {
      ...rootColumns(tree.root),
      parentItemId: original.parentItemId,
      fieldName: original.fieldName,
      content: original.content,
      settings: original.settings,
      position,
      createdAt: now,
      updatedAt: now,
    });
    if (!result) return yield* new ConflictError({ message: "The duplicate's id is taken" });
    yield* copyValue(
      ctx.db,
      scope,
      homeOf(scope, project.id),
      itemSummaryKey(original.id),
      result.id,
    );
    return yield* shownItem(ctx, project.id, scope, result);
  },
  Effect.scoped,
);

export const generateRepeatableItemSummary = Effect.fn(
  "repeatableItems.generateRepeatableItemSummary",
)(function* (ctx: ServiceContext, rawInput: z.input<typeof generateRepeatableItemSummaryInput>) {
  const { id } = yield* decodeInput(generateRepeatableItemSummaryInput, rawInput);
  const { scope, project } = yield* accessTo(ctx, { item: id }, "member");

  const cascade = yield* executeRepeatableItemSummary(
    ctx.db,
    ctx.env.OPEN_ROUTER_API_KEY,
    id,
    scope,
  );
  if (cascade) {
    yield* requestBlockSummary(ctx, scope, cascade.projectId, cascade.blockId, 5000);
  }
  const stored = yield* overlay.get(ctx.db, scope, repeatableItems, id);
  return stored && (yield* shownItem(ctx, project.id, scope, stored));
}, Effect.scoped);

/**
 * Deletes an item in a draft: a tombstone, and its nested items read as gone with it until
 * publishing deletes them (ADR 0005).
 */
export const deleteRepeatableItem = Effect.fn("repeatableItems.deleteRepeatableItem")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof deleteRepeatableItemInput>,
) {
  const { id } = yield* decodeInput(deleteRepeatableItemInput, rawInput);
  const { scope, project, entity: access } = yield* accessTo(ctx, { item: id }, "write");

  const tree = yield* treeOfRoot(ctx.db, scope, rootOfItem(access.item));
  const schema = yield* treeSchema(ctx.db, tree, scope);
  const itemPath = yield* resolveItemFieldNamePath(
    ctx.db,
    scope,
    tree.root,
    access.item.parentItemId,
    access.item.fieldName,
  );
  const repeater = yield* descendRepeaterSchema(schema, itemPath);
  const siblings = yield* siblingsOf(
    ctx.db,
    scope,
    tree,
    access.item.fieldName,
    access.item.parentItemId,
  );
  yield* validateRepeaterCount(repeater, siblings.length - 1, itemPath.join("."));
  const result = yield* overlay.remove(ctx.db, scope, repeatableItems, id);
  return result && (yield* shownItem(ctx, project.id, scope, result));
}, Effect.scoped);
