import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolRegistration } from "@earendil-works/pi-durable";

import type { ToolInvocation } from "../threads/tools";
import type { BuildResult } from "./result";

/**
 * The agent's `build`, which builds its code changes and, when they pass, commits them as the
 * draft's new revision. `build` runs it for the call: the thread knows its draft and run.
 */
export const buildTool = (build: (invocation: ToolInvocation) => Promise<BuildResult>) =>
  defineTool({
    name: "build",
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
  }) as unknown as ToolRegistration;
