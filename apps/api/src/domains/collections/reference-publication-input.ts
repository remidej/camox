import { z } from "zod";

export const collectionSelection = z
  .array(
    z
      .object({
        id: z.uuid(),
        collectionId: z.string(),
        expectedVersion: z.number().int().positive(),
      })
      .strict(),
  )
  .default([]);
export const referenceTargetsInput = z.object({
  id: z.number(),
  alsoPublishLayout: z.boolean().optional(),
});
