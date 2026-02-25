import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { fs } from "./fs";

export const commitFile = mutation({
  args: {
    blobId: v.string(),
    filename: v.string(),
    contentType: v.string(),
  },
  handler: async (ctx, args) => {
    const path = `/uploads/${Date.now()}-${args.filename}`;
    await fs.commitFiles(ctx, [{ path, blobId: args.blobId }]);
    return { path, blobId: args.blobId };
  },
});
