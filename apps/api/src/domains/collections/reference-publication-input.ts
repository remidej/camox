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
/** The record a record page renders, which its layout's publication can include. */
export const pageRecordInput = z.object({ collectionId: z.string(), id: z.uuid() }).strict();
export const referenceTargetsInput = z.object({
  id: z.number(),
  /** Pages only: also publish the page's layout. */
  alsoPublishLayout: z.boolean().optional(),
  /** Layouts only: the record of the record page being published. */
  pageRecord: pageRecordInput.optional(),
  /** Layouts only: `false` publishes the selected records without the layout. */
  includeLayout: z.boolean().optional(),
});
