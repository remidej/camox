import { Effect } from "effect";

import * as collections from "../../../../apps/api/src/domains/collections/service";
import { getProject } from "../../../../apps/api/src/domains/projects/service";
import { runService } from "../../../../apps/api/src/lib/run-service";
import type { ToolProvider } from "../types";

const listInput = collections.listCollectionDefinitionsInput.omit({ projectSlug: true });
const definitionInput = collections.getCollectionDefinitionInput.omit({ projectSlug: true });
const recordInput = collections.getCollectionRecordInput.omit({ projectSlug: true });
const createInput = collections.createRecordInput.omit({ projectSlug: true });
const editInput = collections.editRecordInput.omit({ projectSlug: true });
const mutationInput = collections.publishRecordInput.omit({ projectSlug: true });

export const collectionsProvider: ToolProvider = (ctx) => {
  // Never accept a caller-supplied project scope. Membership is checked here and
  // by each service; the session environment is passed through unchanged.
  const scope = getProject(ctx, { id: ctx.projectId }).pipe(
    Effect.map((project) => ({ projectSlug: project.slug })),
  );
  return [
    {
      name: "listCollections",
      description: "List active code-defined collections in this project and environment.",
      inputSchema: listInput,
      meta: { kind: "read", risk: "safe", surfaces: ["cli"] },
      handler: async (input) => {
        listInput.parse(input);
        return runService(
          scope.pipe(
            Effect.flatMap((project) => collections.listCollectionDefinitions(ctx, project)),
          ),
        );
      },
    },
    {
      name: "getCollection",
      description:
        "Get a collection's contentSchema and label field before creating or editing records.",
      inputSchema: definitionInput,
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
    },
    {
      name: "listCollectionRecords",
      description:
        "List record IDs, draft labels, publication status and optimistic-concurrency versions.",
      inputSchema: definitionInput,
      meta: { kind: "read", risk: "safe", surfaces: ["cli"] },
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
    },
    {
      name: "getCollectionRecord",
      description:
        "Read a record's saved draft and version. This is an authenticated draft read, not live content.",
      inputSchema: recordInput,
      meta: { kind: "read", risk: "safe", surfaces: ["cli"] },
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
    },
    {
      name: "createCollectionRecord",
      description:
        "Create an unpublished standalone record. Supply full content matching getCollection's schema. Publish separately.",
      inputSchema: createInput,
      meta: { kind: "write", risk: "safe", surfaces: ["cli"] },
      handler: async (input) => {
        const parsed = createInput.parse(input);
        return runService(
          scope.pipe(
            Effect.flatMap((project) => collections.createRecord(ctx, { ...parsed, ...project })),
          ),
        );
      },
    },
    {
      name: "editCollectionRecord",
      description:
        "Replace the complete saved draft, preserving omitted fields yourself. Pass its last-read expectedVersion; conflicts require rereading. Does not publish.",
      inputSchema: editInput,
      meta: { kind: "write", risk: "safe", surfaces: ["cli"] },
      handler: async (input) => {
        const parsed = editInput.parse(input);
        return runService(
          scope.pipe(
            Effect.flatMap((project) => collections.editRecord(ctx, { ...parsed, ...project })),
          ),
        );
      },
    },
    {
      name: "publishCollectionRecord",
      description:
        "Publish this standalone record's saved draft only. Pass its last-read expectedVersion. No pages, blocks or dependencies are published.",
      inputSchema: mutationInput,
      meta: { kind: "write", risk: "requiresApproval", surfaces: ["cli"] },
      handler: async (input) => {
        const parsed = mutationInput.parse(input);
        return runService(
          scope.pipe(
            Effect.flatMap((project) => collections.publishRecord(ctx, { ...parsed, ...project })),
          ),
        );
      },
    },
    {
      name: "unpublishCollectionRecord",
      description:
        "Remove the record from live reads, keeping its draft and history. Requires its last-read expectedVersion.",
      inputSchema: mutationInput,
      meta: { kind: "write", risk: "requiresApproval", surfaces: ["cli"] },
      handler: async (input) => {
        const parsed = mutationInput.parse(input);
        return runService(
          scope.pipe(
            Effect.flatMap((project) =>
              collections.unpublishRecord(ctx, { ...parsed, ...project }),
            ),
          ),
        );
      },
    },
    {
      name: "deleteCollectionRecord",
      description:
        "Permanently delete a standalone record and all its history. Media-library files are kept. Requires its last-read expectedVersion.",
      inputSchema: mutationInput,
      meta: { kind: "write", risk: "requiresApproval", surfaces: ["cli"] },
      handler: async (input) => {
        const parsed = mutationInput.parse(input);
        return runService(
          scope.pipe(
            Effect.flatMap((project) => collections.deleteRecord(ctx, { ...parsed, ...project })),
          ),
        );
      },
    },
  ];
};
