"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { generatePageDraft } from "../src/lib/ai";
import { markdownToLexicalState, plainTextToLexicalState } from "../src/core/lib/lexicalState";

const DEFAULT_HERO_BLOCK = {
  type: "hero",
  content: {
    title: plainTextToLexicalState("A page title"),
    description: plainTextToLexicalState("An engaging block description"),
    cta: { type: "external", text: "Get started", href: "/", newTab: false },
  },
};

export const createPage = action({
  args: {
    projectId: v.id("projects"),
    pathSegment: v.string(),
    parentPageId: v.optional(v.id("pages")),
    layoutId: v.id("layouts"),
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
          (d) => !d.layoutOnly,
        );

        if (blockDefinitions.length > 0) {
          blocks = await generatePageDraft({
            contentDescription: args.contentDescription,
            blockDefinitions,
          });

          // Convert String field values from markdown to Lexical JSON
          const defsByType = new Map(
            blockDefinitions.map((d) => [d.blockId, d]),
          );
          for (const block of blocks) {
            const def = defsByType.get(block.type);
            const props = (def?.contentSchema as any)?.properties;
            if (!props) continue;
            for (const [key, schemaProp] of Object.entries(props)) {
              if (
                (schemaProp as any)?.fieldType === "String" &&
                typeof block.content[key] === "string"
              ) {
                block.content[key] = markdownToLexicalState(
                  block.content[key] as string,
                );
              }
            }
          }
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
      layoutId: args.layoutId,
      blocks,
    });
  },
});
