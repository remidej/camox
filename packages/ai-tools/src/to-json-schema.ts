import { z } from "zod";

import type { ToolDefinition } from "./types";

export type JsonSchemaTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
};

/**
 * Adapter helper for surfaces that need plain JSON Schema (MCP `tools/list`,
 * CLI `tools list`). Converts the registry's Zod schemas to JSON Schema at
 * emit time so the registry stays a single source of truth.
 */
export function toJsonSchemaTool(def: ToolDefinition): JsonSchemaTool {
  return {
    name: def.name,
    description: def.description,
    inputSchema: z.toJSONSchema(def.inputSchema) as Record<string, unknown>,
    outputSchema: z.toJSONSchema(def.outputSchema, { io: "output" }) as Record<string, unknown>,
  };
}
