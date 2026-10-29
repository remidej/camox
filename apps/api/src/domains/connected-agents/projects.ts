import { projectWebsiteUrl } from "@camox/api-contract/projects";
import type {
  CallToolResult,
  McpServer,
  StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import { z } from "zod";

import { openDraft, type ReachedDraft } from "./draft-ref";
import type { ConnectedMember, MemberProject } from "./member";
import type { ConnectedAgentCall } from "./routes";
import { requireScope, serviceRefusal, toolRefusal } from "./tools";

/** The member's websites in plain words: each one's slug, name and address. */
const projectList = (projects: MemberProject[]) =>
  projects
    .map((project) => `${project.slug}: ${project.name}, ${projectWebsiteUrl(project)}`)
    .join("; ");

/**
 * The part of the server's instructions that names the member's websites, when they have several:
 * the Connected Agent picks one from what the member says, with no call to list them.
 */
export function projectInstructions({ projects }: ConnectedMember) {
  if (projects.length < 2) return undefined;
  const websites = projects
    .map((project) => `- ${project.name} (${projectWebsiteUrl(project)}): \`${project.slug}\``)
    .join("\n");
  return `The member has several websites on Camox:\n${websites}\n\nTools that act on a website take its slug as \`project\`. Pick the website the member means from what they say, by its name or address, and ask them only when it's unclear.`;
}

/**
 * The one way tools take the project they act on (ADR 0030). A member with exactly one project
 * gets tools with no `project` argument: the server fills it in. With several, `project` names
 * one of theirs by its Project Slug, from an enum of them.
 *
 * The enum is only what tools list. Calls accept any `project`, and it's looked up among the
 * member's projects as they are now: a client that cached an older list still reaches a project
 * it doesn't know of yet, and one that names a project the member can't reach is told theirs.
 *
 * A tool that can name a draft takes `project` only when it names none: the draft implies it.
 */
function projectArgument(call: ConnectedAgentCall, draftImpliesProject: boolean) {
  const { projects } = call.member;
  const slugs = projects.map((project) => project.slug) as [string, ...string[]];
  const which = `Which website, by its slug: ${projectList(projects)}.`;
  const listed =
    projects.length > 1
      ? {
          project: draftImpliesProject
            ? z
                .enum(slugs)
                .optional()
                .describe(`${which} Leave it out when naming a draft: the draft implies it.`)
            : z.enum(slugs).describe(which),
        }
      : {};
  const theirs = () =>
    projects.length === 1
      ? `The member's only website is ${projectList(projects)}: leave \`project\` out.`
      : `The member's websites are ${projectList(projects)}. Pass one of these slugs as \`project\`.`;

  return {
    listed,
    accepted: { project: z.string().optional() },
    /**
     * The project a call names, or why it can't be used. A call that names no project when it
     * must, or one when it needn't, or one the member can't reach, shows the client's list of
     * tools is out of date.
     */
    resolve: (
      requested: string | undefined,
    ): { project: MemberProject; outdated: boolean } | { refusal: string; outdated: boolean } => {
      if (requested === undefined) {
        return projects.length === 1
          ? { project: projects[0]!, outdated: false }
          : { refusal: `Say which website. ${theirs()}`, outdated: true };
      }
      const project = projects.find((project) => project.slug === requested);
      if (!project) {
        return {
          refusal: `The member has no website \`${requested}\` on Camox. ${theirs()}`,
          outdated: true,
        };
      }
      return { project, outdated: projects.length === 1 };
    },
  };
}

/**
 * The one tool of a member with no project: what to do before their Connected Agent can work on
 * a website. Server tools that take a project are only registered for members who have one.
 */
export function registerNoProjectTool(server: McpServer, call: ConnectedAgentCall) {
  server.registerTool(
    "get_started",
    {
      title: "Get started",
      description:
        "The member has no website on Camox yet, so nothing else can be done here. Call this to learn how they create one.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => ({
      content: [
        {
          type: "text",
          text: `The member isn't part of any Camox project yet. They can create one in the Camox Dashboard at ${call.env.DASHBOARD_URL}, or ask a teammate to invite them to theirs. Once they have one, its website can be worked on from here, with no need to reconnect.`,
        },
      ],
    }),
  );
}

/**
 * A tool's input schema that lists `listed` and validates calls against `accepted`, so tools can
 * show the member's projects without refusing a client whose list is out of date.
 */
function inputSchemaOf(
  listed: z.ZodObject,
  accepted: z.ZodObject,
): StandardSchemaWithJSON<Record<string, unknown>> {
  return {
    "~standard": {
      ...accepted["~standard"],
      jsonSchema: listed["~standard"].jsonSchema,
    },
  } as StandardSchemaWithJSON<Record<string, unknown>>;
}

/** What a project tool acts on: the project, and the open draft of it the call names, if any. */
export type ProjectTarget = { project: MemberProject; draft?: ReachedDraft };

/**
 * Registers a tool that acts on one of the member's projects, taking it the shared way, and
 * needing the token's `scope`. A tool whose `inputSchema` has a `draft` argument may name an open
 * draft instead, which implies the project. The handler gets the project as it is on this call,
 * the draft if named, and the tool's other arguments. A service's refusal becomes the tool's.
 */
export function registerProjectTool<Shape extends z.ZodRawShape>(
  server: McpServer,
  call: ConnectedAgentCall,
  name: string,
  config: {
    title: string;
    description: string;
    inputSchema: Shape;
    scope: string;
    readOnly?: boolean;
  },
  handler: (target: ProjectTarget, args: z.infer<z.ZodObject<Shape>>) => Promise<CallToolResult>,
) {
  const takesDraft = "draft" in config.inputSchema;
  const argument = projectArgument(call, takesDraft);
  server.registerTool(
    name,
    {
      title: config.title,
      description: config.description,
      inputSchema: inputSchemaOf(
        z.object({ ...config.inputSchema, ...argument.listed }),
        z.object({ ...config.inputSchema, ...argument.accepted }),
      ),
      annotations: { readOnlyHint: config.readOnly ?? false, openWorldHint: false },
      scopeChallenge: requireScope(config.scope),
    },
    async (args: Record<string, unknown>, ctx) => {
      const typed = args as z.infer<z.ZodObject<Shape>>;
      if (takesDraft && typeof args.draft === "string") {
        const reached = await openDraft(call, args.draft);
        if ("refusal" in reached) return toolRefusal(reached.refusal);
        return handler({ project: reached.draft.project, draft: reached.draft }, typed).catch(
          serviceRefusal,
        );
      }
      const resolved = argument.resolve(args.project as string | undefined);
      // Best effort: a 2025-era client can only be told on the stream of a call it made, and
      // modern clients hear of changes through their subscription instead.
      if (resolved.outdated && call.era === "legacy") {
        await ctx.mcpReq.notify({ method: "notifications/tools/list_changed" });
      }
      if ("refusal" in resolved) return toolRefusal(resolved.refusal);
      return handler({ project: resolved.project }, typed).catch(serviceRefusal);
    },
  );
}
