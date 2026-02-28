import {
  mutation,
  query,
  internalAction,
  internalMutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { buildDownloadUrl } from "convex-fs";
import { fs } from "./fs";
import { generateImageMetadata } from "../src/lib/ai";

const FS_PREFIX = "/fs";

export const commitFile = mutation({
  args: {
    blobId: v.string(),
    filename: v.string(),
    contentType: v.string(),
    siteUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const path = `/uploads/${Date.now()}-${args.filename}`;
    await fs.commitFiles(ctx, [{ path, blobId: args.blobId }]);

    const url = buildDownloadUrl(args.siteUrl, FS_PREFIX, args.blobId, path);

    const now = Date.now();
    const fileId = await ctx.db.insert("files", {
      url,
      alt: "",
      filename: args.filename,
      mimeType: args.contentType,
      blobId: args.blobId,
      path,
      aiMetadataEnabled: true,
      createdAt: now,
      updatedAt: now,
    });

    const scheduledMetadataJobId = await ctx.scheduler.runAfter(
      0,
      internal.files.generateFileMetadata,
      { fileId, imageUrl: url, currentFilename: args.filename },
    );
    await ctx.db.patch(fileId, { scheduledMetadataJobId });

    return { fileId, url, filename: args.filename, mimeType: args.contentType };
  },
});

export const updateFileAlt = mutation({
  args: {
    fileId: v.id("files"),
    alt: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.fileId, {
      alt: args.alt,
      updatedAt: Date.now(),
    });
  },
});

export const updateFileFilename = mutation({
  args: {
    fileId: v.id("files"),
    filename: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.fileId, {
      filename: args.filename,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Recursively remove all `{ _fileId }` references matching the given fileId
 * from a content object. Returns the cleaned content and whether anything changed.
 */
function removeFileRefs(
  content: Record<string, unknown>,
  fileId: string,
): { result: Record<string, unknown>; changed: boolean } {
  let changed = false;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(content)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      if ("_fileId" in obj && obj._fileId === fileId) {
        result[key] = { url: "", alt: "", filename: "", mimeType: "" };
        changed = true;
      } else {
        const nested = removeFileRefs(obj, fileId);
        result[key] = nested.result;
        if (nested.changed) changed = true;
      }
    } else {
      result[key] = value;
    }
  }

  return { result, changed };
}

export const deleteFile = mutation({
  args: { fileId: v.id("files") },
  handler: async (ctx, args) => {
    const fileIdStr = args.fileId as string;

    // Clean up references in blocks
    const allBlocks = await ctx.db.query("blocks").collect();
    for (const block of allBlocks) {
      if (!block.content) continue;
      const { result, changed } = removeFileRefs(block.content, fileIdStr);
      if (changed) {
        await ctx.db.patch(block._id, {
          content: result,
          updatedAt: Date.now(),
        });
      }
    }

    // Clean up references in repeatable items
    const allItems = await ctx.db.query("repeatableItems").collect();
    for (const item of allItems) {
      if (!item.content) continue;
      const { result, changed } = removeFileRefs(item.content, fileIdStr);
      if (changed) {
        await ctx.db.patch(item._id, {
          content: result,
          updatedAt: Date.now(),
        });
      }
    }

    await ctx.db.delete(args.fileId);
  },
});

export const getFile = query({
  args: { fileId: v.id("files") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.fileId);
  },
});

export const generateFileMetadata = internalAction({
  args: {
    fileId: v.id("files"),
    imageUrl: v.string(),
    currentFilename: v.string(),
  },
  handler: async (ctx, args) => {
    const metadata = await generateImageMetadata(
      args.imageUrl,
      args.currentFilename,
    );
    await ctx.runMutation(internal.files.applyFileMetadata, {
      fileId: args.fileId,
      filename: metadata.filename,
      alt: metadata.alt,
    });
  },
});

export const applyFileMetadata = internalMutation({
  args: {
    fileId: v.id("files"),
    filename: v.string(),
    alt: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.fileId, {
      filename: args.filename,
      alt: args.alt,
      scheduledMetadataJobId: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const setAiMetadata = mutation({
  args: {
    fileId: v.id("files"),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId);
    if (!file) throw new Error("File not found");

    if (file.scheduledMetadataJobId) {
      await ctx.scheduler.cancel(file.scheduledMetadataJobId);
    }

    if (args.enabled) {
      const scheduledMetadataJobId = await ctx.scheduler.runAfter(
        0,
        internal.files.generateFileMetadata,
        {
          fileId: args.fileId,
          imageUrl: file.url,
          currentFilename: file.filename,
        },
      );
      await ctx.db.patch(args.fileId, {
        aiMetadataEnabled: true,
        scheduledMetadataJobId,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.patch(args.fileId, {
        aiMetadataEnabled: false,
        scheduledMetadataJobId: undefined,
        updatedAt: Date.now(),
      });
    }
  },
});
