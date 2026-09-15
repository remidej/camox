import { z } from "zod";

import { listBlockDefinitions } from "../../../../apps/api/src/domains/block-definitions/service";
import { rewriteAssetSchema } from "../lib/rewrite-asset-schema";
import type { ToolDefinition, ToolProvider } from "../types";

const listBlockTypesToolInput = z.object({});

const describeBlockTypesToolInput = z.object({
  types: z.array(z.string()).min(1),
});

export const blockTypesProvider: ToolProvider = (ctx): ToolDefinition[] => [
  {
    name: "listBlockTypes",
    description:
      "List the block types available in the current project. Returns a lightweight summary " +
      "(`type`, `title`, `description`, `layoutOnly`, `synced`) for discovery — call `describeBlockTypes` " +
      "to fetch the JSON Schemas needed to construct arguments for createBlock / editBlock. " +
      "Block types whose `layoutOnly` is true can only appear inside layouts and are not valid for createBlock on a page. " +
      "Editing a `synced` block changes its data across all instances in this environment.",
    inputSchema: listBlockTypesToolInput,
    meta: { kind: "read", risk: "safe", surfaces: ["cli"] },
    handler: async () => {
      const defs = await listBlockDefinitions(ctx, { projectId: ctx.projectId });
      return defs.map((d) => ({
        type: d.blockId,
        title: d.title,
        description: d.description,
        layoutOnly: d.layoutOnly ?? false,
        synced: d.synced,
      }));
    },
  },
  {
    name: "describeBlockTypes",
    description:
      "Get the full definition for one or more block types — including `contentSchema` and " +
      "`settingsSchema` — by passing their `type` ids (as returned by `listBlockTypes`). Use " +
      "this right before calling createBlock or editBlock to know what `content` and `settings` " +
      "arguments to construct. Unknown ids are reported in `notFound`.",
    inputSchema: describeBlockTypesToolInput,
    meta: { kind: "read", risk: "safe", surfaces: ["cli"] },
    handler: async (input) => {
      const { types } = describeBlockTypesToolInput.parse(input);
      const defs = await listBlockDefinitions(ctx, { projectId: ctx.projectId });
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
  },
];
