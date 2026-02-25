import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { buildDownloadUrl } from "convex-fs";
import { fs } from "./fs";

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
      createdAt: now,
      updatedAt: now,
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

export const getFile = query({
  args: { fileId: v.id("files") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.fileId);
  },
});
