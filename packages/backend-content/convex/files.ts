import { buildDownloadUrl } from "convex-fs";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { query, internalAction } from "./_generated/server";
import { fs, useLocalStorage } from "./fs";
import { internalMutation, mutation } from "./functions";
import { generateImageMetadata } from "./lib/ai";
import { scheduleAiJob, clearAiJob } from "./lib/aiJobs";

const FS_PREFIX = "/fs";

export const commitFile = mutation({
  args: {
    blobId: v.string(),
    filename: v.string(),
    contentType: v.string(),
    size: v.number(),
    siteUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const path = `/uploads/${Date.now()}-${args.filename}`;

    let url: string;
    if (useLocalStorage) {
      url = `${args.siteUrl}${FS_PREFIX}/blobs/${args.blobId}`;
    } else {
      await fs!.commitFiles(ctx, [{ path, blobId: args.blobId }]);
      url = buildDownloadUrl(args.siteUrl, FS_PREFIX, args.blobId, path);
    }

    const now = Date.now();
    const fileId = await ctx.db.insert("files", {
      url,
      alt: "",
      filename: args.filename,
      mimeType: args.contentType,
      size: args.size,
      blobId: args.blobId,
      path,
      aiMetadataEnabled: true,
      createdAt: now,
      updatedAt: now,
    });

    await scheduleAiJob(ctx, {
      entityTable: "files",
      entityId: fileId,
      type: "fileMetadata",
      delayMs: 0,
      fn: internal.files.generateFileMetadata,
      fnArgs: { fileId, imageUrl: url, currentFilename: args.filename },
    });

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
    const file = await ctx.db.get(args.fileId);
    if (!file) return;

    // Delete the blob from storage
    if (useLocalStorage) {
      await ctx.storage.delete(file.blobId as Id<"_storage">);
    } else {
      await fs!.delete(ctx, file.path);
    }

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

export const listFiles = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db.query("files").order("desc").collect();
  },
});

export const getFile = query({
  args: { fileId: v.id("files") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.fileId);
  },
});

/**
 * Count how many `{ _fileId }` references match the given fileId in a content object.
 */
function countFileRefs(content: Record<string, unknown>, fileId: string): number {
  let count = 0;

  for (const value of Object.values(content)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const obj = value as Record<string, unknown>;
    if ("_fileId" in obj && obj._fileId === fileId) {
      count++;
    } else {
      count += countFileRefs(obj, fileId);
    }
  }

  return count;
}

export const getFileUsageCount = query({
  args: { fileId: v.id("files") },
  handler: async (ctx, args) => {
    const fileIdStr = args.fileId as string;
    let count = 0;

    const allBlocks = await ctx.db.query("blocks").collect();
    for (const block of allBlocks) {
      if (!block.content) continue;
      count += countFileRefs(block.content, fileIdStr);
    }

    const allItems = await ctx.db.query("repeatableItems").collect();
    for (const item of allItems) {
      if (!item.content) continue;
      count += countFileRefs(item.content, fileIdStr);
    }

    return count;
  },
});

export const generateFileMetadata = internalAction({
  args: {
    fileId: v.id("files"),
    imageUrl: v.string(),
    currentFilename: v.string(),
  },
  handler: async (ctx, args) => {
    const metadata = await generateImageMetadata(args.imageUrl, args.currentFilename);

    const ext = args.currentFilename.includes(".")
      ? `.${args.currentFilename.split(".").pop()}`
      : "";
    const nameWithoutExt = metadata.filename.replace(/\.[^.]+$/, "");

    await ctx.runMutation(internal.files.applyFileMetadata, {
      fileId: args.fileId,
      filename: `${nameWithoutExt}${ext}`,
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
      updatedAt: Date.now(),
    });

    await clearAiJob(ctx, {
      entityTable: "files",
      entityId: args.fileId,
      type: "fileMetadata",
    });
  },
});

/**
 * Recursively replace all `{ _fileId: oldFileId }` references with the new file's data.
 */
function replaceFileRefs(
  content: Record<string, unknown>,
  oldFileId: string,
  newData: { url: string; alt: string; filename: string; mimeType: string; _fileId: string },
): { result: Record<string, unknown>; changed: boolean } {
  let changed = false;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(content)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      if ("_fileId" in obj && obj._fileId === oldFileId) {
        result[key] = { ...newData };
        changed = true;
      } else {
        const nested = replaceFileRefs(obj, oldFileId, newData);
        result[key] = nested.result;
        if (nested.changed) changed = true;
      }
    } else {
      result[key] = value;
    }
  }

  return { result, changed };
}

export const replaceFile = mutation({
  args: {
    oldFileId: v.id("files"),
    newFileId: v.id("files"),
  },
  handler: async (ctx, args) => {
    const oldFile = await ctx.db.get(args.oldFileId);
    if (!oldFile) throw new Error("Old file not found");
    const newFile = await ctx.db.get(args.newFileId);
    if (!newFile) throw new Error("New file not found");

    const oldFileIdStr = args.oldFileId as string;
    const newData = {
      url: newFile.url,
      alt: newFile.alt,
      filename: newFile.filename,
      mimeType: newFile.mimeType,
      _fileId: args.newFileId as string,
    };

    // Replace references in blocks
    const allBlocks = await ctx.db.query("blocks").collect();
    for (const block of allBlocks) {
      if (!block.content) continue;
      const { result, changed } = replaceFileRefs(block.content, oldFileIdStr, newData);
      if (changed) {
        await ctx.db.patch(block._id, {
          content: result,
          updatedAt: Date.now(),
        });
      }
    }

    // Replace references in repeatable items
    const allItems = await ctx.db.query("repeatableItems").collect();
    for (const item of allItems) {
      if (!item.content) continue;
      const { result, changed } = replaceFileRefs(item.content, oldFileIdStr, newData);
      if (changed) {
        await ctx.db.patch(item._id, {
          content: result,
          updatedAt: Date.now(),
        });
      }
    }

    // Delete the old file record
    await ctx.db.delete(args.oldFileId);
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

    if (args.enabled) {
      await scheduleAiJob(ctx, {
        entityTable: "files",
        entityId: args.fileId,
        type: "fileMetadata",
        delayMs: 0,
        fn: internal.files.generateFileMetadata,
        fnArgs: {
          fileId: args.fileId,
          imageUrl: file.url,
          currentFilename: file.filename,
        },
      });
      await ctx.db.patch(args.fileId, {
        aiMetadataEnabled: true,
        updatedAt: Date.now(),
      });
    } else {
      // Cancel any pending metadata job
      await clearAiJob(ctx, {
        entityTable: "files",
        entityId: args.fileId,
        type: "fileMetadata",
      });
      await ctx.db.patch(args.fileId, {
        aiMetadataEnabled: false,
        updatedAt: Date.now(),
      });
    }
  },
});
