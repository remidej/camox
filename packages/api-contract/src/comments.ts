import { z } from "zod";

import { uuidv7Schema } from "./ids.ts";

export const COMMENT_MESSAGE_MAX_LENGTH = 10_000;

const fieldName = z.string().min(1).max(200);

export const commentTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("page") }),
  z.strictObject({ kind: z.literal("block"), blockId: uuidv7Schema }),
  z.strictObject({ kind: z.literal("item"), blockId: uuidv7Schema, itemId: uuidv7Schema }),
  z.strictObject({ kind: z.literal("block-field"), blockId: uuidv7Schema, fieldName }),
  z.strictObject({
    kind: z.literal("item-field"),
    blockId: uuidv7Schema,
    itemId: uuidv7Schema,
    fieldName,
  }),
]);

export const commentSchema = z.object({
  id: uuidv7Schema,
  pageId: uuidv7Schema,
  environmentId: z.number().int().positive(),
  /** Where the comment was written: null for Live, seen in every draft, or the draft it's in. */
  draftId: uuidv7Schema.nullable(),
  /**
   * The draft a Live comment was resolved from: publishing that draft resolves it, and
   * discarding it clears this.
   */
  addressedIn: z
    .object({
      draftId: uuidv7Schema,
      name: z.string().nullable(),
      createdBy: z.object({ name: z.string() }),
      createdAt: z.number(),
    })
    .nullable(),
  message: z.string(),
  resolved: z.boolean(),
  target: commentTargetSchema.nullable(),
  author: z.object({ name: z.string(), image: z.string().nullable() }),
  createdAt: z.number(),
});

export type CommentTarget = z.infer<typeof commentTargetSchema>;
export type Comment = z.infer<typeof commentSchema>;
