import { Effect } from "effect";
import { z } from "zod";

import * as collections from "../../../../apps/api/src/domains/collections/service";
import { getProject } from "../../../../apps/api/src/domains/projects/service";
import { runService } from "../../../../apps/api/src/lib/run-service";
import { collectionRecord } from "../lib/outputs";
import { defineTool, type ToolProvider } from "../types";

const listInput = collections.listCollectionDefinitionsInput.omit({ projectSlug: true });
const definitionInput = collections.getCollectionDefinitionInput.omit({ projectSlug: true });
const recordInput = collections.getCollectionRecordInput.omit({ projectSlug: true });
const createInput = collections.createRecordInput.omit({ projectSlug: true });
const editInput = collections.editRecordInput.omit({ projectSlug: true });
const deleteInput = collections.deleteRecordInput.omit({ projectSlug: true });

const collectionSummary = z.object({
  collectionId: z.string(),
  title: z.string(),
  description: z.string(),
  label: z.string(),
});

export const collectionsProvider: ToolProvider = (ctx) => {
  // Never accept a caller-supplied project scope. Membership is checked here and
  // by each service; the session's draft is passed through unchanged.
  const scope = getProject(ctx, { id: ctx.projectId }).pipe(
    Effect.map((project) => ({ projectSlug: project.slug })),
  );
  return [
    defineTool({
      name: "listCollections",
      description: "List the code-defined collections in this project.",
      inputSchema: listInput,
      outputSchema: z.array(collectionSummary),
      meta: { kind: "read", risk: "safe", surfaces: ["cli"] },
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
      outputSchema: collectionSummary.extend({ contentSchema: z.record(z.string(), z.unknown()) }),
      meta: { kind: "read", risk: "safe", surfaces: ["cli"] },
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
        z.object({ id: z.string(), label: z.string(), duplicatePageValue: z.boolean() }),
      ),
      meta: { kind: "read", risk: "safe", surfaces: ["cli"], localized: true },
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
      outputSchema: collectionRecord,
      meta: { kind: "read", risk: "safe", surfaces: ["cli"], localized: true },
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
      outputSchema: collectionRecord,
      meta: { kind: "write", risk: "safe", surfaces: ["cli"], localized: true },
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
      outputSchema: collectionRecord,
      meta: { kind: "write", risk: "safe", surfaces: ["cli"], localized: true },
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
      outputSchema: z.object({ id: z.string() }),
      meta: { kind: "write", risk: "requiresApproval", surfaces: ["cli"], localized: true },
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
