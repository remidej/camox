import type { ZodType } from "zod";

import type { ServiceContext } from "../../../apps/api/src/domains/_shared/service-context";

// Wraps the api-side ServiceContext and adds the session-scoped projectId.
// The adapter (MCP / agent / CLI) resolves projectId at session entry and
// injects it here so individual tools don't take it as input.
export type ToolContext = ServiceContext & {
  projectId: number;
};

export type ToolSurface = "cli";

export type ToolRisk = "safe" | "requiresApproval";

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: ZodType;
  outputSchema?: ZodType;
  handler: (input: unknown, ctx: ToolContext) => Promise<unknown>;
  meta: {
    /** A write changes content, so it needs a draft: Live is read-only (ADR 0003). */
    kind: "read" | "write";
    /**
     * Reads or writes content stored per locale (ADR 0015): the tool takes an optional `locale`,
     * and acts in the default locale without one.
     */
    localized?: boolean;
    risk: ToolRisk;
    surfaces: ToolSurface[];
  };
};

export type ToolProvider = (ctx: ToolContext) => ToolDefinition[] | Promise<ToolDefinition[]>;
