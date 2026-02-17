import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";

export const getBlockDefinitionByTypeInternal = internalQuery({
  args: {
    projectId: v.id("projects"),
    blockType: v.string(),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("blockDefinitions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .filter((q) => q.eq(q.field("blockId"), args.blockType))
      .first();
  },
});

export const syncBlockDefinitions = mutation({
  args: {
    projectId: v.id("projects"),
    definitions: v.array(
      v.object({
        blockId: v.string(),
        title: v.string(),
        description: v.string(),
        contentSchema: v.any(),
        settingsSchema: v.optional(v.any()),
        code: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const incomingBlockIds = new Set(args.definitions.map((d) => d.blockId));

    // Get existing definitions for this project
    const existingDefs = await ctx.db
      .query("blockDefinitions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    const existingByBlockId = new Map(
      existingDefs.map((d) => [d.blockId, d])
    );

    // Upsert each incoming definition
    for (const def of args.definitions) {
      const existing = existingByBlockId.get(def.blockId);

      if (existing) {
        await ctx.db.patch(existing._id, {
          title: def.title,
          description: def.description,
          contentSchema: def.contentSchema,
          settingsSchema: def.settingsSchema,
          code: def.code,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("blockDefinitions", {
          projectId: args.projectId,
          blockId: def.blockId,
          title: def.title,
          description: def.description,
          contentSchema: def.contentSchema,
          settingsSchema: def.settingsSchema,
          code: def.code,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // Delete orphaned definitions (blocks no longer in codebase)
    for (const existing of existingDefs) {
      if (!incomingBlockIds.has(existing.blockId)) {
        await ctx.db.delete(existing._id);
      }
    }

    return { synced: args.definitions.length };
  },
});

export const upsertBlockDefinition = mutation({
  args: {
    projectId: v.id("projects"),
    blockId: v.string(),
    title: v.string(),
    description: v.string(),
    contentSchema: v.any(),
    settingsSchema: v.optional(v.any()),
    code: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const existing = await ctx.db
      .query("blockDefinitions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .filter((q) => q.eq(q.field("blockId"), args.blockId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        title: args.title,
        description: args.description,
        contentSchema: args.contentSchema,
        settingsSchema: args.settingsSchema,
        code: args.code,
        updatedAt: now,
      });
      return { action: "updated" as const, blockId: args.blockId };
    }

    await ctx.db.insert("blockDefinitions", {
      projectId: args.projectId,
      blockId: args.blockId,
      title: args.title,
      description: args.description,
      contentSchema: args.contentSchema,
      settingsSchema: args.settingsSchema,
      code: args.code,
      createdAt: now,
      updatedAt: now,
    });
    return { action: "created" as const, blockId: args.blockId };
  },
});

export const deleteBlockDefinition = mutation({
  args: {
    projectId: v.id("projects"),
    blockId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("blockDefinitions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .filter((q) => q.eq(q.field("blockId"), args.blockId))
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
      return { deleted: true, blockId: args.blockId };
    }

    return { deleted: false, blockId: args.blockId };
  },
});

export const getBlockDefinitions = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("blockDefinitions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const getBlockDefinitionsInternal = internalQuery({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("blockDefinitions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});
