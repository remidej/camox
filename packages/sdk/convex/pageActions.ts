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
    cta: { type: "external", text: "Get started", href: "/", newTab: false },
  },
};

export const createPage = action({
  args: {
    projectId: v.id("projects"),
    pathSegment: v.string(),
    parentPageId: v.optional(v.id("pages")),
    templateId: v.optional(v.id("templates")),
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
        const allBlockDefinitions = await ctx.runQuery(
          internal.blockDefinitions.getBlockDefinitionsInternal,
          { projectId: args.projectId },
        );
        const blockDefinitions = allBlockDefinitions.filter(
          (d) => !d.templateOnly,
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
      pathSegment: args.pathSegment,
      parentPageId: args.parentPageId,
      templateId: args.templateId,
      blocks,
    });
  },
});
