import { v } from "convex/values";

import { internal } from "./_generated/api";
import { mutation, query } from "./functions";

export const createProject = mutation({
  args: {
    slug: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
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
      slug: args.slug,
      name: args.name,
      description: args.description,
      domain: args.domain,
      organizationSlug: args.organizationSlug,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.syncToContent.syncProjectToContent, {
      slug: args.slug,
      name: args.name,
      domain: args.domain,
      organizationSlug: args.organizationSlug,
      managementProjectId: projectId,
    });

    return { projectId };
  },
});

export const listProjects = query({
  args: {
    organizationSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_organization", (q) => q.eq("organizationSlug", args.organizationSlug))
      .collect();
    return projects.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const getProject = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.projectId);
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

export const updateProject = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    description: v.optional(v.string()),
    domain: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.projectId);
    if (!existing) {
      throw new Error("Project not found");
    }

    await ctx.db.patch(args.projectId, {
      name: args.name,
      description: args.description,
      domain: args.domain,
      updatedAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.syncToContent.syncProjectToContent, {
      slug: existing.slug,
      name: args.name,
      domain: args.domain,
      organizationSlug: existing.organizationSlug,
      managementProjectId: args.projectId,
    });

    return { projectId: args.projectId };
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

    await ctx.db.delete(args.projectId);

    await ctx.scheduler.runAfter(0, internal.syncToContent.deleteProjectFromContent, {
      slug: project.slug,
    });
  },
});
