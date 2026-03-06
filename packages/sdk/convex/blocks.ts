import { v } from "convex/values";
import { generateKeyBetween } from "fractional-indexing";
import {
  query,
  mutation,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { api, internal } from "./_generated/api";
import {
  generateObjectSummary,
  generatePageSeo as generatePageSeoAI,
} from "../src/lib/ai";
import {
  sortByPosition,
  splitContent,
  assembleBlockContent,
} from "./lib/contentAssembly";
import { contentToMarkdown } from "./lib/contentMarkdown";
import { scheduleAiJob, clearAiJob } from "./lib/aiJobs";

async function getProjectIdForBlock(
  ctx: QueryCtx,
  block: Doc<"blocks">,
): Promise<Id<"projects"> | null> {
  if (block.pageId) {
    const page = await ctx.db.get(block.pageId);
    return page?.projectId ?? null;
  }
  if (block.layoutId) {
    const layout = await ctx.db.get(block.layoutId);
    return layout?.projectId ?? null;
  }
  return null;
}

async function getBlockDefinition(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  blockType: string,
) {
  return ctx.db
    .query("blockDefinitions")
    .withIndex("by_project_blockId", (q) =>
      q.eq("projectId", projectId).eq("blockId", blockType),
    )
    .first();
}

const SUMMARIZATION_DEBOUNCE_DELAY_MS = 5000;
const PAGE_SEO_DELAY_MS = 15000;

export const createBlock = mutation({
  args: {
    pageId: v.id("pages"),
    type: v.string(),
    content: v.any(),
    settings: v.optional(v.any()),
    afterPosition: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Get all blocks for this page to determine position
    const blocks = await ctx.db
      .query("blocks")
      .withIndex("by_page", (q) => q.eq("pageId", args.pageId))
      .collect();

    const sortedBlocks = sortByPosition(blocks);

    // Calculate new position
    let newPosition: string;
    if (args.afterPosition === undefined) {
      // Insert at the end
      const lastBlock = sortedBlocks[sortedBlocks.length - 1];
      newPosition = generateKeyBetween(lastBlock?.position ?? null, null);
    } else if (args.afterPosition === "") {
      // Insert at the beginning (empty string is a marker for this)
      const firstBlock = sortedBlocks[0];
      newPosition = generateKeyBetween(null, firstBlock?.position ?? null);
    } else {
      // Insert after the specified position
      const afterIndex = sortedBlocks.findIndex(
        (b) => b.position === args.afterPosition
      );
      const nextBlock = sortedBlocks[afterIndex + 1];
      newPosition = generateKeyBetween(
        args.afterPosition,
        nextBlock?.position ?? null
      );
    }

    const { scalarContent, arrayFields } = splitContent(args.content);

    // Create the block with only scalar content
    const blockId = await ctx.db.insert("blocks", {
      pageId: args.pageId,
      type: args.type,
      content: scalarContent,
      settings: args.settings,
      summary: args.type, // placeholder until the AI summary is generated
      position: newPosition,
      createdAt: now,
      updatedAt: now,
    });

    // Create repeatableItems for array fields
    const insertPromises: Promise<any>[] = [];

    for (const [fieldName, items] of Object.entries(arrayFields)) {
      let prevPosition: string | null = null;

      for (const itemContent of items) {
        const itemPosition = generateKeyBetween(prevPosition, null);
        insertPromises.push(
          ctx.runMutation(api.repeatableItems.createRepeatableItem, {
            blockId,
            fieldName,
            content: itemContent,
            afterPosition: prevPosition ?? undefined,
          })
        );
        prevPosition = itemPosition;
      }
    }

    await Promise.all(insertPromises);

    await scheduleAiJob(ctx, {
      entityTable: "blocks",
      entityId: blockId,
      type: "summary",
      delayMs: 0,
      fn: internal.blocks.generateBlockSummary,
      fnArgs: { blockId },
    });

    return blockId;
  },
});

export const updateBlockContent = mutation({
  args: {
    blockId: v.id("blocks"),
    content: v.any(),
  },
  handler: async (ctx, args) => {
    const block = await ctx.db.get(args.blockId);
    if (!block) {
      throw new Error("Block not found");
    }

    await ctx.db.patch(args.blockId, {
      content: { ...block.content, ...args.content },
      updatedAt: Date.now(),
    });

    await scheduleAiJob(ctx, {
      entityTable: "blocks",
      entityId: args.blockId,
      type: "summary",
      delayMs: SUMMARIZATION_DEBOUNCE_DELAY_MS,
      fn: internal.blocks.generateBlockSummary,
      fnArgs: { blockId: args.blockId },
    });
  },
});

export const updateBlockSettings = mutation({
  args: {
    blockId: v.id("blocks"),
    settings: v.any(),
  },
  handler: async (ctx, args) => {
    const block = await ctx.db.get(args.blockId);
    if (!block) {
      throw new Error("Block not found");
    }

    await ctx.db.patch(args.blockId, {
      settings: { ...block.settings, ...args.settings },
      updatedAt: Date.now(),
    });
  },
});

export const updateBlockPosition = mutation({
  args: {
    blockId: v.id("blocks"),
    afterPosition: v.optional(v.string()),
    beforePosition: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const block = await ctx.db.get(args.blockId);
    if (!block) {
      throw new Error("Block not found");
    }

    // Calculate new position between afterPosition and beforePosition
    const newPosition = generateKeyBetween(
      args.afterPosition ?? null,
      args.beforePosition ?? null
    );

    await ctx.db.patch(args.blockId, {
      position: newPosition,
      updatedAt: Date.now(),
    });
  },
});

export const deleteBlock = mutation({
  args: {
    blockId: v.id("blocks"),
  },
  handler: async (ctx, args) => {
    const block = await ctx.db.get(args.blockId);
    if (!block) {
      throw new Error("Block not found");
    }

    // Delete all associated repeatableItems
    const items = await ctx.db
      .query("repeatableItems")
      .withIndex("by_block", (q) => q.eq("blockId", args.blockId))
      .collect();

    await Promise.all(items.map((item) => ctx.db.delete(item._id)));

    // Delete the block
    await ctx.db.delete(args.blockId);
  },
});

export const deleteBlocks = mutation({
  args: {
    blockIds: v.array(v.id("blocks")),
  },
  handler: async (ctx, args) => {
    await Promise.all(
      args.blockIds.map(async (blockId) => {
        const block = await ctx.db.get(blockId);
        if (!block) return;

        // Delete all associated repeatableItems
        const items = await ctx.db
          .query("repeatableItems")
          .withIndex("by_block", (q) => q.eq("blockId", blockId))
          .collect();

        await Promise.all(items.map((item) => ctx.db.delete(item._id)));

        // Delete the block
        await ctx.db.delete(blockId);
      })
    );
  },
});

export const duplicateBlock = mutation({
  args: {
    blockId: v.id("blocks"),
  },
  handler: async (ctx, args) => {
    const block = await ctx.db.get(args.blockId);
    if (!block) {
      throw new Error("Block not found");
    }

    const now = Date.now();

    // Get all blocks for this page to find position after the original
    const blocks = await ctx.db
      .query("blocks")
      .withIndex("by_page", (q) => q.eq("pageId", block.pageId))
      .collect();

    const sortedBlocks = sortByPosition(blocks);

    // Find the block after the original to calculate new position
    const originalIndex = sortedBlocks.findIndex((b) => b._id === args.blockId);
    const nextBlock = sortedBlocks[originalIndex + 1];
    const newPosition = generateKeyBetween(
      block.position,
      nextBlock?.position ?? null
    );

    // Create the duplicated block
    const newBlockId = await ctx.db.insert("blocks", {
      pageId: block.pageId,
      type: block.type,
      content: block.content,
      settings: block.settings,
      summary: block.summary,
      position: newPosition,
      createdAt: now,
      updatedAt: now,
    });

    // Duplicate all repeatable items
    const repeatableItems = await ctx.db
      .query("repeatableItems")
      .withIndex("by_block", (q) => q.eq("blockId", args.blockId))
      .collect();

    await Promise.all(
      repeatableItems.map((item) =>
        ctx.db.insert("repeatableItems", {
          blockId: newBlockId,
          fieldName: item.fieldName,
          content: item.content,
          summary: item.summary,
          position: item.position,
          createdAt: now,
          updatedAt: now,
        })
      )
    );

    return newBlockId;
  },
});

export const getAssembledBlockContent = internalQuery({
  args: {
    blockId: v.id("blocks"),
  },
  handler: async (ctx, args) => {
    const block = await ctx.db.get(args.blockId);
    if (!block) return null;

    // Look up block definition for field order and content schema
    const projectId = await getProjectIdForBlock(ctx, block);
    const def = projectId
      ? await getBlockDefinition(ctx, projectId, block.type)
      : null;
    const fieldOrder = def?.contentSchema?.properties
      ? Object.keys(def.contentSchema.properties)
      : undefined;

    const assembled = await assembleBlockContent(ctx, args.blockId, fieldOrder);
    if (!assembled) return null;

    return {
      ...assembled,
      contentSchema: def?.contentSchema ?? null,
      previousSummary: block.summary,
      pageId: block.pageId,
    };
  },
});

export const generateBlockSummary = internalAction({
  args: {
    blockId: v.id("blocks"),
  },
  handler: async (ctx, args) => {
    const assembled = await ctx.runQuery(
      internal.blocks.getAssembledBlockContent,
      { blockId: args.blockId },
    );
    if (!assembled) return;

    const markdown = assembled.contentSchema?.toMarkdown && assembled.contentSchema?.properties
      ? contentToMarkdown(assembled.contentSchema.toMarkdown, assembled.contentSchema.properties, assembled.content)
      : null;

    let summary: string;
    try {
      summary = await generateObjectSummary({
        type: assembled.type,
        markdown: markdown ?? JSON.stringify(assembled.content),
        previousSummary: assembled.previousSummary,
      });
    } catch (error: any) {
      console.error("generateBlockSummary failed:", {
        statusCode: error?.statusCode,
        responseBody: error?.responseBody,
        message: error?.message,
        cause: error?.cause,
        content: JSON.stringify(assembled.content).slice(0, 500),
      });
      throw error;
    }

    await ctx.runMutation(internal.blocks.updateBlockSummary, {
      blockId: args.blockId,
      summary,
    });

    // Cascade: if summary changed, schedule page SEO regeneration
    if (summary !== assembled.previousSummary && assembled.pageId) {
      await ctx.runMutation(internal.blocks.cascadeToPage, {
        pageId: assembled.pageId,
      });
    }
  },
});

export const updateBlockSummary = internalMutation({
  args: {
    blockId: v.id("blocks"),
    summary: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.blockId, {
      summary: args.summary,
      updatedAt: Date.now(),
    });

    await clearAiJob(ctx, {
      entityTable: "blocks",
      entityId: args.blockId,
      type: "summary",
    });
  },
});

