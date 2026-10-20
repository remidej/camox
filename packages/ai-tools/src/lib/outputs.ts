import { posthogRegionSchema } from "@camox/api-contract/analytics";
import { z } from "zod";

import { ENTITY_KINDS } from "../../../../apps/api/src/domains/drafts/overlay";

// The shapes tools return, shared by the tools returning the same entities. Timestamps are
// milliseconds since the epoch.

const content = z.record(z.string(), z.unknown());

/** The columns of every entity drafts hold (ADR 0005). */
const versioned = {
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
const resolvedReference = z.object({
  id: z.string(),
  collectionId: z.string(),
  label: z.string(),
  content,
  contentSchema: z.unknown(),
  get references() {
    return resolvedReferences.optional();
  },
});

/** Content's resolved references: a record (or null) per reference, records in order per list. */
export const resolvedReferences: z.ZodRecord<
  z.ZodString,
  z.ZodNullable<
    z.ZodUnion<readonly [typeof resolvedReference, z.ZodArray<typeof resolvedReference>]>
  >
> = z.record(z.string(), z.union([resolvedReference, z.array(resolvedReference)]).nullable());

export const pageRow = z.object({
  ...versioned,
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
export const pageView = pageRow.extend({ aiSeo: z.boolean() });

/** A block as readers see it: its shared content if it's a synced placement, and its summary. */
export const shownBlock = z.object({
  ...versioned,
  projectId: z.number(),
  locale: z.string(),
  layoutId: z.string().nullable(),
  pageId: z.string().nullable(),
  type: z.string(),
  content,
  settings: z.unknown(),
  slot: z.enum(["before", "after"]).nullable(),
  position: z.string(),
  summary: z.string(),
});

/** A block written by a tool, with what its content may be missing. */
export const writtenBlock = shownBlock.extend({ warnings: z.array(z.string()).optional() });

const shownItem = z.object({
  ...versioned,
  projectId: z.number().nullable(),
  locale: z.string(),
  content,
  settings: z.unknown(),
  position: z.string(),
  blockId: z.string(),
  sharedContentType: z.string().nullable(),
  parentItemId: z.string().nullable(),
  fieldName: z.string(),
  summary: z.string(),
});

/** A file with the metadata in effect in the session's locale. */
export const fileView = z.object({
  ...versioned,
  projectId: z.number(),
  url: z.string(),
  alt: z.string(),
  filename: z.string(),
  altsByLocale: z.record(z.string(), z.string()),
  mimeType: z.string(),
  size: z.number(),
  optimizedSize: z.number().nullable(),
  blobId: z.string(),
  path: z.string(),
  aiMetadata: z.boolean(),
});

/** Blocks with their repeatable items, and the files and records they use. */
export const blockBundle = z.object({
  block: shownBlock.extend({ references: resolvedReferences }),
  repeatableItems: z.array(shownItem.extend({ references: resolvedReferences })),
  files: z.array(fileView),
});

export const layoutBundle = z.object({
  projectName: z.string(),
  project: z.object({
    id: z.number(),
    updatedAt: z.number(),
    analytics: z.object({
      ga4: z.object({ measurementId: z.string() }).nullable(),
      posthog: z.object({ projectApiKey: z.string(), region: posthogRegionSchema }).nullable(),
    }),
  }),
  layout: z.object({
    layoutId: z.string(),
    contentUpdatedAt: z.number(),
    updatedAt: z.number(),
    beforeBlockIds: z.array(z.string()),
    afterBlockIds: z.array(z.string()),
  }),
  blocks: z.array(shownBlock.extend({ references: resolvedReferences })),
  repeatableItems: z.array(shownItem.extend({ references: resolvedReferences })),
  files: z.array(fileView),
});

export const layoutRow = z.object({
  rowId: z.number(),
  draftId: z.string().nullable(),
  projectId: z.number(),
  layoutId: z.string(),
  description: z.string().nullable(),
  kind: z.enum(["curated", "derived", "singleton"]),
  recordPages: z.object({ collectionId: z.string(), field: z.string() }).nullable(),
  schemaHash: z.string(),
  contentUpdatedAt: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const collectionRecord = z.object({
  id: z.string(),
  collectionId: z.string(),
  content,
  createdAt: z.number(),
  updatedAt: z.number(),
  references: resolvedReferences,
  duplicatePageValue: z.boolean(),
});

export const localeView = z.object({ tag: z.string(), isDefault: z.boolean() });

const person = z.object({ id: z.string(), name: z.string() });

/** Who ended a draft, how and when. */
export const endedDraft = z.object({
  draftId: z.string(),
  outcome: z.enum(["published", "discarded"]),
  endedBy: person,
  endedAt: z.number(),
});

/** An entity a publish preview mentions, as people know it, in its locale (null: stored once). */
const subject = {
  entity: z.enum([...ENTITY_KINDS, "definition"]),
  id: z.string(),
  label: z.string(),
  owner: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("page"), id: z.string(), path: z.string(), nickname: z.string() }),
      z.object({ kind: z.literal("layout"), name: z.string() }),
      z.object({ kind: z.literal("syncedBlock"), name: z.string(), title: z.string() }),
      z.object({ kind: z.literal("collection"), name: z.string(), title: z.string() }),
    ])
    .nullable(),
  locale: z.string().nullable(),
};

const problem = z.object({
  ...subject,
  code: z.enum([
    "definitionsDiffer",
    "emptyRequiredFile",
    "missingFile",
    "missingFileBytes",
    "unacceptedFileType",
    "duplicatePath",
    "duplicateRecordPageValue",
    "emptyRequiredReference",
    "danglingReference",
    "danglingPageLink",
    "wrongKindValue",
    "missingMetaTitle",
    "metaTitlePending",
    "localePrefixTaken",
    "duplicateLocale",
  ]),
  field: z.string(),
  message: z.string(),
});

export const publishPreview = z.object({
  blockers: z.array(problem),
  conflicts: z.array(
    z.object({
      ...subject,
      liveVersion: z.number().nullable(),
      publishedBy: person.nullable(),
      publishedAt: z.number().nullable(),
      release: z.boolean(),
    }),
  ),
  lost: z.array(z.object({ ...subject, reason: z.enum(["parentGone", "writtenAfterDeletion"]) })),
  warnings: z.array(problem),
  changes: z.array(z.object({ ...subject, change: z.enum(["created", "changed", "deleted"]) })),
  translating: z.array(z.string()),
  defaultLocale: z.string().nullable(),
  token: z.string(),
});
