import { z } from "zod";

import {
  updateFileMetadataInput,
  getProjectFile,
  listFiles,
  updateFile,
} from "../../../../apps/api/src/domains/files/service";
import type { ToolProvider } from "../types";

const target = z.object({ id: z.number().int().positive() });
const updateInput = target.and(updateFileMetadataInput);

export const filesProvider: ToolProvider = (ctx) => [
  {
    name: "listFiles",
    description: "List media in the current project and environment.",
    inputSchema: z.object({}),
    meta: { kind: "read", risk: "safe", surfaces: ["cli"] },
    handler: () => listFiles(ctx, { projectId: ctx.projectId }),
  },
  {
    name: "getFile",
    description: "Get an uploaded file, including its ID, URL, alt text and AI metadata setting.",
    inputSchema: target,
    meta: { kind: "read", risk: "safe", surfaces: ["cli"] },
    handler: (input) => getProjectFile(ctx, { ...target.parse(input), projectId: ctx.projectId }),
  },
  {
    name: "updateFile",
    description:
      "Update a filename, alt text or automatic metadata. Renaming preserves the file ID, URL and AI setting. Providing alt text disables automatic metadata; an empty string explicitly clears alt text. Enabling AI schedules generation for raster images.",
    inputSchema: updateInput,
    meta: { kind: "write", risk: "safe", surfaces: ["cli"] },
    handler: (input) => updateFile(ctx, { ...updateInput.parse(input), projectId: ctx.projectId }),
  },
];
