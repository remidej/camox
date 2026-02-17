import { v } from "convex/values";
import {
  mutation,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { generateKeyBetween } from "fractional-indexing";
import { generateObjectSummary } from "../src/lib/ai";

export const createRepeatableItem = mutation({
  args: {
    blockId: v.id("blocks"),
    fieldName: v.string(),
    content: v.any(),
    afterPosition: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Get all items for this block and field to determine position
    const items = await ctx.db
      .query("repeatableItems")
      .withIndex("by_block_field", (q) =>
        q.eq("blockId", args.blockId).eq("fieldName", args.fieldName)
      )
      .collect();

    // Sort items by position
    const sortedItems = items.sort((a, b) => {
      if (a.position < b.position) return -1;
      if (a.position > b.position) return 1;
      return 0;
    });

    // Calculate new position
    let newPosition: string;
    if (args.afterPosition === undefined) {
      // Insert at the end
      const lastItem = sortedItems[sortedItems.length - 1];
      newPosition = generateKeyBetween(lastItem?.position ?? null, null);
    } else {
      // Insert after the specified position
      const afterIndex = sortedItems.findIndex(
        (item) => item.position === args.afterPosition
      );
      const nextItem = sortedItems[afterIndex + 1];
      newPosition = generateKeyBetween(
        args.afterPosition,
        nextItem?.position ?? null
      );
    }

    const itemId = await ctx.db.insert("repeatableItems", {
      blockId: args.blockId,
      fieldName: args.fieldName,
      content: args.content,
      summary: args.fieldName,
      position: newPosition,
      createdAt: now,
      updatedAt: now,
    });

    // Schedule summary generation to run in the background
    await ctx.scheduler.runAfter(
      0,
      internal.repeatableItems.generateRepeatableItemSummary,
      {
        itemId,
        type: args.fieldName,
        content: args.content,
      }
    );

    return itemId;
  },
});

export const updateRepeatableItemContent = mutation({
  args: {
    itemId: v.id("repeatableItems"),
    content: v.any(),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) {
      throw new Error("Repeatable item not found");
    }

    await ctx.db.patch(args.itemId, {
      content: { ...item.content, ...args.content },
      updatedAt: Date.now(),
    });
  },
});

export const updateRepeatableItemPosition = mutation({
  args: {
    itemId: v.id("repeatableItems"),
    afterPosition: v.optional(v.string()),
    beforePosition: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) {
      throw new Error("Repeatable item not found");
    }

    // Calculate new position between afterPosition and beforePosition
    const newPosition = generateKeyBetween(
      args.afterPosition ?? null,
      args.beforePosition ?? null
    );

    await ctx.db.patch(args.itemId, {
      position: newPosition,
      updatedAt: Date.now(),
    });
  },
});

export const duplicateRepeatableItem = mutation({
  args: {
    itemId: v.id("repeatableItems"),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) {
      throw new Error("Repeatable item not found");
    }

    const now = Date.now();

    // Get all items for the same block + field to find position after the original
    const items = await ctx.db
      .query("repeatableItems")
      .withIndex("by_block_field", (q) =>
        q.eq("blockId", item.blockId).eq("fieldName", item.fieldName)
      )
      .collect();

    const sortedItems = items.sort((a, b) => {
      if (a.position < b.position) return -1;
      if (a.position > b.position) return 1;
      return 0;
    });

    const originalIndex = sortedItems.findIndex((i) => i._id === args.itemId);
    const nextItem = sortedItems[originalIndex + 1];
    const newPosition = generateKeyBetween(
      item.position,
      nextItem?.position ?? null
    );

    const newItemId = await ctx.db.insert("repeatableItems", {
      blockId: item.blockId,
      fieldName: item.fieldName,
      content: item.content,
      summary: item.summary,
      position: newPosition,
      createdAt: now,
      updatedAt: now,
    });

    // Schedule summary generation
    await ctx.scheduler.runAfter(
      0,
      internal.repeatableItems.generateRepeatableItemSummary,
      {
        itemId: newItemId,
        type: item.fieldName,
        content: item.content,
      }
    );

    return newItemId;
  },
});

export const deleteRepeatableItem = mutation({
  args: {
    itemId: v.id("repeatableItems"),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) {
      throw new Error("Repeatable item not found");
    }

    await ctx.db.delete(args.itemId);
  },
});

export const generateRepeatableItemSummary = internalAction({
  args: {
    itemId: v.id("repeatableItems"),
    type: v.string(),
    content: v.any(),
  },
  handler: async (ctx, args) => {
    // Generate the summary using AI
    const summary = await generateObjectSummary({
      type: args.type,
      content: args.content,
    });

    // Update the repeatable item with the generated summary
    await ctx.runMutation(
      internal.repeatableItems.updateRepeatableItemSummary,
      {
        itemId: args.itemId,
        summary,
      }
    );
  },
});

export const updateRepeatableItemSummary = internalMutation({
  args: {
    itemId: v.id("repeatableItems"),
    summary: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.itemId, {
      summary: args.summary,
      updatedAt: Date.now(),
    });
  },
});

export const getRepeatableItemsByBlockInternal = internalQuery({
  args: {
    blockId: v.id("blocks"),
  },
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query("repeatableItems")
      .withIndex("by_block", (q) => q.eq("blockId", args.blockId))
      .collect();

    // Sort by position
    return items.sort((a, b) => {
      if (a.position < b.position) return -1;
      if (a.position > b.position) return 1;
      return 0;
    });
  },
});
