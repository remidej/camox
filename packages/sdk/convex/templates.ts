import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { generateKeyBetween } from "fractional-indexing";
import { splitContent } from "./lib/contentAssembly";

export const listTemplates = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("templates")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const syncTemplates = mutation({
  args: {
    projectId: v.id("projects"),
    templates: v.array(
      v.object({
        templateId: v.string(),
        blocks: v.array(
          v.object({
            type: v.string(),
            content: v.any(),
            settings: v.optional(v.any()),
            placement: v.optional(
              v.union(v.literal("before"), v.literal("after")),
            ),
          }),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    for (const tmpl of args.templates) {
      const existing = await ctx.db
        .query("templates")
        .withIndex("by_project_templateId", (q) =>
          q.eq("projectId", args.projectId).eq("templateId", tmpl.templateId),
        )
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, { updatedAt: now });
        continue;
      }

      // Create template record
      const templateDocId = await ctx.db.insert("templates", {
        projectId: args.projectId,
        templateId: tmpl.templateId,
        createdAt: now,
        updatedAt: now,
      });

      // Create default blocks for new template
      let prevPosition: string | null = null;
      for (const block of tmpl.blocks) {
        const position = generateKeyBetween(prevPosition, null);
        const { scalarContent, arrayFields: _arrayFields } = splitContent(
          block.content,
        );

        await ctx.db.insert("blocks", {
          templateId: templateDocId,
          type: block.type,
          content: scalarContent,
          settings: block.settings,
          placement: block.placement,
          summary: block.type,
          position,
          createdAt: now,
          updatedAt: now,
        });

        prevPosition = position;
      }
    }

    return { synced: args.templates.length };
  },
});
