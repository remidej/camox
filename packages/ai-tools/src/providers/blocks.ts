import { Effect } from "effect";
import { z } from "zod";

import { pageSourceSchema } from "../../../../apps/api/src/domains/_shared/page-source";
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
import type { ToolDefinition, ToolProvider } from "../types";

const positionAliasSchema = z.enum(["first", "last"]).optional();

const REFERENCE_VALUES =
  "Reference fields store one collection record id (or null). Reference list fields store an ordered array of distinct record ids from the field's collection, at most its maxItems; the array replaces the whole list. Find ids with listCollectionRecords.";

const createBlockToolInput = createBlockInput.omit({ repeatableItems: true }).extend({
  afterId: z.number().optional(),
  beforeId: z.number().optional(),
  position: positionAliasSchema,
});

const moveBlockToolInput = updateBlockPositionInput.extend({
  afterId: z.number().optional(),
  beforeId: z.number().optional(),
  position: positionAliasSchema,
});

const editBlockToolInput = z.object({
  id: z.number(),
  content: z.unknown().optional(),
  settings: z.unknown().optional(),
});

// Tool-layer schema for getBlock: source defaults to "draft" (agent / CLI edit
// the working copy). The service's `getBlockInput` defaults to "live" because
// it backs the public SDK loader too — we override here explicitly.
const getBlockToolInput = z.object({
  id: z.number(),
  source: pageSourceSchema.optional(),
});

const getBlocksToolInput = z.object({
  ids: z.array(z.number()).min(1),
  source: pageSourceSchema.optional(),
});

export const blocksProvider: ToolProvider = (ctx): ToolDefinition[] => [
  {
    name: "getBlock",
    description:
      "Fetch a single block by id. Returns the block (with `_itemId` markers injected for each repeatable field), the full list of `repeatableItems` (each with its own `id`), and any referenced `files`. " +
      "Use this before editing a single field inside a repeatable item — pass each item's `id` back as `_itemId` on the `editBlock` items array. Any existing item not referenced by `_itemId` in the patch is deleted, so the round-trip is the only safe way to update one item without losing the others (and their file references, settings, and positions). " +
      "Defaults to reading the draft; pass `source: 'live'` to read the published snapshot.",
    inputSchema: getBlockToolInput,
    meta: { kind: "read", risk: "safe", surfaces: ["cli"] },
    handler: async (input) => {
      const parsed = getBlockToolInput.parse(input);
      return runService(getBlock(ctx, { id: parsed.id, source: parsed.source ?? "draft" }));
    },
  },
  {
    name: "getBlocks",
    description:
      "Fetch multiple blocks by id in one call. Returns an array of getBlock bundle results in the same order as the requested ids. " +
      "Use this before editing repeatable fields across several blocks so each block's `_itemId` markers can be preserved. " +
      "Defaults to reading the draft; pass `source: 'live'` to read the published snapshot.",
    inputSchema: getBlocksToolInput,
    meta: { kind: "read", risk: "safe", surfaces: ["cli"] },
    handler: async (input) => {
      const parsed = getBlocksToolInput.parse(input);
      const source = parsed.source ?? "draft";
      return runService(
        Effect.forEach(parsed.ids, (id) => getBlock(ctx, { id, source }), {
          concurrency: "unbounded",
        }),
      );
    },
  },
  {
    name: "createBlock",
    description:
      "Create a block on a page. `type` must be one of the block-definition ids returned by listBlockTypes. " +
      "`content` and `settings` are validated server-side against that block type's JSON Schema; on a validation failure you'll receive a structured error to retry from. " +
      REFERENCE_VALUES +
      " " +
      "Positioning (pass at most one): `position: 'first' | 'last'`, `afterId: <block id>`, `beforeId: <block id>`, or the lower-level `afterPosition` / `beforePosition` (fractional-index strings). Omit all to append at the end.",
    inputSchema: createBlockToolInput,
    meta: { kind: "write", risk: "safe", surfaces: ["cli"] },
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
  },
  {
    name: "editBlock",
    description:
      "Update a block's `content` and/or `settings`. Provide at least one. Both are merged into the existing values, so partial patches are fine. " +
      "Submitted fields are validated against the owning environment's JSON Schemas before writes; errors include field paths. " +
      "Repeater arrays replace the field and must satisfy its minItems/maxItems; preserve existing items with _itemId. " +
      REFERENCE_VALUES,
    inputSchema: editBlockToolInput,
    meta: { kind: "write", risk: "safe", surfaces: ["cli"] },
    handler: async (input) => runService(editBlock(ctx, editBlockToolInput.parse(input))),
  },
  {
    name: "moveBlock",
    description:
      "Move a block to a new position on its page. Positioning (pass exactly one): `position: 'first' | 'last'`, `afterId: <block id>`, `beforeId: <block id>`, or the lower-level `afterPosition` / `beforePosition` (fractional-index strings).",
    inputSchema: moveBlockToolInput,
    meta: { kind: "write", risk: "safe", surfaces: ["cli"] },
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
  },
  {
    name: "deleteBlock",
    description: "Delete a block by id.",
    inputSchema: deleteBlockInput,
    meta: { kind: "write", risk: "safe", surfaces: ["cli"] },
    handler: async (input) => runService(deleteBlock(ctx, deleteBlockInput.parse(input))),
  },
];
