"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { generatePageDraft } from "../src/lib/ai";

const DEFAULT_HERO_BLOCK = {
  type: "hero",
  content: {
    title: "A page title",
    description: "An engaging block description",
    primaryButtonText: "Get started",
  },
};

export const createPage = action({
  args: {
    projectId: v.id("projects"),
    nickname: v.string(),
    pathSegment: v.string(),
    parentPageId: v.optional(v.id("pages")),
    contentDescription: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ pageId: string; fullPath: string }> => {
    let blocks: Array<{
      type: string;
      content: Record<string, unknown>;
      settings?: Record<string, unknown>;
    }> = [
      DEFAULT_HERO_BLOCK,
    ];

    // If contentDescription provided, generate blocks with AI
    if (args.contentDescription) {
      try {
        const blockDefinitions = await ctx.runQuery(
          internal.blockDefinitions.getBlockDefinitionsInternal,
          { projectId: args.projectId },
        );

        if (blockDefinitions.length > 0) {
          blocks = await generatePageDraft({
            contentDescription: args.contentDescription,
            blockDefinitions,
          });
        }
      } catch (error) {
        console.error("AI generation failed, using default block:", error);
        // Fall back to default hero block
        blocks = [DEFAULT_HERO_BLOCK];
      }
    }

    // Create the page and blocks via internal mutation
    return ctx.runMutation(internal.pages.createPageInternal, {
      projectId: args.projectId,
      nickname: args.nickname,
      pathSegment: args.pathSegment,
      parentPageId: args.parentPageId,
      blocks,
    });
  },
});
