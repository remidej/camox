import { ORPCError } from "@orpc/server";
import { ZodError, type core } from "zod";

import type { ToolDefinition } from "./types";

export type ToolError = {
  code: string;
  message: string;
  details?: unknown;
};

/** A tool's result that doesn't match its declared output: a bug in the tool, not the call. */
export class ToolOutputError extends Error {
  constructor(
    readonly tool: string,
    readonly issues: core.$ZodIssue[],
  ) {
    super(`The ${tool} tool returned output that doesn't match its output schema.`);
  }
}

/** A tool's result, once it matches the tool's declared output. */
export function checkToolOutput(tool: ToolDefinition, result: unknown): unknown {
  const checked = tool.outputSchema.safeParse(result);
  if (!checked.success) throw new ToolOutputError(tool.name, checked.error.issues);
  return result;
}

/**
 * Normalize tool-handler failures into a stable JSON shape. LLMs read this
 * as a tool result and self-correct over the next 1–2 turns.
 */
export function formatToolError(err: unknown): ToolError {
  if (err instanceof ToolOutputError) {
    return {
      code: "INVALID_OUTPUT",
      message: err.message,
      details: { tool: err.tool, issues: err.issues },
    };
  }
  if (err instanceof ZodError) {
    return {
      code: "INVALID_INPUT",
      message: "Input did not match the tool's schema.",
      details: err.issues,
    };
  }
  if (err instanceof ORPCError) {
    return {
      code: err.code,
      message: err.message,
      details: err.data ?? undefined,
    };
  }
  if (err instanceof Error) {
    return { code: "INTERNAL_ERROR", message: err.message };
  }
  return { code: "INTERNAL_ERROR", message: String(err) };
}
