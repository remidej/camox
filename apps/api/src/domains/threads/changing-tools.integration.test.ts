import { resolveTools, type ToolContext, toolProviders } from "@camox/ai-tools";
import { CHANGING_TOOLS } from "@camox/api-contract/threads";
import { describe, expect, it } from "vite-plus/test";

import { CODE_WRITES } from "../code/tools";

describe("the tools a thread says change the draft", () => {
  it("are exactly the tools the agent writes with, content and code", async () => {
    // Only the declarations are read: the handlers never run.
    const tools = await resolveTools(toolProviders, {} as ToolContext, "studio-agent");
    const writes = [
      ...tools.filter((tool) => tool.meta.kind === "write").map((tool) => tool.name),
      ...CODE_WRITES.map((tool) => tool.name),
    ];

    expect([...CHANGING_TOOLS].toSorted()).toEqual(writes.toSorted());
  });
});
