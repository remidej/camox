import { z } from "zod";

export const COMMENT_MESSAGE_MAX_LENGTH = 10_000;

const objectId = z.number().int().positive();
const fieldName = z.string().min(1).max(200);

export const commentTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("page") }),
  z.strictObject({ kind: z.literal("block"), blockId: objectId }),
  z.strictObject({ kind: z.literal("item"), blockId: objectId, itemId: objectId }),
  z.strictObject({ kind: z.literal("block-field"), blockId: objectId, fieldName }),
  z.strictObject({
    kind: z.literal("item-field"),
    blockId: objectId,
    itemId: objectId,
    fieldName,
  }),
]);

export const commentSchema = z.object({
  id: z.uuid(),
  pageId: objectId,
  environmentId: objectId,
  message: z.string(),
  target: commentTargetSchema.nullable(),
  author: z.object({ name: z.string(), image: z.string().nullable() }),
  createdAt: z.number(),
});

export type CommentTarget = z.infer<typeof commentTargetSchema>;
export type Comment = z.infer<typeof commentSchema>;
