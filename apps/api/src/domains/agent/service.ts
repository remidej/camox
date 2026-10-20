import {
  type ToolContext,
  type ToolDefinition,
  type ToolSurface,
  checkToolOutput,
  formatToolError,
  localeArgument,
  resolveTools,
  toJsonSchemaTool,
  toolProviders,
} from "@camox/ai-tools";
import { Effect } from "effect";
import { z } from "zod";

import { getAuthorizedProject, requireUser } from "../../authorization";
import { decodeInput, LiveReadOnlyError, type ServiceError } from "../../lib/errors";
import type { ServiceContext } from "../_shared/service-context";

/** The agent procedures serve the CLI. */
const SURFACE: ToolSurface = "cli";

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
    client: ctx.client,
    telemetryDisabled: ctx.telemetryDisabled,
    draft: ctx.draft,
    locale: ctx.locale,
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
    try: async () =>
      checkToolOutput(tool, await tool.handler(tool.inputSchema.parse(args ?? {}), toolCtx)),
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
  const tools = yield* Effect.promise(() => resolveTools(toolProviders, toolCtx, SURFACE));
  return tools.map(toJsonSchemaTool);
});

/**
 * Adapter-agnostic tool dispatch. Validates input via Zod, runs the handler, checks its result
 * against the tool's output schema, and either returns the tool result or a structured error (no
 * throw on tool-side failures — the LLM/CLI consumer needs to read the error to retry).
 *
 * Auth and project membership are checked in `buildToolContext`, and a content write naming no
 * draft is rejected as "Live is read-only"; both surface as typed service errors so the
 * transport's error path handles them.
 */
export const callTool = Effect.fn("agent.callTool")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof callToolInput>,
) {
  const { projectId, name, arguments: args } = yield* decodeInput(callToolInput, rawInput);
  const toolCtx = yield* buildToolContext(ctx, projectId);

  const tools = yield* Effect.promise(() => resolveTools(toolProviders, toolCtx, SURFACE));
  const tool = findTool(tools, name);
  // Live is read-only (ADR 0003): a tool writing content needs the session to name a draft.
  if (tool?.meta.kind === "write" && !ctx.draft) return yield* new LiveReadOnlyError();
  // A localized tool acts in the locale its arguments name (ADR 0015).
  const locale = tool?.meta.localized ? localeArgument(args) : undefined;
  if (locale === undefined) return yield* executeTool({ toolCtx, tools, name, args });
  const inLocale = { ...toolCtx, locale };
  const localized = yield* Effect.promise(() => resolveTools(toolProviders, inLocale, SURFACE));
  return yield* executeTool({ toolCtx: inLocale, tools: localized, name, args });
});
