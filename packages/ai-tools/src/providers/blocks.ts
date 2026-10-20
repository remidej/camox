import { uuidv7Schema } from "@camox/api-contract/ids";
import { Effect } from "effect";
import { z } from "zod";

import {
  createBlock,
  createBlockInput,
  deleteBlock,
  deleteBlockInput,
  editBlock,
  getBlock,
  resolveBlockPosition,
  updateBlockPosition,
  updateBlockPositionInput,
} from "../../../../apps/api/src/domains/blocks/service";
import { runService } from "../../../../apps/api/src/lib/run-service";
import { blockBundleSchema, blockSchema, blockWithWarningsSchema } from "../lib/outputs";
import { defineTool, type ToolDefinition, type ToolProvider } from "../types";

const positionAliasSchema = z.enum(["first", "last"]).optional();

const REFERENCE_VALUES =
  "Reference fields store one collection record id (or null). Reference list fields store an ordered array of distinct record ids from the field's collection, at most its maxItems; the array replaces the whole list. Reference lists with a query are resolved from code and store nothing: never write them. Repeatable items hold reference fields the same way. Find ids with listCollectionRecords.";

const createBlockToolInput = createBlockInput.omit({ repeatableItems: true }).extend({
  afterId: uuidv7Schema.optional(),
  beforeId: uuidv7Schema.optional(),
  position: positionAliasSchema,
});

const moveBlockToolInput = updateBlockPositionInput.extend({
  afterId: uuidv7Schema.optional(),
  beforeId: uuidv7Schema.optional(),
  position: positionAliasSchema,
});

const editBlockToolInput = z.object({
  id: uuidv7Schema,
  content: z.unknown().optional(),
  settings: z.unknown().optional(),
});

const getBlockToolInput = z.object({ id: uuidv7Schema });

const getBlocksToolInput = z.object({ ids: z.array(uuidv7Schema).min(1) });

export const blocksProvider: ToolProvider = (ctx): ToolDefinition[] => [
  defineTool({
    name: "getBlock",
    description:
      "Fetch a single block by id. Returns the block (with `_itemId` markers injected for each repeatable field), the full list of `repeatableItems` (each with its own `id`), and any referenced `files`. " +
      "Use this before editing a single field inside a repeatable item — pass each item's `id` back as `_itemId` on the `editBlock` items array. Any existing item not referenced by `_itemId` in the patch is deleted, so the round-trip is the only safe way to update one item without losing the others (and their file references, settings, and positions).",
    inputSchema: getBlockToolInput,
    outputSchema: blockBundleSchema,
    meta: { kind: "read", surfaces: ["cli", "studio-agent"], localized: true },
    handler: async (input) => {
      const parsed = getBlockToolInput.parse(input);
      return runService(getBlock(ctx, { id: parsed.id }));
    },
  }),
  defineTool({
    name: "getBlocks",
    description:
      "Fetch multiple blocks by id in one call. Returns an array of getBlock bundle results in the same order as the requested ids. " +
      "Use this before editing repeatable fields across several blocks so each block's `_itemId` markers can be preserved.",
    inputSchema: getBlocksToolInput,
    outputSchema: z.array(blockBundleSchema),
    meta: { kind: "read", surfaces: ["cli", "studio-agent"], localized: true },
    handler: async (input) => {
      const parsed = getBlocksToolInput.parse(input);
      return runService(
        Effect.forEach(parsed.ids, (id) => getBlock(ctx, { id }), {
          concurrency: "unbounded",
        }),
      );
    },
  }),
  defineTool({
    name: "createBlock",
    description:
      "Create a block on a page. `type` must be one of the block-definition ids returned by listBlockTypes. " +
      "`content` and `settings` are validated server-side against that block type's JSON Schema; on a validation failure you'll receive a structured error to retry from. " +
      REFERENCE_VALUES +
      " " +
      "Positioning (pass at most one): `position: 'first' | 'last'`, `afterId: <block id>`, `beforeId: <block id>`, or the lower-level `afterPosition` / `beforePosition` (fractional-index strings). Omit all to append at the end.",
    inputSchema: createBlockToolInput,
    outputSchema: blockWithWarningsSchema,
    meta: { kind: "write", surfaces: ["cli", "studio-agent"], localized: true },
    handler: async (input) => {
      const parsed = createBlockToolInput.parse(input);
      return runService(
        Effect.gen(function* () {
          const resolved = yield* resolveBlockPosition(
            ctx,
            {
              pageId: parsed.pageId,
              afterPosition: parsed.afterPosition,
              beforePosition: parsed.beforePosition,
              afterId: parsed.afterId,
              beforeId: parsed.beforeId,
              position: parsed.position,
            },
            { mode: "create" },
          );
          return yield* createBlock(ctx, {
            id: parsed.id,
            pageId: parsed.pageId,
            type: parsed.type,
            content: parsed.content,
            settings: parsed.settings,
            afterPosition: resolved.afterPosition,
            beforePosition: resolved.beforePosition,
          });
        }),
      );
    },
  }),
  defineTool({
    name: "editBlock",
    description:
      "Update a block's `content` and/or `settings`. Provide at least one. Both are merged into the existing values, so partial patches are fine. " +
      "Submitted fields are validated against the draft's block definitions' JSON Schemas before writes; errors include field paths. " +
      "Repeater arrays replace the field and must satisfy its minItems/maxItems; preserve existing items with _itemId. " +
      REFERENCE_VALUES,
    inputSchema: editBlockToolInput,
    outputSchema: blockWithWarningsSchema,
    meta: { kind: "write", surfaces: ["cli", "studio-agent"], localized: true },
    handler: async (input) => {
      const parsed = editBlockToolInput.parse(input);
      return runService(editBlock(ctx, parsed));
    },
  }),
  defineTool({
    name: "moveBlock",
    description:
      "Move a block to a new position on its page. Positioning (pass exactly one): `position: 'first' | 'last'`, `afterId: <block id>`, `beforeId: <block id>`, or the lower-level `afterPosition` / `beforePosition` (fractional-index strings).",
    inputSchema: moveBlockToolInput,
    outputSchema: blockSchema,
    meta: { kind: "write", surfaces: ["cli", "studio-agent"], localized: true },
    handler: async (input) => {
      const parsed = moveBlockToolInput.parse(input);
      return runService(
        Effect.gen(function* () {
          const resolved = yield* resolveBlockPosition(
            ctx,
            {
              blockId: parsed.id,
              afterPosition: parsed.afterPosition,
              beforePosition: parsed.beforePosition,
              afterId: parsed.afterId,
              beforeId: parsed.beforeId,
              position: parsed.position,
            },
            { mode: "move" },
          );
          return yield* updateBlockPosition(ctx, {
            id: parsed.id,
            afterPosition: resolved.afterPosition,
            beforePosition: resolved.beforePosition,
          });
        }),
      );
    },
  }),
  defineTool({
    name: "deleteBlock",
    description: "Delete a block by id.",
    inputSchema: deleteBlockInput,
    outputSchema: blockSchema.optional(),
    meta: { kind: "write", surfaces: ["cli", "studio-agent"], localized: true },
    handler: async (input) => {
      const parsed = deleteBlockInput.parse(input);
      return runService(deleteBlock(ctx, parsed));
    },
  }),
];
