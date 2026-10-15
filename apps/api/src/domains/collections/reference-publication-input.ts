import { uuidv7Schema } from "@camox/api-contract/ids";
import { z } from "zod";

export const collectionSelection = z
  .array(
    z
      .object({
        id: uuidv7Schema,
        collectionId: z.string(),
        expectedVersion: z.number().int().positive(),
      })
      .strict(),
  )
  .default([]);
/** The record a record page renders, which its layout's publication can include. */
export const pageRecordInput = z.object({ collectionId: z.string(), id: uuidv7Schema }).strict();
export const pageReferenceTargetsInput = z.object({
  id: z.number(),
  /** Also publish the page's layout. */
  alsoPublishLayout: z.boolean().optional(),
});
export const layoutReferenceTargetsInput = z.object({
  /** A layout is named within a project, in the request's environment. */
  projectId: z.number(),
  layoutId: z.string(),
  /** The record of the record page being published. */
  pageRecord: pageRecordInput.optional(),
  /** `false` publishes the selected records without the layout. */
  includeLayout: z.boolean().optional(),
});
