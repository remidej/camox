import { posthogRegionSchema } from "@camox/api-contract/analytics";
import { PUBLISH_ABORT_REASONS } from "@camox/api-contract/drafts";
import { z } from "zod";

import { ENTITY_KINDS } from "../../../../apps/api/src/domains/drafts/overlay";
import { LOSS_REASONS, PROBLEM_CODES } from "../../../../apps/api/src/domains/drafts/publish";
import { LAYOUT_KINDS } from "../../../../apps/api/src/domains/layouts/schema";

// The shapes tools return, shared by the tools returning the same entities. Objects are strict:
// a handler returning a field its tool doesn't declare fails dispatch's check, as the published
// JSON Schema forbids additional properties. Timestamps are milliseconds since the epoch.

/** Authored content: field values by field name. */
const authoredContentSchema = z.record(z.string(), z.unknown());

/** The columns of every entity drafts hold (ADR 0005). */
const versionedColumns = {
  id: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  rowId: z.number(),
  draftId: z.string().nullable(),
  version: z.number(),
  baseVersion: z.number().nullable(),
  deleted: z.boolean(),
  firstPublishedAt: z.number().nullable(),
  publishedAt: z.number().nullable(),
  publishedBy: z.string().nullable(),
};

/** A collection record a reference points at, with its own references one hop further. */
const resolvedReferenceSchema = z.strictObject({
  id: z.string(),
  collectionId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  content: authoredContentSchema,
  contentSchema: z.unknown(),
  get references() {
    return resolvedReferencesSchema.optional();
  },
});

/** Content's resolved references: a record (or null) per reference, records in order per list. */
export const resolvedReferencesSchema: z.ZodRecord<
  z.ZodString,
  z.ZodNullable<
    z.ZodUnion<
      readonly [typeof resolvedReferenceSchema, z.ZodArray<typeof resolvedReferenceSchema>]
    >
  >
> = z.record(
  z.string(),
  z.union([resolvedReferenceSchema, z.array(resolvedReferenceSchema)]).nullable(),
);

export const pageRowSchema = z.strictObject({
  ...versionedColumns,
  projectId: z.number(),
  locale: z.string(),
  pathSegment: z.string(),
  fullPath: z.string(),
  parentPageId: z.string().nullable(),
  layoutId: z.string(),
  nickname: z.string(),
  metaTitle: z.string().nullable(),
  metaDescription: z.string().nullable(),
  customOgImageBlobId: z.string().nullable(),
  customOgImageUrl: z.string().nullable(),
  contentUpdatedAt: z.number(),
  createdById: z.string().nullable(),
});

/** A page with whether its SEO is generated. */
export const pageSchema = pageRowSchema.extend({ aiSeo: z.boolean() });

/**
 * A block as readers see it: its shared content if it's a synced placement, its summary, and its
 * title, which names it until it has a summary.
 */
export const blockSchema = z.strictObject({
  ...versionedColumns,
  projectId: z.number(),
  locale: z.string(),
  layoutId: z.string().nullable(),
  pageId: z.string().nullable(),
  type: z.string(),
  content: authoredContentSchema,
  settings: z.unknown(),
  slot: z.enum(["before", "after"]).nullable(),
  position: z.string(),
  summary: z.string(),
  title: z.string(),
});

/** A block a tool wrote, with what its content may be missing. */
export const blockWithWarningsSchema = blockSchema.extend({
  warnings: z.array(z.string()).optional(),
});

const repeatableItemSchema = z.strictObject({
  ...versionedColumns,
  projectId: z.number().nullable(),
  locale: z.string(),
  content: authoredContentSchema,
  settings: z.unknown(),
  position: z.string(),
  blockId: z.string(),
  sharedContentType: z.string().nullable(),
  parentItemId: z.string().nullable(),
  fieldName: z.string(),
  summary: z.string(),
  title: z.string(),
});

const blockWithReferencesSchema = blockSchema.extend({ references: resolvedReferencesSchema });

const repeatableItemWithReferencesSchema = repeatableItemSchema.extend({
  references: resolvedReferencesSchema,
});

/** A file with the metadata in effect in the session's locale. */
export const fileSchema = z.strictObject({
  ...versionedColumns,
  projectId: z.number(),
  url: z.string(),
  alt: z.string(),
  filename: z.string(),
  altsByLocale: z.record(z.string(), z.string()),
  mimeType: z.string(),
  size: z.number(),
  optimizedSize: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  blobId: z.string(),
  path: z.string(),
  aiMetadata: z.boolean(),
});

