import {
  type ToolContext,
  type ToolDefinition,
  type ToolSurface,
  formatToolError,
  resolveTools,
  toolProviders,
} from "@camox/ai-tools";
import type {
  ToolExecutionApi,
  ToolExecutionResult,
  ToolRegistration,
} from "@earendil-works/pi-durable";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import { createDb } from "../../db";
import { toORPCError } from "../../lib/run-service";
import { user } from "../../schema";
import type { Bindings } from "../../types";
import type { ServiceContext } from "../_shared/service-context";
import { dispatchTool, type ToolExecutionResponse } from "../agent/service";

/** Threads offer the tools of Camox's own agent in the studio. */
const SURFACE: ToolSurface = "studio-agent";

/**
 * What a thread belongs to: its project, its draft once it has one, and for a Live thread, the
 * editor who owns it.
 */
export const threadIdentitySchema = z.object({
  projectId: z.number(),
  draftId: z.string().nullable().default(null),
  ownerId: z.string().nullable().default(null),
});
export type ThreadIdentity = z.infer<typeof threadIdentitySchema>;

/**
 * Who a tool call acts as, and where: the editor whose message started the run, in the thread's
 * draft, or on Live. On Live, `draftToStart` is the draft the thread's first write starts.
 */
export type ThreadActor = Pick<ThreadIdentity, "projectId" | "draftId"> & {
  userId: string;
  draftToStart?: string;
};

/** One call of a Pi tool, as Pi hands it to the tool. */
export type ToolInvocation = {
  api: ToolExecutionApi;
  context: Parameters<ToolRegistration["execute"]>[2];
};

/** Runs one of the studio agent's tools, as a thread's tool calls do. */
export type ToolDispatch = (
  tool: Pick<ToolDefinition, "name" | "meta">,
  args: unknown,
  invocation: ToolInvocation,
) => Promise<ToolExecutionResponse>;

/**
 * Runs the studio agent's tools as `actor` says, building their context as the agent procedures
 * do: the acting editor's membership is checked on every call, so someone removed from the
 * project can't act through a run, and a write lands in the thread's draft, never on Live.
 * Analytics attribute the calls to the agent.
 *
 * On Live, a write starts the draft `actor` names, as an editor's first write does: the write
 * creates it. Once a write went through, `started` hears of the draft before the call returns,
 * so the thread's next calls act in it.
 */
export function threadToolDispatch(
  env: Bindings,
  waitUntil: (promise: Promise<unknown>) => void,
  actor: (invocation: ToolInvocation) => Promise<ThreadActor>,
  started: (draftId: string) => Promise<void>,
): ToolDispatch {
  return async ({ name, meta }, args, invocation) => {
    const { projectId, draftId, userId, draftToStart } = await actor(invocation);
    const starting = !draftId && meta.kind === "write" ? draftToStart : undefined;
    const db = createDb(env.DB);
    const acting = await db.select().from(user).where(eq(user.id, userId)).get();
    const ctx: ServiceContext = {
      db,
      user: acting ?? null,
      env,
      waitUntil,
      client: "camox-agent",
      telemetryDisabled: false,
      draft: draftId
        ? { id: draftId, create: false }
        : starting
          ? { id: starting, create: true }
          : null,
    };
    const response = await Effect.runPromise(
      dispatchTool(ctx, { projectId, surface: SURFACE, name, args }).pipe(
        Effect.catch((error) =>
          Effect.succeed<ToolExecutionResponse>({
            ok: false,
            error: formatToolError(toORPCError(error)),
          }),
        ),
      ),
    );
    if (starting && response.ok) await started(starting);
    return response;
  };
}

/**
 * One of the studio agent's tools as a Pi tool that only code mode scripts call (ADR 0018): its
 * Zod input and output as JSON Schema, which Pi turns into the scripts' TypeScript declarations.
 * Calls run through `dispatch`, where `dispatchTool` checks membership and Zod validates inputs,
 * and a failure reaches the script as its structured error. Reads are replay-safe: rerunning one
 * after an eviction changes nothing.
 */
export function toPiTool(tool: ToolDefinition, dispatch: ToolDispatch): ToolRegistration {
  return {
    name: tool.name,
    description: tool.description,
    parameters: jsonSchemaOf(tool.inputSchema, "input") as ToolRegistration["parameters"],
    structuredOutputSchema: jsonSchemaOf(
      tool.outputSchema,
      "output",
    ) as ToolRegistration["parameters"],
    callers: ["tools"],
    replay: tool.meta.kind === "read" ? "safe" : "unsafe",
    execute: async (args, api, context) => {
      const response = await dispatch(tool, args, { api, context });
      if (!response.ok) {
        return { output: [{ type: "text", text: JSON.stringify(response.error) }], isError: true };
      }
      // The result matched the tool's output schema, which is JSON Schema, so it's JSON already.
      const result = (response.result ?? null) as ToolExecutionResult["structuredOutput"];
      return { output: [{ type: "text", text: JSON.stringify(result) }], structuredOutput: result };
    },
  };
}

const jsonSchemaOf = (schema: z.ZodType, io: "input" | "output") => {
  const { $schema: _dialect, ...json } = z.toJSONSchema(schema, { io });
  return json;
};

/**
 * The tools the studio agent's scripts call: every tool its surface offers, which leaves out
 * publishing and discarding.
 */
export async function studioAgentTools(dispatch: ToolDispatch): Promise<ToolRegistration[]> {
  // Only the declarations are read here: providers close over their context in handlers alone,
  // and these handlers never run, as `dispatch` resolves the tools again with the real context.
  const declarationsOnly = {} as ToolContext;
  const tools = await resolveTools(toolProviders, declarationsOnly, SURFACE);
  return tools.map((tool) => toPiTool(tool, dispatch));
}
