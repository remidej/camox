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
    nickname: v.string(),
    metaTitle: v.optional(v.string()),
    metaDescription: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_path", ["fullPath"])
    .index("by_parent", ["parentPageId"])
    .index("by_project", ["projectId"]),

  blocks: defineTable({
    pageId: v.id("pages"),
    type: v.string(),
    content: v.any(),
    settings: v.optional(v.any()),
    summary: v.string(),
    position: v.string(),
    scheduledSummarizationJobId: v.optional(v.id("_scheduled_functions")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_page", ["pageId"])
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
    blobId: v.string(),
    path: v.string(),
    aiMetadataEnabled: v.optional(v.boolean()),
    scheduledMetadataJobId: v.optional(v.id("_scheduled_functions")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_blobId", ["blobId"]),

  blockDefinitions: defineTable({
    projectId: v.id("projects"),
    blockId: v.string(),
    title: v.string(),
    description: v.string(),
    contentSchema: v.any(),
    settingsSchema: v.optional(v.any()),
    code: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_blockId", ["projectId", "blockId"]),
});