/** A block with its repeatable items, and the files and records they use. */
export const blockBundleSchema = z.strictObject({
  block: blockWithReferencesSchema,
  repeatableItems: z.array(repeatableItemWithReferencesSchema),
  files: z.array(fileSchema),
});

/** A layout's blocks with their repeatable items, and the files and records they use. */
export const layoutBundleSchema = z.strictObject({
  projectName: z.string(),
  project: z.strictObject({
    id: z.number(),
    updatedAt: z.number(),
    analytics: z.strictObject({
      ga4: z.strictObject({ measurementId: z.string() }).nullable(),
      posthog: z
        .strictObject({ projectApiKey: z.string(), region: posthogRegionSchema })
        .nullable(),
    }),
    socialProfiles: z.array(z.string()),
  }),
  layout: z.strictObject({
    layoutId: z.string(),
    contentUpdatedAt: z.number(),
    updatedAt: z.number(),
    beforeBlockIds: z.array(z.string()),
    afterBlockIds: z.array(z.string()),
  }),
  blocks: z.array(blockWithReferencesSchema),
  repeatableItems: z.array(repeatableItemWithReferencesSchema),
  files: z.array(fileSchema),
  /** Each block's Structured Data nodes, by block id. */
  structuredData: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  /** The nodes of the records the blocks reference, by record id. */
  recordStructuredData: z.strictObject({
    nodes: z.record(z.string(), z.record(z.string(), z.unknown())),
    referenced: z.array(z.string()),
  }),
});

export const layoutSchema = z.strictObject({
  rowId: z.number(),
  draftId: z.string().nullable(),
  projectId: z.number(),
  layoutId: z.string(),
  description: z.string().nullable(),
  kind: z.enum(LAYOUT_KINDS),
  recordPages: z.strictObject({ collectionId: z.string(), field: z.string() }).nullable(),
  schemaHash: z.string(),
  contentUpdatedAt: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const collectionRecordSchema = z.strictObject({
  id: z.string(),
  collectionId: z.string(),
  content: authoredContentSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
  references: resolvedReferencesSchema,
  duplicatePageValue: z.boolean(),
});

export const localeSchema = z.strictObject({ tag: z.string(), isDefault: z.boolean() });

const memberSchema = z.strictObject({ id: z.string(), name: z.string() });

/** Who ended a draft, how and when. */
export const endedDraftSchema = z.strictObject({
  draftId: z.string(),
  outcome: z.enum(["published", "discarded"]),
  endedBy: memberSchema,
  endedAt: z.number(),
});

/** Where an entity a publish preview mentions sits: its page, layout, synced block or collection. */
const ownerSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("page"),
    id: z.string(),
    path: z.string(),
    nickname: z.string(),
  }),
  z.strictObject({ kind: z.literal("layout"), name: z.string() }),
  z.strictObject({ kind: z.literal("syncedBlock"), name: z.string(), title: z.string() }),
  z.strictObject({ kind: z.literal("collection"), name: z.string(), title: z.string() }),
]);

/** An entity a publish preview mentions, as people know it, in its locale (null: stored once). */
const subjectFields = {
  entity: z.enum([...ENTITY_KINDS, "definition", "code"]),
  id: z.string(),
  label: z.string(),
  owner: ownerSchema.nullable(),
  locale: z.string().nullable(),
};

const problemSchema = z.strictObject({
  ...subjectFields,
  code: z.enum(PROBLEM_CODES),
  field: z.string(),
  message: z.string(),
});

export const publishPreviewSchema = z.strictObject({
  blockers: z.array(problemSchema),
  conflicts: z.array(
    z.strictObject({
      ...subjectFields,
      liveVersion: z.number().nullable(),
      publishedBy: memberSchema.nullable(),
      publishedAt: z.number().nullable(),
      release: z.boolean(),
    }),
  ),
  lost: z.array(z.strictObject({ ...subjectFields, reason: z.enum(LOSS_REASONS) })),
  warnings: z.array(problemSchema),
  changes: z.array(
    z.strictObject({ ...subjectFields, change: z.enum(["created", "changed", "deleted"]) }),
  ),
  translating: z.array(z.string()),
  defaultLocale: z.string().nullable(),
  token: z.string(),
  code: z
    .strictObject({
      revision: z.string().nullable(),
      includesLive: z.boolean(),
      building: z.boolean(),
      publishing: z.boolean(),
      publishAborted: z.enum(PUBLISH_ABORT_REASONS).nullable(),
    })
    .nullable(),
});
