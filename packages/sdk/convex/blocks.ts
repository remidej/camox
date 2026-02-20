import { v } from "convex/values";
import { generateKeyBetween } from "fractional-indexing";
import {
  query,
  mutation,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import { generateObjectSummary } from "../src/lib/ai";

const SUMMARIZATION_DEBOUNCE_DELAY_MS = 5000;

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

    // Sort blocks by position (binary comparison for fractional indexing)
    const sortedBlocks = blocks.sort((a, b) => {
      if (a.position < b.position) return -1;
      if (a.position > b.position) return 1;
      return 0;
    });

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

    // Separate scalar content from array content (repeatableObjects)
    const scalarContent: Record<string, any> = {};
    const arrayFields: Record<string, any[]> = {};

    for (const [key, value] of Object.entries(args.content)) {
      if (Array.isArray(value)) {
        arrayFields[key] = value;
      } else {
        scalarContent[key] = value;
      }
    }

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

    // Schedule summary generation to run in the background
    await ctx.scheduler.runAfter(0, internal.blocks.generateBlockSummary, {
      blockId,
      type: args.type,
      content: scalarContent,
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

    // Cancel any existing summarization job
    if (block.scheduledSummarizationJobId) {
      console.log(
        "cancelling existing summarization job for block",
        args.blockId
      );
      await ctx.scheduler.cancel(block.scheduledSummarizationJobId);
    }

    // Merge new content with existing content
    const updates: any = {
      content: { ...block.content, ...args.content },
      updatedAt: Date.now(),
    };

    // Schedule summary generation to run in the background
    const scheduledJobId = await ctx.scheduler.runAfter(
      SUMMARIZATION_DEBOUNCE_DELAY_MS,
      internal.blocks.generateBlockSummary,
      {
        blockId: args.blockId,
        type: block.type,
        content: { ...block.content, ...args.content },
      }
    );

    // Store the scheduled job ID in the block
    updates.scheduledSummarizationJobId = scheduledJobId;

    await ctx.db.patch(args.blockId, updates);
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

    const sortedBlocks = blocks.sort((a, b) => {
      if (a.position < b.position) return -1;
      if (a.position > b.position) return 1;
      return 0;
    });

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

export const generateBlockSummary = internalAction({
  args: {
    blockId: v.id("blocks"),
    type: v.string(),
    content: v.any(),
  },
  handler: async (ctx, args) => {
    // Generate the summary using AI
    const summary = await generateObjectSummary({
      type: args.type,
      content: args.content,
    });

    // Update the block with the generated summary
    await ctx.runMutation(internal.blocks.updateBlockSummary, {
      blockId: args.blockId,
      summary,
    });
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
      scheduledSummarizationJobId: undefined,
      updatedAt: Date.now(),
    });
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

    // Get the page to find the projectId
    const page = await ctx.db.get(block.pageId);
    if (!page) return null;

    return {
      ...block,
      projectId: page.projectId,
    };
  },
});

