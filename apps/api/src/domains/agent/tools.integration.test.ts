import { defineTool, localesProvider, type ToolContext } from "@camox/ai-tools";
import { call } from "@orpc/server";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { createProjectFixture, createRpcContext } from "../../../test/fixtures";
import { router } from "../../router";
import { executeTool } from "./service";

async function fixture() {
  const base = await createProjectFixture(`agent-tools-${crypto.randomUUID()}`);
  const member = () => ({ context: createRpcContext(base.db, base.memberUser) });
  return { ...base, member };
}

describe("AI tool outputs", () => {
  it("lists every tool with the JSON Schema of its output", async () => {
    const f = await fixture();
    const tools = await call(router.agent.listTools, { projectId: f.project.id }, f.member());

    // A script creating a page reads the new page's id to add blocks to it, and can rely on
    // nothing beyond what's declared.
    expect(tools.find((tool) => tool.name === "createPage")?.outputSchema).toMatchObject({
      type: "object",
      properties: {
        page: {
          type: "object",
          properties: { id: { type: "string" } },
          additionalProperties: false,
        },
        fullPath: { type: "string" },
      },
      additionalProperties: false,
    });
  });

  it("fails a tool whose handler returns something other than its declared output", async () => {
    const drifted = defineTool({
      name: "countPages",
      description: "Count the project's pages.",
      inputSchema: z.object({}),
      outputSchema: z.object({ count: z.number() }),
      meta: { kind: "read", risk: "safe", surfaces: ["cli"] },
      // A handler drifting from its declaration, as the type check can't see through `unknown`.
      handler: async () => ({ count: "three" }) as unknown as { count: number },
    });

    const response = await Effect.runPromise(
      executeTool({ toolCtx: {} as ToolContext, tools: [drifted], name: "countPages", args: {} }),
    );

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_OUTPUT",
        message: expect.stringContaining("countPages"),
        details: { tool: "countPages", issues: [{ path: ["count"] }] },
      },
    });
  });

  it("fails a tool whose handler returns fields its output doesn't declare", async () => {
    const toolCtx = {} as ToolContext;
    const listLocales = (await localesProvider(toolCtx)).find(
      (tool) => tool.name === "listLocales",
    )!;
    // The real declaration, with a handler leaking a column the declaration leaves out.
    const leaky = {
      ...listLocales,
      handler: async () => [{ tag: "en", isDefault: true, rowId: 1 }],
    };

    const response = await Effect.runPromise(
      executeTool({ toolCtx, tools: [leaky], name: "listLocales", args: {} }),
    );

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_OUTPUT",
        details: { tool: "listLocales", issues: [{ code: "unrecognized_keys", keys: ["rowId"] }] },
      },
    });
  });
});
