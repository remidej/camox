import { uuidv7Schema } from "@camox/api-contract/ids";
import { Effect } from "effect";
import { z } from "zod";

import { resolveDraftScope } from "../../../../apps/api/src/domains/drafts/service";
import {
  updateFileMetadataInput,
  getProjectFile,
  listFiles,
  updateFile,
} from "../../../../apps/api/src/domains/files/service";
import { runService } from "../../../../apps/api/src/lib/run-service";
import type { ToolContext, ToolProvider } from "../types";

const target = z.object({ id: uuidv7Schema });
const updateInput = target.and(updateFileMetadataInput);

/** Tools read and write files in the draft the session names, if any. */
const draftScope = (ctx: ToolContext) => resolveDraftScope(ctx, ctx.projectId);

export const filesProvider: ToolProvider = (ctx) => [
  {
    name: "listFiles",
    description: "List media in the current project and environment.",
    inputSchema: z.object({}),
    meta: { kind: "read", risk: "safe", surfaces: ["cli"] },
    handler: async () =>
      runService(
        Effect.flatMap(draftScope(ctx), (scope) =>
          listFiles(ctx, { projectId: ctx.projectId }, scope),
        ),
      ),
  },
  {
    name: "getFile",
    description: "Get an uploaded file, including its ID, URL, alt text and AI metadata setting.",
    inputSchema: target,
    meta: { kind: "read", risk: "safe", surfaces: ["cli"] },
    handler: async (input) =>
      runService(
        Effect.flatMap(draftScope(ctx), (scope) =>
          getProjectFile(ctx, { ...target.parse(input), projectId: ctx.projectId }, scope),
        ),
      ),
  },
  {
    name: "updateFile",
    description:
      "Update a filename, alt text or automatic metadata. Renaming preserves the file ID, URL and AI setting. Providing alt text disables automatic metadata; an empty string explicitly clears alt text. Enabling AI schedules generation for raster images.",
    inputSchema: updateInput,
    meta: { kind: "write", risk: "safe", surfaces: ["cli"] },
    handler: async (input) =>
      runService(
        Effect.flatMap(draftScope(ctx), (scope) =>
          updateFile(ctx, { ...updateInput.parse(input), projectId: ctx.projectId }, scope),
        ),
      ),
  },
];
