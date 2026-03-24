import { v } from "convex/values";

/* eslint-disable no-restricted-imports */
import { mutation as rawMutation } from "./_generated/server";

function verifySyncSecret(syncSecret: string) {
  const expected = process.env.SYNC_SECRET;
  if (!expected || syncSecret !== expected) {
    throw new Error("Unauthorized: invalid sync secret");
  }
}

export const upsertProject = rawMutation({
  args: {
    syncSecret: v.string(),
    slug: v.string(),
    name: v.string(),
    domain: v.string(),
    organizationSlug: v.string(),
  },
  handler: async (ctx, args) => {
    verifySyncSecret(args.syncSecret);

    const existing = await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        domain: args.domain,
        organizationSlug: args.organizationSlug,
        updatedAt: Date.now(),
      });
      return { contentProjectId: existing._id };
    }

    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      slug: args.slug,
      name: args.name,
      domain: args.domain,
      organizationSlug: args.organizationSlug,
      createdAt: now,
      updatedAt: now,
    });

    return { contentProjectId: projectId };
  },
});

export const deleteProjectBySlug = rawMutation({
  args: {
    syncSecret: v.string(),
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    verifySyncSecret(args.syncSecret);

    const project = await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (!project) return;

    // Cascade delete layouts and their blocks
    const layouts = await ctx.db
      .query("layouts")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect();

    for (const layout of layouts) {
      const layoutBlocks = await ctx.db
        .query("blocks")
        .withIndex("by_layout", (q) => q.eq("layoutId", layout._id))
        .collect();

      for (const block of layoutBlocks) {
        const items = await ctx.db
          .query("repeatableItems")
          .withIndex("by_block", (q) => q.eq("blockId", block._id))
          .collect();
        for (const item of items) {
          await ctx.db.delete(item._id);
        }
        await ctx.db.delete(block._id);
      }

      await ctx.db.delete(layout._id);
    }

    // Cascade delete pages and their blocks
    const pages = await ctx.db
      .query("pages")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect();

    for (const page of pages) {
      const blocks = await ctx.db
        .query("blocks")
        .withIndex("by_page", (q) => q.eq("pageId", page._id))
        .collect();

      for (const block of blocks) {
        const items = await ctx.db
          .query("repeatableItems")
          .withIndex("by_block", (q) => q.eq("blockId", block._id))
          .collect();
        for (const item of items) {
          await ctx.db.delete(item._id);
        }
        await ctx.db.delete(block._id);
      }

      await ctx.db.delete(page._id);
    }

    // Delete block definitions
    const blockDefinitions = await ctx.db
      .query("blockDefinitions")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect();
    for (const def of blockDefinitions) {
      await ctx.db.delete(def._id);
    }

    await ctx.db.delete(project._id);
  },
});
