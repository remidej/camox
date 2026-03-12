import { v } from "convex/values";
import { generateKeyBetween } from "fractional-indexing";

import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { scheduleAiJob, clearAiJob } from "./lib/aiJobs";
import {
  sortByPosition,
  splitContent,
  collectFileIds,
  resolveFileRefs,
  groupItemsByBlockAndField,
  reconstructBlockContent,
  buildFileMap,
} from "./lib/contentAssembly";

export const createPageInternal = internalMutation({
  args: {
    projectId: v.id("projects"),
    pathSegment: v.string(),
    parentPageId: v.optional(v.id("pages")),
    layoutId: v.id("layouts"),
    blocks: v.array(
      v.object({
        type: v.string(),
        content: v.any(),
        settings: v.optional(v.any()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Calculate fullPath based on parent
    let fullPath: string;
    if (args.parentPageId) {
      const parentPage = await ctx.db.get(args.parentPageId);
      if (!parentPage) {
        throw new Error("Parent page not found");
      }
      fullPath = `${parentPage.fullPath}/${args.pathSegment}`;
    } else {
      fullPath = `/${args.pathSegment}`;
    }

    // Check if a page with this fullPath already exists
    const existingPage = await ctx.db
      .query("pages")
      .withIndex("by_path", (q) => q.eq("fullPath", fullPath))
      .first();

    if (existingPage) {
      throw new Error(`A page with path "${fullPath}" already exists`);
    }

    // Create the page
    const pageId = await ctx.db.insert("pages", {
      projectId: args.projectId,
      pathSegment: args.pathSegment,
      parentPageId: args.parentPageId,
      layoutId: args.layoutId,
      fullPath,
      createdAt: now,
      updatedAt: now,
    });

    // Create blocks
    let prevPosition: string | null = null;
    for (const block of args.blocks) {
      const position = generateKeyBetween(prevPosition, null);

      const { scalarContent, arrayFields } = splitContent(block.content);

      const blockId = await ctx.db.insert("blocks", {
        pageId,
        type: block.type,
        content: scalarContent,
        settings: block.settings,
        summary: block.type,
        position,
        createdAt: now,
        updatedAt: now,
      });

      // Schedule block summary generation
      await ctx.scheduler.runAfter(0, internal.blocks.generateBlockSummary, {
        blockId,
      });

      // Create repeatableItems for array fields
      for (const [fieldName, items] of Object.entries(arrayFields)) {
        let itemPrevPosition: string | null = null;
        for (const itemContent of items) {
          const itemPosition = generateKeyBetween(itemPrevPosition, null);
          const itemId = await ctx.db.insert("repeatableItems", {
            blockId,
            fieldName,
            content: itemContent,
            summary: fieldName,
            position: itemPosition,
            createdAt: now,
            updatedAt: now,
          });

          // Schedule repeatableItem summary generation
          await ctx.scheduler.runAfter(0, internal.repeatableItems.generateRepeatableItemSummary, {
            itemId,
          });

          itemPrevPosition = itemPosition;
        }
      }

      prevPosition = position;
    }

    // Schedule SEO generation immediately for new pages
    await scheduleAiJob(ctx, {
      entityTable: "pages",
      entityId: pageId,
      type: "seo",
      delayMs: 0,
      fn: internal.blocks.generatePageSeo,
      fnArgs: { pageId },
    });

    return { pageId, fullPath };
  },
});

export const getPageById = query({
  args: {
    pageId: v.id("pages"),
  },
  handler: async (ctx, args) => {
    return ctx.db.get(args.pageId);
  },
});

export const getPage = query({
  args: {
    fullPath: v.string(),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("pages")
      .withIndex("by_path", (q) => q.eq("fullPath", args.fullPath))
      .first();

    if (!page) {
      return null;
    }

    const blocks = await ctx.db
      .query("blocks")
      .withIndex("by_page", (q) => q.eq("pageId", page._id))
      .order("asc")
      .collect();

    const sortedBlocks = sortByPosition(blocks);

    // Fetch block definitions to get field order for each block type
    const blockDefs = await ctx.db
      .query("blockDefinitions")
      .withIndex("by_project", (q) => q.eq("projectId", page.projectId))
      .collect();
    const fieldOrderByType = new Map<string, string[]>();
    for (const def of blockDefs) {
      if (def.contentSchema?.properties) {
        fieldOrderByType.set(def.blockId, Object.keys(def.contentSchema.properties));
      }
    }

    // Fetch all repeatableItems for all blocks
    const blockIds = sortedBlocks.map((block) => block._id);
    const allRepeatableItems = await Promise.all(
      blockIds.map((blockId) =>
        ctx.db
          .query("repeatableItems")
          .withIndex("by_block", (q) => q.eq("blockId", blockId))
          .collect(),
      ),
    );

    const sortedItems = sortByPosition(allRepeatableItems.flat());
    const itemsByBlockAndField = groupItemsByBlockAndField(sortedItems);

    // Reconstruct blocks with their repeatableItems merged into content
    const blocksWithItems = sortedBlocks.map((block) => ({
      ...block,
      content: reconstructBlockContent(
        block.content,
        itemsByBlockAndField,
        block._id,
        sortedItems,
        fieldOrderByType.get(block.type),
      ),
    }));

    // Resolve file references (_fileId) to full file objects
    const allFileIds = new Set<string>();
    for (const block of blocksWithItems) {
      collectFileIds(block.content, allFileIds);
    }

    let resolvedPageBlocks = blocksWithItems;
    if (allFileIds.size > 0) {
      const fileMap = await buildFileMap(ctx, allFileIds);
      resolvedPageBlocks = blocksWithItems.map((block) => ({
        ...block,
        content: resolveFileRefs(block.content, fileMap),
      }));
    }

    const project = await ctx.db.get(page.projectId);
    if (!project) {
      throw new Error("Project not found");
    }
    const projectName = project.name;

    // Fetch layout data if page has a layout
    if (page.layoutId) {
      const layout = await ctx.db.get(page.layoutId);
      if (layout) {
        const layoutBlocks = await ctx.db
          .query("blocks")
          .withIndex("by_layout", (q) => q.eq("layoutId", layout._id))
          .collect();

        const sortedLayoutBlocks = sortByPosition(layoutBlocks);

        // Assemble layout blocks (repeatable items + file resolution)
        const layoutBlockIds = sortedLayoutBlocks.map((b) => b._id);
        const layoutRepeatableItems = await Promise.all(
          layoutBlockIds.map((blockId) =>
            ctx.db
              .query("repeatableItems")
              .withIndex("by_block", (q) => q.eq("blockId", blockId))
              .collect(),
          ),
        );

        const sortedLayoutItems = sortByPosition(layoutRepeatableItems.flat());
        const layoutItemsByBlockAndField = groupItemsByBlockAndField(sortedLayoutItems);

        const layoutBlocksWithItems = sortedLayoutBlocks.map((block) => ({
          ...block,
          content: reconstructBlockContent(
            block.content,
            layoutItemsByBlockAndField,
            block._id,
            sortedLayoutItems,
            fieldOrderByType.get(block.type),
          ),
        }));

        // Resolve file refs in layout blocks
        const layoutFileIds = new Set<string>();
        for (const block of layoutBlocksWithItems) {
          collectFileIds(block.content, layoutFileIds);
        }

        let resolvedLayoutBlocks = layoutBlocksWithItems;
        if (layoutFileIds.size > 0) {
          const layoutFileMap = await buildFileMap(ctx, layoutFileIds);
          resolvedLayoutBlocks = layoutBlocksWithItems.map((block) => ({
            ...block,
            content: resolveFileRefs(block.content, layoutFileMap),
          }));
        }

        const beforeBlocks = resolvedLayoutBlocks.filter((b) => b.placement === "before");
        const afterBlocks = resolvedLayoutBlocks.filter((b) => b.placement === "after");

        return {
          page,
          projectName,
          blocks: resolvedPageBlocks,
          layout: {
            _id: layout._id,
            layoutId: layout.layoutId,
            blocks: resolvedLayoutBlocks,
            beforeBlocks,
            afterBlocks,
          },
        };
      }
    }

    return {
      page,
      projectName,
      blocks: resolvedPageBlocks,
    };
  },
});

export const listPages = query({
  args: {},
  handler: async (ctx) => {
    const pages = await ctx.db.query("pages").collect();
    // Sort alphabetically by fullPath
    return pages.sort((a, b) => a.fullPath.localeCompare(b.fullPath));
  },
});

export const updatePage = mutation({
  args: {
    pageId: v.id("pages"),
    pathSegment: v.string(),
    parentPageId: v.optional(v.id("pages")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check if page exists
    const existingPage = await ctx.db.get(args.pageId);
    if (!existingPage) {
      throw new Error("Page not found");
    }

    // Calculate new fullPath based on parent
    let fullPath: string;
    if (args.parentPageId) {
      const parentPage = await ctx.db.get(args.parentPageId);
      if (!parentPage) {
        throw new Error("Parent page not found");
      }
      fullPath = `${parentPage.fullPath}/${args.pathSegment}`;
    } else {
      fullPath = `/${args.pathSegment}`;
    }

    // Check if a different page with this fullPath already exists
    const duplicatePage = await ctx.db
      .query("pages")
      .withIndex("by_path", (q) => q.eq("fullPath", fullPath))
      .first();

    if (duplicatePage && duplicatePage._id !== args.pageId) {
      throw new Error(`A page with path "${fullPath}" already exists`);
    }

    // Update the page
    await ctx.db.patch(args.pageId, {
      pathSegment: args.pathSegment,
      parentPageId: args.parentPageId,
      fullPath,
      updatedAt: now,
    });

    return { pageId: args.pageId, fullPath };
  },
});

export const deletePage = mutation({
  args: {
    pageId: v.id("pages"),
  },
  handler: async (ctx, args) => {
    // Check if page exists
    const page = await ctx.db.get(args.pageId);
    if (!page) {
      throw new Error("Page not found");
    }

    // Get all blocks for this page
    const blocks = await ctx.db
      .query("blocks")
      .withIndex("by_page", (q) => q.eq("pageId", args.pageId))
      .collect();

    // Delete all repeatableItems for each block
    for (const block of blocks) {
      const repeatableItems = await ctx.db
        .query("repeatableItems")
        .withIndex("by_block", (q) => q.eq("blockId", block._id))
        .collect();

      for (const item of repeatableItems) {
        await ctx.db.delete(item._id);
      }
    }

    // Delete all blocks
    for (const block of blocks) {
      await ctx.db.delete(block._id);
    }

    // Delete the page
    await ctx.db.delete(args.pageId);
  },
});

export const setAiSeo = mutation({
  args: {
    pageId: v.id("pages"),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db.get(args.pageId);
    if (!page) throw new Error("Page not found");

    if (args.enabled) {
      await scheduleAiJob(ctx, {
        entityTable: "pages",
        entityId: args.pageId,
        type: "seo",
        delayMs: 0,
        fn: internal.blocks.generatePageSeo,
        fnArgs: { pageId: args.pageId },
      });
      await ctx.db.patch(args.pageId, {
        aiSeoEnabled: true,
        updatedAt: Date.now(),
      });
    } else {
      await clearAiJob(ctx, {
        entityTable: "pages",
        entityId: args.pageId,
        type: "seo",
      });
      await ctx.db.patch(args.pageId, {
        aiSeoEnabled: false,
        updatedAt: Date.now(),
      });
    }
  },
});

export const updatePageMetaTitle = mutation({
  args: {
    pageId: v.id("pages"),
    metaTitle: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.pageId, {
      metaTitle: args.metaTitle,
      updatedAt: Date.now(),
    });
  },
});

export const setPageLayout = mutation({
  args: {
    pageId: v.id("pages"),
    layoutId: v.id("layouts"),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db.get(args.pageId);
    if (!page) throw new Error("Page not found");

    await ctx.db.patch(args.pageId, {
      layoutId: args.layoutId,
      updatedAt: Date.now(),
    });
  },
});

export const updatePageMetaDescription = mutation({
  args: {
    pageId: v.id("pages"),
    metaDescription: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.pageId, {
      metaDescription: args.metaDescription,
      updatedAt: Date.now(),
    });
  },
});
