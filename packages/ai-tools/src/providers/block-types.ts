import { z } from "zod";

import { listBlockDefinitions } from "../../../../apps/api/src/domains/block-definitions/service";
import { runService } from "../../../../apps/api/src/lib/run-service";
import { rewriteAssetSchema } from "../lib/rewrite-asset-schema";
import { defineTool, type ToolDefinition, type ToolProvider } from "../types";

const listBlockTypesToolInput = z.object({});

const describeBlockTypesToolInput = z.object({
  types: z.array(z.string()).min(1),
});

const blockDefinitionSummarySchema = z.strictObject({
  type: z.string(),
  title: z.string(),
  description: z.string(),
  layoutOnly: z.boolean(),
  synced: z.boolean(),
});

export const blockTypesProvider: ToolProvider = (ctx): ToolDefinition[] => [
  defineTool({
    name: "listBlockTypes",
    description:
      "List the block types available in the current project. Returns a lightweight summary " +
      "(`type`, `title`, `description`, `layoutOnly`, `synced`) for discovery — call `describeBlockTypes` " +
      "to fetch the JSON Schemas needed to construct arguments for createBlock / editBlock. " +
      "Block types whose `layoutOnly` is true can only appear inside layouts and are not valid for createBlock on a page. " +
      "Editing a `synced` block changes its data across all its placements in the draft.",
    inputSchema: listBlockTypesToolInput,
    outputSchema: z.array(blockDefinitionSummarySchema),
    meta: { kind: "read", surfaces: ["cli", "studio-agent"] },
    handler: async () => {
      const defs = await runService(listBlockDefinitions(ctx, { projectId: ctx.projectId }));
      return defs.map((d) => ({
        type: d.blockId,
        title: d.title,
        description: d.description,
        layoutOnly: d.layoutOnly ?? false,
        synced: d.synced,
      }));
    },
  }),
  defineTool({
    name: "describeBlockTypes",
    description:
      "Get the full definition for one or more block types — including `contentSchema` and " +
      "`settingsSchema` — by passing their `type` ids (as returned by `listBlockTypes`). Use " +
      "this right before calling createBlock or editBlock to know what `content` and `settings` " +
      "arguments to construct. Unknown ids are reported in `notFound`.",
    inputSchema: describeBlockTypesToolInput,
    outputSchema: z.strictObject({
      blockTypes: z.array(
        blockDefinitionSummarySchema.extend({
          contentSchema: z.unknown(),
          settingsSchema: z.unknown(),
        }),
      ),
      notFound: z.array(z.string()),
    }),
    meta: { kind: "read", surfaces: ["cli", "studio-agent"] },
    handler: async (input) => {
      const { types } = describeBlockTypesToolInput.parse(input);
      const defs = await runService(listBlockDefinitions(ctx, { projectId: ctx.projectId }));
      const requested = new Set(types);
      const found = defs
        .filter((d) => requested.has(d.blockId))
        .map((d) => ({
          type: d.blockId,
          title: d.title,
          description: d.description,
          contentSchema: rewriteAssetSchema(d.contentSchema),
          settingsSchema: rewriteAssetSchema(d.settingsSchema),
          layoutOnly: d.layoutOnly ?? false,
          synced: d.synced,
        }));
      const foundIds = new Set(found.map((d) => d.type));
      const notFound = types.filter((t) => !foundIds.has(t));
      return { blockTypes: found, notFound };
    },
  }),
];
