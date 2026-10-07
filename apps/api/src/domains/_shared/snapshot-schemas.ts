import { z } from "zod";

// Zod schemas for the JSON blob stored in `page_checkpoints.snapshot` /
// `layout_checkpoints.snapshot`. The reader uses these on every snapshot
// read so a malformed blob (hand-edited row, future migration bug, etc.)
// surfaces as a parse error instead of a downstream `undefined.map` crash.
//
// Field shape mirrors the migration's SQL `json_object(...)` output, which
// in turn mirrors drizzle's `$inferSelect` on the corresponding live row —
// with two SQLite quirks:
//   - Boolean columns (e.g. `aiSeoEnabled`) come out as 0 / 1 integers when
//     written via SQL `json_object`, so we `preprocess` int → boolean to
//     match what drizzle returns on a live-row read.
//   - `content` / `settings` are stored as TEXT-mode-json on the live row;
//     the migration uses SQL `json(b.content)` to splice them back into the
//     enclosing object so they appear as nested JSON, not double-encoded
//     strings. We validate them as `unknown` because their shape is
//     per-block-type and opaque to this layer.

const sqliteBoolean = z.preprocess(
  (value) => (typeof value === "number" ? Boolean(value) : value),
  z.boolean(),
);

export const snapshotBlockSchema = z.object({
  id: z.number(),
  pageId: z.number().nullable(),
  layoutId: z.number().nullable(),
  type: z.string(),
  content: z.unknown(),
  settings: z.unknown().nullable(),
  slot: z.enum(["before", "after"]).nullable(),
  summary: z.string(),
  position: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type SnapshotBlock = z.infer<typeof snapshotBlockSchema>;

export const snapshotRepeatableItemSchema = z.object({
  id: z.number(),
  blockId: z.number(),
  parentItemId: z.number().nullable(),
  fieldName: z.string(),
  content: z.unknown(),
  settings: z.unknown().nullable(),
  summary: z.string(),
  position: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type SnapshotRepeatableItem = z.infer<typeof snapshotRepeatableItemSchema>;

const snapshotPageRowSchema = z.object({
  id: z.number(),
  projectId: z.number(),
  environmentId: z.number(),
  pathSegment: z.string(),
  fullPath: z.string(),
  parentPageId: z.number().nullable(),
  layoutId: z.number(),
  nickname: z.string(),
  metaTitle: z.string().nullable(),
  metaDescription: z.string().nullable(),
  aiSeoEnabled: sqliteBoolean.nullable(),
  customOgImageBlobId: z.string().nullable(),
  customOgImageUrl: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const snapshotLayoutRowSchema = z.object({
  id: z.number(),
  projectId: z.number(),
  environmentId: z.number(),
  layoutId: z.string(),
  description: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const pageSnapshotSchema = z.object({
  page: snapshotPageRowSchema,
  blocks: z.array(snapshotBlockSchema),
  repeatableItems: z.array(snapshotRepeatableItemSchema),
});
export type PageSnapshot = z.infer<typeof pageSnapshotSchema>;

export const layoutSnapshotSchema = z.object({
  layout: snapshotLayoutRowSchema,
  blocks: z.array(snapshotBlockSchema),
  repeatableItems: z.array(snapshotRepeatableItemSchema),
});
export type LayoutSnapshot = z.infer<typeof layoutSnapshotSchema>;
