import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  projects: defineTable({
    name: v.string(),
    description: v.string(),
    domain: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_domain", ["domain"]),

  pages: defineTable({
    projectId: v.id("projects"),
    pathSegment: v.string(),
    fullPath: v.string(),
    parentPageId: v.optional(v.id("pages")),
    layoutId: v.id("layouts"),
    metaTitle: v.optional(v.string()),
    metaDescription: v.optional(v.string()),
    aiSeoEnabled: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_path", ["fullPath"])
    .index("by_parent", ["parentPageId"])
    .index("by_project", ["projectId"]),

  layouts: defineTable({
    projectId: v.id("projects"),
    layoutId: v.string(),
    description: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_layoutId", ["projectId", "layoutId"]),

  blocks: defineTable({
    pageId: v.optional(v.id("pages")),
    layoutId: v.optional(v.id("layouts")),
    type: v.string(),
    content: v.any(),
    settings: v.optional(v.any()),
    placement: v.optional(v.union(v.literal("before"), v.literal("after"))),
    summary: v.string(),
    position: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_page", ["pageId"])
    .index("by_layout", ["layoutId"])
    .index("by_type", ["type"]),

  repeatableItems: defineTable({
    blockId: v.id("blocks"),
    fieldName: v.string(),
    content: v.any(),
    summary: v.string(),
    position: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_block_field", ["blockId", "fieldName"])
    .index("by_block", ["blockId"]),

  files: defineTable({
    url: v.string(),
    alt: v.string(),
    filename: v.string(),
    mimeType: v.string(),
    size: v.number(),
    blobId: v.string(),
    path: v.string(),
    aiMetadataEnabled: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_blobId", ["blobId"]),

  aiJobs: defineTable({
    entityTable: v.union(
      v.literal("repeatableItems"),
      v.literal("blocks"),
      v.literal("files"),
      v.literal("pages"),
    ),
    entityId: v.string(),
    type: v.union(v.literal("summary"), v.literal("fileMetadata"), v.literal("seo")),
    scheduledFunctionId: v.id("_scheduled_functions"),
    createdAt: v.number(),
  }).index("by_entity", ["entityTable", "entityId", "type"]),

  blockDefinitions: defineTable({
    projectId: v.id("projects"),
    blockId: v.string(),
    title: v.string(),
    description: v.string(),
    contentSchema: v.any(),
    settingsSchema: v.optional(v.any()),
    layoutOnly: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_blockId", ["projectId", "blockId"]),
});