export const cascadeToPage = internalMutation({
  args: {
    pageId: v.id("pages"),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db.get(args.pageId);
    if (!page || page.aiSeoEnabled === false) return;

    await scheduleAiJob(ctx, {
      entityTable: "pages",
      entityId: args.pageId,
      type: "seo",
      delayMs: PAGE_SEO_DELAY_MS,
      fn: internal.blocks.generatePageSeo,
      fnArgs: { pageId: args.pageId },
    });
  },
});

const SEO_STRIP_KEYS = new Set([
  "_id",
  "createdAt",
  "updatedAt",
  "position",
  "settings",
  "pageId",
  "blockId",
  "fieldName",
  "summary",
  "_fileId",
]);

function stripNonSeoFields(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SEO_STRIP_KEYS.has(key)) continue;
    if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? stripNonSeoFields(item as Record<string, unknown>)
          : item,
      );
    } else if (value && typeof value === "object") {
      result[key] = stripNonSeoFields(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export const getAssembledPageContent = internalQuery({
  args: {
    pageId: v.id("pages"),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db.get(args.pageId);
    if (!page) return null;

    const blocks = await ctx.db
      .query("blocks")
      .withIndex("by_page", (q) => q.eq("pageId", args.pageId))
      .collect();

    const sortedBlocks = sortByPosition(blocks);

    // Fetch block definitions to get field order and content schemas
    const blockDefs = await ctx.db
      .query("blockDefinitions")
      .withIndex("by_project", (q) => q.eq("projectId", page.projectId))
      .collect();
    const fieldOrderByType = new Map<string, string[]>();
    const contentSchemaByType = new Map<string, any>();
    for (const def of blockDefs) {
      if (def.contentSchema?.properties) {
        fieldOrderByType.set(
          def.blockId,
          Object.keys(def.contentSchema.properties),
        );
        contentSchemaByType.set(def.blockId, def.contentSchema);
      }
    }

    const assembledBlocks = await Promise.all(
      sortedBlocks.map(async (block) => {
        const assembled = await assembleBlockContent(
          ctx,
          block._id,
          fieldOrderByType.get(block.type),
        );
        if (!assembled) return null;
        return {
          type: assembled.type,
          content: stripNonSeoFields(assembled.content),
          contentSchema: contentSchemaByType.get(block.type) ?? null,
        };
      }),
    );

    return {
      fullPath: page.fullPath,
      aiSeoEnabled: page.aiSeoEnabled,
      blocks: assembledBlocks.filter(
        (b): b is { type: string; content: Record<string, unknown>; contentSchema: any } =>
          b !== null,
      ),
      previousMetaTitle: page.metaTitle,
      previousMetaDescription: page.metaDescription,
    };
  },
});

export const updatePageSeo = internalMutation({
  args: {
    pageId: v.id("pages"),
    metaTitle: v.string(),
    metaDescription: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.pageId, {
      metaTitle: args.metaTitle,
      metaDescription: args.metaDescription,
      updatedAt: Date.now(),
    });

    await clearAiJob(ctx, {
      entityTable: "pages",
      entityId: args.pageId,
      type: "seo",
    });
  },
});

export const generatePageSeo = internalAction({
  args: {
    pageId: v.id("pages"),
  },
  handler: async (ctx, args) => {
    const assembled = await ctx.runQuery(
      internal.blocks.getAssembledPageContent,
      { pageId: args.pageId },
    );
    if (!assembled || assembled.aiSeoEnabled === false) return;

    const markdownBlocks = assembled.blocks.map((block) => ({
      type: block.type,
      markdown: block.contentSchema?.toMarkdown && block.contentSchema?.properties
        ? contentToMarkdown(block.contentSchema.toMarkdown, block.contentSchema.properties, block.content)
        : JSON.stringify(block.content),
    }));

    let seo: { metaTitle: string; metaDescription: string };
    try {
      seo = await generatePageSeoAI({
        fullPath: assembled.fullPath,
        blocks: markdownBlocks,
        previousMetaTitle: assembled.previousMetaTitle,
        previousMetaDescription: assembled.previousMetaDescription,
      });
    } catch (error: any) {
      console.error("generatePageSeo failed:", {
        statusCode: error?.statusCode,
        responseBody: error?.responseBody,
        message: error?.message,
        cause: error?.cause,
      });
      throw error;
    }

    await ctx.runMutation(internal.blocks.updatePageSeo, {
      pageId: args.pageId,
      metaTitle: seo.metaTitle,
      metaDescription: seo.metaDescription,
    });
  },
});

export const getPageMarkdown = query({
  args: {
    pageId: v.id("pages"),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db.get(args.pageId);
    if (!page) return null;

    const blockDefs = await ctx.db
      .query("blockDefinitions")
      .withIndex("by_project", (q) => q.eq("projectId", page.projectId))
      .collect();
    const fieldOrderByType = new Map<string, string[]>();
    const contentSchemaByType = new Map<string, any>();
    for (const def of blockDefs) {
      if (def.contentSchema?.properties) {
        fieldOrderByType.set(
          def.blockId,
          Object.keys(def.contentSchema.properties),
        );
        contentSchemaByType.set(def.blockId, def.contentSchema);
      }
    }

    async function blocksToMarkdown(blocks: Doc<"blocks">[]) {
      const parts = await Promise.all(
        blocks.map(async (block) => {
          const assembled = await assembleBlockContent(
            ctx,
            block._id,
            fieldOrderByType.get(block.type),
          );
          if (!assembled) return null;

          const schema = contentSchemaByType.get(block.type);
          if (!schema?.toMarkdown || !schema?.properties) return null;

          return contentToMarkdown(schema.toMarkdown, schema.properties, assembled.content);
        }),
      );
      return parts.filter(Boolean) as string[];
    }

    // Page blocks
    const pageBlocks = await ctx.db
      .query("blocks")
      .withIndex("by_page", (q) => q.eq("pageId", args.pageId))
      .collect();
    const sortedPageBlocks = sortByPosition(pageBlocks);
    const pageMarkdown = await blocksToMarkdown(sortedPageBlocks);

    // Layout blocks (before/after page blocks)
    let beforeMarkdown: string[] = [];
    let afterMarkdown: string[] = [];
    if (page.layoutId) {
      const layout = await ctx.db.get(page.layoutId);
      if (layout) {
        const layoutBlocks = await ctx.db
          .query("blocks")
          .withIndex("by_layout", (q) => q.eq("layoutId", layout._id))
          .collect();
        const sortedLayoutBlocks = sortByPosition(layoutBlocks);
        const before = sortedLayoutBlocks.filter((b) => b.placement === "before");
        const after = sortedLayoutBlocks.filter((b) => b.placement === "after");
        beforeMarkdown = await blocksToMarkdown(before);
        afterMarkdown = await blocksToMarkdown(after);
      }
    }

    return [...beforeMarkdown, ...pageMarkdown, ...afterMarkdown]
      .join("\n\n---\n\n");
  },
});

export const getBlockUsageCounts = query({
  args: {},
  handler: async (ctx) => {
    const blocks = await ctx.db.query("blocks").collect();
    const counts: Record<string, number> = {};
    for (const block of blocks) {
      counts[block.type] = (counts[block.type] ?? 0) + 1;
    }
    return counts;
  },
});

export const getBlockInternal = internalQuery({
  args: {
    blockId: v.id("blocks"),
  },
  handler: async (ctx, args) => {
    const block = await ctx.db.get(args.blockId);
    if (!block) return null;

    // Get the projectId from the page or layout
    if (block.pageId) {
      const page = await ctx.db.get(block.pageId);
      if (!page) return null;
      return { ...block, projectId: page.projectId };
    }

    if (block.layoutId) {
      const layout = await ctx.db.get(block.layoutId);
      if (!layout) return null;
      return { ...block, projectId: layout.projectId };
    }

    return null;
  },
});

