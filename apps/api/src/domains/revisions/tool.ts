import { BUILD_TOOL } from "@camox/api-contract/threads";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolRegistration } from "@earendil-works/pi-durable";

import type { ToolInvocation } from "../threads/tools";
import type { BuildResult } from "./result";

/**
 * The agent's `conflicts`, which lists the files that still have merge conflict markers, as a
 * merge of Live's code that conflicts leaves them. `list` lists them in the thread's draft.
 */
export const conflictsTool = (list: () => Promise<string[]>): ToolRegistration =>
  defineTool({
    name: "conflicts",
    description:
      "List the files that still have merge conflict markers, as merging Live's code into the " +
      "draft's leaves them when both changed the same lines. Returns JSON: an array of paths, " +
      "empty when no file has markers. `build` refuses to commit while any file has them.",
    parameters: Type.Object({}),
    replay: "safe",
    async execute() {
      const files = await list();
      return { output: [{ type: "text" as const, text: JSON.stringify(files) }] };
    },
  });

/**
 * The agent's `build`, which builds its code changes and, when they pass, commits them as the
 * draft's new revision. `build` runs it for the call: the thread knows its draft and run.
 */
export const buildTool = (
  build: (invocation: ToolInvocation) => Promise<BuildResult>,
): ToolRegistration =>
  defineTool({
    name: BUILD_TOOL,
    description:
      "Build the website with your code changes. When the build passes, your changes become the " +
      "draft's new revision, which the preview shows. Returns JSON: `ok`, the `revision` a passing " +
      "build made, and the `build`, `types` and `lint` errors, each with its file and line, " +
      "capped with their totals in `truncated`. Build whenever you need your changes, such as " +
      "before placing content in a block you just wrote. Building changes that already built " +
      "returns their revision at once.",
    parameters: Type.Object({}),
    async execute(_args, api, context) {
      const result = await build({ api, context });
      return { output: [{ type: "text" as const, text: JSON.stringify(result) }] };
    },
  });
