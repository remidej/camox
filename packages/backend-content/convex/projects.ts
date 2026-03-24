import { v } from "convex/values";

import { query } from "./_generated/server";
import { mutation } from "./functions";

export const createProject = mutation({
  args: {
    name: v.string(),
    slug: v.string(),
    domain: v.string(),
    organizationSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (existing) {
      throw new Error(`A project with slug "${args.slug}" already exists`);
    }

    const now = Date.now();

    const projectId = await ctx.db.insert("projects", {
      name: args.name,
      slug: args.slug,
      domain: args.domain,
      organizationSlug: args.organizationSlug,
      createdAt: now,
      updatedAt: now,
    });

    return { projectId };
  },
});

export const getProject = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    return project;
  },
});

export const getFirstProject = query({
  args: {},
  handler: async (ctx) => {
    const project = await ctx.db.query("projects").first();
    return project;
  },
});

export const getProjectBySlug = query({
  args: {
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
  },
});

export const listProjects = query({
  args: {},
  handler: async (ctx) => {
    const projects = await ctx.db.query("projects").collect();
    return projects.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const deleteProject = mutation({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    // Get all pages for this project
    const pages = await ctx.db
      .query("pages")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    // Delete all blocks and repeatableItems for each page
    for (const page of pages) {
      const blocks = await ctx.db
        .query("blocks")
        .withIndex("by_page", (q) => q.eq("pageId", page._id))
        .collect();

      for (const block of blocks) {
        const repeatableItems = await ctx.db
          .query("repeatableItems")
          .withIndex("by_block", (q) => q.eq("blockId", block._id))
          .collect();

        for (const item of repeatableItems) {
          await ctx.db.delete(item._id);
        }

        await ctx.db.delete(block._id);
      }

      await ctx.db.delete(page._id);
    }

    // Delete the project
    await ctx.db.delete(args.projectId);
  },
});
