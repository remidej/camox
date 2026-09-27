import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  getLayout,
  getLayoutInput,
  listLayouts,
} from "../../../../apps/api/src/domains/layouts/service";
import { resolveEnvironment } from "../../../../apps/api/src/lib/resolve-environment";
import { layouts, projects } from "../../../../apps/api/src/schema";
import type { ToolDefinition, ToolProvider } from "../types";

const listLayoutsToolInput = z.object({});
const getLayoutToolInput = z.object({
  id: z.number().int().positive(),
  source: getLayoutInput.shape.source.default("draft"),
});

export const layoutsProvider: ToolProvider = (ctx): ToolDefinition[] => [
  {
    name: "listLayouts",
    description:
      "List the layouts available in the current project. Layout ids are required when creating pages. " +
      "Call getLayout with a layout's numeric id to discover its block instance ids, types, placement, and content.",
    inputSchema: listLayoutsToolInput,
    meta: { kind: "read", risk: "safe", surfaces: ["cli"] },
    handler: () => listLayouts(ctx, { projectId: ctx.projectId }),
  },
  {
    name: "getLayout",
    description:
      "Fetch a layout by numeric id in the current project and environment. Returns layout metadata, " +
      "ordered blocks with instance ids, types, placement, and content, repeatableItems, and files. " +
      "Use this to discover shared navigation and footer blocks. Defaults to draft; pass source: 'live' " +
      "for the published snapshot. An unpublished live layout returns metadata with empty block, item, and file arrays.",
    inputSchema: getLayoutToolInput,
    meta: { kind: "read", risk: "safe", surfaces: ["cli"] },
    handler: async (input) => {
      const { id, source } = getLayoutToolInput.parse(input);
      const environment = await resolveEnvironment(ctx.db, ctx.projectId, ctx.environmentName);
      // Translate the tool's scoped row id to the SDK service's code identifier.
      const target = await ctx.db
        .select({ projectSlug: projects.slug, layoutId: layouts.layoutId })
        .from(layouts)
        .innerJoin(projects, eq(layouts.projectId, projects.id))
        .where(
          and(
            eq(layouts.id, id),
            eq(layouts.projectId, ctx.projectId),
            eq(layouts.environmentId, environment.id),
          ),
        )
        .get();
      if (!target) throw new ORPCError("NOT_FOUND");
      return getLayout(ctx, { ...target, source });
    },
  },
];
