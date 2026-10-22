import { Effect } from "effect";
import { z } from "zod";

import * as collections from "../../../../apps/api/src/domains/collections/service";
import { getProject } from "../../../../apps/api/src/domains/projects/service";
import { runService } from "../../../../apps/api/src/lib/run-service";
import { collectionRecordSchema } from "../lib/outputs";
import { defineTool, type ToolProvider } from "../types";

const listInput = collections.collectionFields.list;
const definitionInput = collections.collectionFields.collection;
const recordInput = collections.collectionFields.record;
const createInput = collections.collectionFields.createRecord;
const editInput = collections.collectionFields.editRecord;
const deleteInput = collections.collectionFields.record;

const collectionSummarySchema = z.strictObject({
  collectionId: z.string(),
  title: z.string(),
  description: z.string(),
  label: z.string(),
});

export const collectionsProvider: ToolProvider = (ctx) => {
  // Never accept a caller-supplied project scope. Membership is checked here and
  // by each service; the session's draft is passed through unchanged.
  const scope = getProject(ctx, { id: ctx.projectId }).pipe(
    Effect.map((project) => ({ projectUuid: project.uuid })),
  );
  return [
    defineTool({
      name: "listCollections",
      description: "List the code-defined collections in this project.",
      inputSchema: listInput,
      outputSchema: z.array(collectionSummarySchema),
      meta: { kind: "read", surfaces: ["cli", "studio-agent"] },
      handler: async (input) => {
        listInput.parse(input);
        return runService(
          scope.pipe(
            Effect.flatMap((project) => collections.listCollectionDefinitions(ctx, project)),
          ),
        );
      },
    }),
    defineTool({
      name: "getCollection",
      description:
        "Get a collection's contentSchema and label field before creating or editing records.",
      inputSchema: definitionInput,
      outputSchema: collectionSummarySchema.extend({
        contentSchema: z.record(z.string(), z.unknown()),
      }),
      meta: { kind: "read", surfaces: ["cli", "studio-agent"] },
      handler: async (input) => {
        const parsed = definitionInput.parse(input);
        return runService(
          scope.pipe(
            Effect.flatMap((project) =>
              collections.getCollectionDefinition(ctx, { ...parsed, ...project }),
            ),
          ),
        );
      },
    }),
    defineTool({
      name: "listCollectionRecords",
      description: "List record IDs and labels, newest first.",
      inputSchema: definitionInput,
      outputSchema: z.array(
        z.strictObject({ id: z.string(), label: z.string(), duplicatePageValue: z.boolean() }),
      ),
      meta: { kind: "read", surfaces: ["cli", "studio-agent"], localized: true },
      handler: async (input) => {
        const parsed = definitionInput.parse(input);
        return runService(
          scope.pipe(
            Effect.flatMap((project) =>
              collections.listCollectionRecords(ctx, { ...parsed, ...project }),
            ),
          ),
        );
      },
    }),
    defineTool({
      name: "getCollectionRecord",
      description:
        "Read a record's current content. Files read as their current metadata alongside their _fileId.",
      inputSchema: recordInput,
      outputSchema: collectionRecordSchema,
      meta: { kind: "read", surfaces: ["cli", "studio-agent"], localized: true },
      handler: async (input) => {
        const parsed = recordInput.parse(input);
        return runService(
          scope.pipe(
            Effect.flatMap((project) =>
              collections.getCollectionRecord(ctx, { ...parsed, ...project }),
            ),
          ),
        );
      },
    }),
    defineTool({
      name: "createCollectionRecord",
      description:
        "Create a record. Supply full content matching getCollection's schema; reference fields hold a record id (or null), reference lists an array of distinct record ids from the referenced collection, and image or file fields a { _fileId } (or null).",
      inputSchema: createInput,
      outputSchema: collectionRecordSchema,
      meta: { kind: "write", surfaces: ["cli", "studio-agent"], localized: true },
      handler: async (input) => {
        const parsed = createInput.parse(input);
        return runService(
          scope.pipe(
            Effect.flatMap((project) => collections.createRecord(ctx, { ...parsed, ...project })),
          ),
        );
      },
    }),
    defineTool({
      name: "editCollectionRecord",
      description: "Replace a record's complete content, preserving omitted fields yourself.",
      inputSchema: editInput,
      outputSchema: collectionRecordSchema,
      meta: { kind: "write", surfaces: ["cli", "studio-agent"], localized: true },
      handler: async (input) => {
        const parsed = editInput.parse(input);
        return runService(
          scope.pipe(
            Effect.flatMap((project) => collections.editRecord(ctx, { ...parsed, ...project })),
          ),
        );
      },
    }),
    defineTool({
      name: "deleteCollectionRecord",
      description:
        "Permanently delete a record. Content that references it is left alone and reads the reference as empty. Files are kept.",
      inputSchema: deleteInput,
      outputSchema: z.strictObject({ id: z.string() }),
      meta: { kind: "write", surfaces: ["cli", "studio-agent"], localized: true },
      handler: async (input) => {
        const parsed = deleteInput.parse(input);
        return runService(
          scope.pipe(
            Effect.flatMap((project) => collections.deleteRecord(ctx, { ...parsed, ...project })),
          ),
        );
      },
    }),
  ];
};
