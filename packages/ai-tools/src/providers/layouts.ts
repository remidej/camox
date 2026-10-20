import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import { getLayout, listLayouts } from "../../../../apps/api/src/domains/layouts/service";
import { NotFoundError } from "../../../../apps/api/src/lib/errors";
import { runService } from "../../../../apps/api/src/lib/run-service";
import { projects } from "../../../../apps/api/src/schema";
import { layoutBundleSchema, layoutSchema } from "../lib/outputs";
import { defineTool, type ToolDefinition, type ToolProvider } from "../types";

const listLayoutsToolInput = z.object({});
const getLayoutToolInput = z.object({
  layoutId: z.string().min(1).describe("The layout's name, as listed by listLayouts."),
});

export const layoutsProvider: ToolProvider = (ctx): ToolDefinition[] => [
  defineTool({
    name: "listLayouts",
    description:
      "List the layouts available in the current project. A layout is identified by its name " +
      "(`layoutId`), which creating a page or setting its layout takes. " +
      "Call getLayout with a layout's name to discover its block ids, types, layout slot, and content.",
    inputSchema: listLayoutsToolInput,
    outputSchema: z.array(layoutSchema),
    meta: { kind: "read", surfaces: ["cli", "studio-agent"] },
    handler: async () => runService(listLayouts(ctx, { projectId: ctx.projectId })),
  }),
  defineTool({
    name: "getLayout",
    description:
      "Fetch a layout by name in the current project, as the draft sees it. Returns layout metadata, " +
      "ordered blocks with ids, types, layout slot, and content, repeatableItems, and files. " +
      "Use this to discover shared navigation and footer blocks.",
    inputSchema: getLayoutToolInput,
    outputSchema: layoutBundleSchema,
    meta: { kind: "read", surfaces: ["cli", "studio-agent"], localized: true },
    handler: async (input) => {
      const { layoutId } = getLayoutToolInput.parse(input);
      return runService(
        Effect.gen(function* () {
          const project = yield* Effect.promise(() =>
            ctx.db
              .select({ slug: projects.slug })
              .from(projects)
              .where(eq(projects.id, ctx.projectId))
              .get(),
          );
          if (!project) return yield* new NotFoundError();
          return yield* getLayout(ctx, { projectSlug: project.slug, layoutId });
        }),
      );
    },
  }),
];
