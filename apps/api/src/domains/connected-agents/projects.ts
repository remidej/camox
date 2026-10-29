import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import type { ServiceContext } from "../_shared/service-context";
import type { MemberProject } from "./member";
import type { ConnectedAgentCall } from "./routes";

/** A tool's answer: what it read, as JSON the Connected Agent reads as text. */
export const toolAnswer = (value: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
});

/** A tool's refusal, which the Connected Agent reads and can act on. */
export const toolRefusal = (message: string): CallToolResult => ({
  isError: true,
  content: [{ type: "text", text: message }],
});

/** The context Camox's services run in for a Connected Agent's call: as its member, on Live. */
export function memberServiceContext(call: ConnectedAgentCall): ServiceContext {
  return {
    db: call.db,
    user: call.member.user,
    env: call.env,
    waitUntil: call.waitUntil,
    client: "connected-agent",
    telemetryDisabled: false,
    draft: null,
    apiOrigin: call.apiOrigin,
  };
}

/**
 * The one way tools take the project they act on (ADR 0030). A member with exactly one project
 * gets tools with no `project` argument: the server fills it in. With several, `project` names
 * one of theirs by its Project Slug.
 */
function projectArgument(call: ConnectedAgentCall) {
  const { projects } = call.member;
  if (projects.length === 1) {
    return { shape: {}, resolve: () => projects[0]! };
  }
  const slugs = projects.map(({ project }) => project.slug);
  return {
    shape: slugs.length ? { project: z.enum(slugs as [string, ...string[]]) } : {},
    resolve: (args: { project?: string }) =>
      projects.find(({ project }) => project.slug === args.project),
  };
}

/**
 * Registers a tool that acts on one of the member's projects, taking it the shared way. The
 * handler gets the project, re-read with the member's role on this call, and the tool's other
 * arguments. A service's refusal becomes the tool's.
 */
export function registerProjectTool<Shape extends z.ZodRawShape>(
  server: McpServer,
  call: ConnectedAgentCall,
  name: string,
  config: { title: string; description: string; inputSchema: Shape; readOnly?: boolean },
  handler: (project: MemberProject, args: z.infer<z.ZodObject<Shape>>) => Promise<CallToolResult>,
) {
  const argument = projectArgument(call);
  server.registerTool(
    name,
    {
      title: config.title,
      description: config.description,
      inputSchema: z.object({ ...config.inputSchema, ...argument.shape }),
      annotations: { readOnlyHint: config.readOnly ?? false, openWorldHint: false },
    },
    async (args: Record<string, unknown>) => {
      const project = argument.resolve(args as { project?: string });
      if (!project) {
        return toolRefusal(
          `You aren't a member of any Camox project yet. Create one in the Dashboard: ${call.env.DASHBOARD_URL}`,
        );
      }
      try {
        return await handler(project, args as z.infer<z.ZodObject<Shape>>);
      } catch (error) {
        if (error instanceof ORPCError && error.status < 500) return toolRefusal(error.message);
        throw error;
      }
    },
  );
}
