import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { generateKeyBetween } from "fractional-indexing";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

/* -------------------------------------------------------------------------------------------------
 * File reference resolution helpers
 * -----------------------------------------------------------------------------------------------*/

/** Recursively collect all _fileId values from a content object. */
function collectFileIds(
  content: Record<string, unknown>,
  fileIds: Set<string>,
) {
  for (const value of Object.values(content)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      if ("_fileId" in obj && typeof obj._fileId === "string") {
        fileIds.add(obj._fileId);
      } else {
        collectFileIds(obj, fileIds);
      }
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object" && "content" in item) {
          collectFileIds(
            (item as { content: Record<string, unknown> }).content,
            fileIds,
          );
        } else if (item && typeof item === "object" && !Array.isArray(item)) {
          collectFileIds(item as Record<string, unknown>, fileIds);
        }
      }
    }
  }
}

type FileDoc = {
  _id: Id<"files">;
  url: string;
  alt: string;
  filename: string;
  mimeType: string;
};

/**
 * Recursively resolve { _fileId } references in content to full file objects.
 * Old inline {url, alt, filename, mimeType} objects pass through unchanged.
 */
function resolveFileRefs(
  content: Record<string, unknown>,
  fileMap: Map<string, FileDoc>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(content)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      if ("_fileId" in obj && typeof obj._fileId === "string") {
        const file = fileMap.get(obj._fileId);
        if (file) {
          resolved[key] = {
            url: file.url,
            alt: file.alt,
            filename: file.filename,
            mimeType: file.mimeType,
            _fileId: obj._fileId,
          };
        } else {
          // File was deleted or not found
          resolved[key] = { url: "", alt: "", filename: "", mimeType: "" };
        }
      } else {
        // Other object (e.g. legacy inline image, link, etc.) — recurse
        resolved[key] = resolveFileRefs(obj, fileMap);
      }
    } else if (Array.isArray(value)) {
      resolved[key] = value.map((item) => {
        if (item && typeof item === "object" && "content" in item) {
          // DB-backed repeatable item
          return {
            ...item,
            content: resolveFileRefs(
              (item as { content: Record<string, unknown> }).content,
              fileMap,
            ),
          };
        } else if (item && typeof item === "object" && !Array.isArray(item)) {
          return resolveFileRefs(item as Record<string, unknown>, fileMap);
        }
        return item;
      });
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

/** Batch-fetch all referenced files and build a lookup map. */
async function buildFileMap(
  ctx: QueryCtx,
  fileIds: Set<string>,
): Promise<Map<string, FileDoc>> {
  const fileMap = new Map<string, FileDoc>();
  await Promise.all(
    [...fileIds].map(async (id) => {
      try {
        const file = await ctx.db.get(id as Id<"files">);
        if (file) {
          fileMap.set(id, file);
        }
      } catch {
        // Not a valid ID, skip
      }
    }),
  );
  return fileMap;
}

export const createPageInternal = internalMutation({
  args: {
    projectId: v.id("projects"),
    nickname: v.string(),
    pathSegment: v.string(),
    parentPageId: v.optional(v.id("pages")),
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
      nickname: args.nickname,
      pathSegment: args.pathSegment,
      parentPageId: args.parentPageId,
      fullPath,
      createdAt: now,
      updatedAt: now,
    });

    // Create blocks
    let prevPosition: string | null = null;
    for (const block of args.blocks) {
      const position = generateKeyBetween(prevPosition, null);

      // Separate scalar vs array content (arrays go to repeatableItems)
      const scalarContent: Record<string, unknown> = {};
      const arrayFields: Record<string, unknown[]> = {};

      for (const [key, value] of Object.entries(block.content)) {
        if (Array.isArray(value)) {
          arrayFields[key] = value;
        } else {
          scalarContent[key] = value;
        }
      }

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
        type: block.type,
        content: scalarContent,
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
          await ctx.scheduler.runAfter(
            0,
            internal.repeatableItems.generateRepeatableItemSummary,
            {
              itemId,
              type: fieldName,
              content: itemContent,
            }
          );

          itemPrevPosition = itemPosition;
        }
      }

      prevPosition = position;
    }

    return { pageId, fullPath };
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

    // Sort blocks by position (binary comparison for fractional indexing)
    const sortedBlocks = blocks.sort((a, b) => {
      if (a.position < b.position) return -1;
      if (a.position > b.position) return 1;
      return 0;
    });

    // Fetch all repeatableItems for all blocks in one query
    const blockIds = sortedBlocks.map((block) => block._id);
    const allRepeatableItems = await Promise.all(
      blockIds.map((blockId) =>
        ctx.db
          .query("repeatableItems")
          .withIndex("by_block", (q) => q.eq("blockId", blockId))
          .collect()
      )
    );

    // Flatten and sort repeatableItems by position
    const flattenedItems = allRepeatableItems.flat();
    const sortedItems = flattenedItems.sort((a, b) => {
      if (a.position < b.position) return -1;
      if (a.position > b.position) return 1;
      return 0;
    });

    // Group items by blockId and fieldName
    const itemsByBlockAndField = sortedItems.reduce((acc, item) => {
      const key = `${item.blockId}:${item.fieldName}`;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(item);
      return acc;
    }, {} as Record<string, typeof sortedItems>);

    // Reconstruct blocks with their repeatableItems as arrays in content
    const blocksWithItems = sortedBlocks.map((block) => {
      const reconstructedContent = { ...block.content };

      // Find all field names for this block's repeatableItems
      const fieldNames = new Set(
        sortedItems
          .filter((item) => item.blockId === block._id)
          .map((item) => item.fieldName)
      );

      // Add full item objects (with _id, position, content, etc.) to content
      for (const fieldName of fieldNames) {
        const key = `${block._id}:${fieldName}`;
        const items = itemsByBlockAndField[key] || [];
        reconstructedContent[fieldName] = items;
      }

      return {
        ...block,
        content: reconstructedContent,
      };
    });

    // Resolve file references (_fileId) to full file objects
    const allFileIds = new Set<string>();
    for (const block of blocksWithItems) {
      collectFileIds(block.content, allFileIds);
    }

    if (allFileIds.size > 0) {
      const fileMap = await buildFileMap(ctx, allFileIds);
      const resolvedBlocks = blocksWithItems.map((block) => ({
        ...block,
        content: resolveFileRefs(block.content, fileMap),
      }));
      return { page, blocks: resolvedBlocks };
    }

    return {
      page,
      blocks: blocksWithItems,
    };
  },
});

export const listPages = query({
  handler: async (ctx) => {
    const pages = await ctx.db.query("pages").collect();
    // Sort alphabetically by fullPath
    return pages.sort((a, b) => a.fullPath.localeCompare(b.fullPath));
  },
});

export const updatePage = mutation({
  args: {
    pageId: v.id("pages"),
    nickname: v.string(),
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
      nickname: args.nickname,
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
