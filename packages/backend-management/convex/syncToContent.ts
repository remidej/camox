import { api as contentApi } from "@camox/backend-content/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./functions";

function getContentClient() {
  const url = process.env.CONTENT_CONVEX_URL;
  if (!url) throw new Error("CONTENT_CONVEX_URL env var not set");
  return new ConvexHttpClient(url);
}

function getSyncSecret() {
  const secret = process.env.SYNC_SECRET;
  if (!secret) throw new Error("SYNC_SECRET env var not set");
  return secret;
}

export const syncProjectToContent = internalAction({
  args: {
    slug: v.string(),
    name: v.string(),
    domain: v.string(),
    organizationSlug: v.string(),
    managementProjectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const client = getContentClient();
    const { contentProjectId } = await client.mutation(contentApi.syncProjects.upsertProject, {
      syncSecret: getSyncSecret(),
      slug: args.slug,
      name: args.name,
      domain: args.domain,
      organizationSlug: args.organizationSlug,
    });

    await ctx.runMutation(internal.syncToContent.storeContentProjectId, {
      managementProjectId: args.managementProjectId,
      contentProjectId,
    });
  },
});

export const deleteProjectFromContent = internalAction({
  args: {
    slug: v.string(),
  },
  handler: async (_ctx, args) => {
    const client = getContentClient();
    await client.mutation(contentApi.syncProjects.deleteProjectBySlug, {
      syncSecret: getSyncSecret(),
      slug: args.slug,
    });
  },
});

export const storeContentProjectId = internalMutation({
  args: {
    managementProjectId: v.id("projects"),
    contentProjectId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.managementProjectId, {
      contentProjectId: args.contentProjectId,
    });
  },
});
