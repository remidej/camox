import {
  type ToolContext,
  type ToolDefinition,
  formatToolError,
  resolveTools,
  toJsonSchemaTool,
  toolProviders,
} from "@camox/ai-tools";
import { Effect } from "effect";
import { z } from "zod";

import { getAuthorizedProject, requireUser } from "../../authorization";
import { decodeInput, type ServiceError } from "../../lib/errors";
import type { ServiceContext } from "../_shared/service-context";

// --- Input Schemas ---

export const callToolInput = z.object({
  projectId: z.number(),
  name: z.string(),
  arguments: z.unknown(),
});

export const listToolsInput = z.object({ projectId: z.number() });

// --- Helpers ---

export const buildToolContext = Effect.fn("agent.buildToolContext")(function* (
  ctx: ServiceContext,
  projectId: number,
): Effect.fn.Return<ToolContext, ServiceError> {
  const user = yield* requireUser(ctx);
  yield* getAuthorizedProject(ctx.db, projectId, user.id);
  return {
    db: ctx.db,
    user,
    env: ctx.env,
    waitUntil: ctx.waitUntil,
    environmentName: ctx.environmentName,
    client: ctx.client,
    telemetryDisabled: ctx.telemetryDisabled,
    projectId,
  };
});

function findTool(tools: ToolDefinition[], name: string) {
  return tools.find((t) => t.name === name) ?? null;
}

export type ToolExecutionResponse =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

export const executeTool = Effect.fn("agent.executeTool")(function* (params: {
  toolCtx: ToolContext;
  tools: ToolDefinition[];
  name: string;
  args: unknown;
}): Effect.fn.Return<ToolExecutionResponse> {
  const { toolCtx, tools, name, args } = params;
  const tool = findTool(tools, name);
  if (!tool) {
    return {
      ok: false,
      error: {
        code: "UNKNOWN_TOOL",
        message: `Unknown tool: ${name}`,
        details: { available: tools.map((t) => t.name) },
      },
    };
  }

  return yield* Effect.tryPromise({
    try: async () => tool.handler(tool.inputSchema.parse(args ?? {}), toolCtx),
    catch: (err) => err,
  }).pipe(
    Effect.match({
      onSuccess: (result): ToolExecutionResponse => ({ ok: true, result }),
      onFailure: (err): ToolExecutionResponse => ({ ok: false, error: formatToolError(err) }),
    }),
  );
});

// --- Procedures ---

/**
 * Surface the resolved tool list as JSON Schema. Adapters that need to render
 * a flat list (CLI `tools list`, future MCP `tools/list`) can call this.
 */
export const listTools = Effect.fn("agent.listTools")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof listToolsInput>,
) {
  const { projectId } = yield* decodeInput(listToolsInput, rawInput);
  const toolCtx = yield* buildToolContext(ctx, projectId);
  const tools = yield* Effect.promise(() => resolveTools(toolProviders, toolCtx));
  return tools.map(toJsonSchemaTool);
});

/**
 * Adapter-agnostic tool dispatch. Validates input via Zod, runs the handler,
 * and either returns the tool result or a structured error (no throw on
 * tool-side failures — the LLM/CLI consumer needs to read the error to retry).
 *
 * Auth and project membership are checked in `buildToolContext` and surface as
 * typed service errors so the transport's error path handles them.
 */
export const callTool = Effect.fn("agent.callTool")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof callToolInput>,
) {
  const { projectId, name, arguments: args } = yield* decodeInput(callToolInput, rawInput);
  const toolCtx = yield* buildToolContext(ctx, projectId);

  const tools = yield* Effect.promise(() => resolveTools(toolProviders, toolCtx));
  return yield* executeTool({ toolCtx, tools, name, args });
});
