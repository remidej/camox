import {
  type ToolContext,
  type ToolDefinition,
  type ToolSurface,
  formatToolError,
  resolveTools,
  toolProviders,
} from "@camox/ai-tools";
import { artifactSourceTitle, UNTITLED_ARTIFACT } from "@camox/api-contract";
import { CAMOX_ACTOR } from "@camox/api-contract/drafts";
import type { Touch } from "@camox/api-contract/threads";
import type {
  ToolExecutionApi,
  ToolExecutionResult,
  ToolRegistration,
} from "@earendil-works/pi-durable";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import { CAMOX_USER } from "../../authorization";
import { createDb } from "../../db";
import { toORPCError } from "../../lib/run-service";
import { user } from "../../schema";
import type { Bindings } from "../../types";
import { agentServiceContext } from "../_shared/service-context";
import { dispatchTool, type ToolExecutionResponse } from "../agent/service";
import { touchesOf } from "./touches";

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
 * draft, or on Live, which only reads.
 */
export type ThreadActor = Pick<ThreadIdentity, "projectId" | "draftId"> & {
  userId: string;
  /** The API's public origin, which files the agent uploads are served from. */
  apiOrigin?: string;
};

/** Whether a tool reads content or writes it. */
export type ToolKind = ToolDefinition["meta"]["kind"];

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
 * A write that went through hands `touched` what it touched, for the studio to follow.
 */
export function threadToolDispatch(
  env: Bindings,
  waitUntil: (promise: Promise<unknown>) => void,
  actor: (invocation: ToolInvocation, kind: ToolKind) => Promise<ThreadActor>,
  touched: (invocation: ToolInvocation, touches: Touch[]) => Promise<void>,
): ToolDispatch {
  return async ({ name, meta }, args, invocation) => {
    const { projectId, draftId, userId, apiOrigin } = await actor(invocation, meta.kind);
    const db = createDb(env.DB);
    const acting =
      userId === CAMOX_ACTOR
        ? CAMOX_USER
        : await db.select().from(user).where(eq(user.id, userId)).get();
    const ctx = agentServiceContext({
      db,
      env,
      user: acting ?? null,
      waitUntil,
      draftId,
      apiOrigin,
    });
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
    if (meta.kind === "write" && response.ok && draftId) {
      await Effect.runPromise(
        touchesOf(db, { projectId, draftId, name, args, result: response.result }),
      )
        .then((touches) => (touches.length > 0 ? touched(invocation, touches) : undefined))
        .catch((error: unknown) =>
          console.error("A thread couldn't record what a write touched", error),
        );
    }
    return response;
  };
}

/** How a thread's tools show an Artifact Source they leave out, which starts with this. */
const LEFT_OUT = "[Artifact Source";

/** What a thread's tools show in place of an Artifact Source: its title, and where it went. */
const leftOut = (source: string) =>
  `${LEFT_OUT} ${JSON.stringify(artifactSourceTitle(source) ?? UNTITLED_ARTIFACT)}, left out: ` +
  "the artifact tool hands it to its Artifact Agent]";

/**
 * `value`, a tool's result, with every Artifact Source its blocks and Repeatable Items hold left
 * out: an Artifact Agent writes each in a conversation of its own (ADR 0035), so the thread's
 * agent never carries them. A block or item names the fields holding one in `artifactHashes`.
 */
export function withoutArtifactSources(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutArtifactSources);
  if (!value || typeof value !== "object") return value;
  const entries = Object.entries(value).map(([key, inner]) => [key, withoutArtifactSources(inner)]);
  const result = Object.fromEntries(entries) as Record<string, unknown>;
  const { artifactHashes, content } = result;
  if (!artifactHashes || typeof artifactHashes !== "object") return result;
  if (!content || typeof content !== "object" || Array.isArray(content)) return result;
  const shown = { ...(content as Record<string, unknown>) };
  for (const field of Object.keys(artifactHashes)) {
    const source = shown[field];
    if (typeof source === "string") shown[field] = leftOut(source);
  }
  return { ...result, content: shown };
}

/**
 * One of the studio agent's tools as a Pi tool that only code mode scripts call (ADR 0018): its
 * Zod input and output as JSON Schema, which Pi turns into the scripts' TypeScript declarations.
 * Calls run through `dispatch`, where `dispatchTool` checks membership and Zod validates inputs,
 * and a failure reaches the script as its structured error. Reads are replay-safe: rerunning one
 * after an eviction changes nothing. Results leave Artifact Sources out
 * (`withoutArtifactSources`), and a write handing one back as it was left out is refused, rather
 * than store it as the source.
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
      if (tool.meta.kind === "write" && JSON.stringify(args).includes(LEFT_OUT)) {
        const error = {
          code: "ARTIFACT_SOURCE_LEFT_OUT",
          message:
            "An Artifact Source you read was left out, and can't be written back: leave " +
            "artifact fields out of the write, and change sources with the artifact tool.",
        };
        return { output: [{ type: "text", text: JSON.stringify(error) }], isError: true };
      }
      const response = await dispatch(tool, args, { api, context });
      if (!response.ok) {
        return { output: [{ type: "text", text: JSON.stringify(response.error) }], isError: true };
      }
      // The result matched the tool's output schema, which is JSON Schema, so it's JSON already.
      const result = withoutArtifactSources(
        response.result ?? null,
      ) as ToolExecutionResult["structuredOutput"];
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
 * publishing and deleting, or with `readOnly`, as on Live, its reads alone.
 */
export async function studioAgentTools(
  dispatch: ToolDispatch,
  { readOnly = false }: { readOnly?: boolean } = {},
): Promise<ToolRegistration[]> {
  // Only the declarations are read here: providers close over their context in handlers alone,
  // and these handlers never run, as `dispatch` resolves the tools again with the real context.
  const declarationsOnly = {} as ToolContext;
  const tools = await resolveTools(toolProviders, declarationsOnly, SURFACE);
  return tools
    .filter((tool) => !readOnly || tool.meta.kind === "read")
    .map((tool) => toPiTool(tool, dispatch));
}
