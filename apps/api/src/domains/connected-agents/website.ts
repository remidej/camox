import { projectWebsiteUrl } from "@camox/api-contract/projects";
import type { McpServer } from "@modelcontextprotocol/server";
import { Effect } from "effect";

import { runService } from "../../lib/run-service";
import type { ServiceContext } from "../_shared/service-context";
import { listLocales } from "../locales/service";
import { listPages } from "../pages/service";
import { WEBSITE_SCOPE } from "./oauth";
import { registerProjectTool } from "./projects";
import type { ConnectedAgentCall } from "./routes";
import { memberServiceContext, toolAnswer } from "./tools";

/** The pages and locales of the project `projectId`, as they are where `ctx` reads. */
export const pagesAndLocales = (ctx: ServiceContext, projectId: number) =>
  runService(
    Effect.all([listPages(ctx, { projectId }), listLocales(ctx, { projectId })]).pipe(
      Effect.map(([pages, locales]) => ({ pages, locales })),
    ),
  );

/** `get_website`: an overview of a website, at the level of its pages (ADR 0030). */
export function registerGetWebsite(server: McpServer, call: ConnectedAgentCall) {
  registerProjectTool(
    server,
    call,
    "get_website",
    {
      title: "Get website",
      description:
        "An overview of the website on Live: its name, its address, its locales, and its pages with their paths and nicknames. Read it to know what already exists before asking for changes.",
      inputSchema: {},
      scope: WEBSITE_SCOPE,
      readOnly: true,
    },
    async ({ project }) => {
      const { pages, locales } = await pagesAndLocales(memberServiceContext(call), project.id);
      return toolAnswer({
        name: project.name,
        address: projectWebsiteUrl(project),
        locales: locales.map(({ tag, isDefault }) => ({ tag, default: isDefault })),
        pages: pages.map((page) => ({ path: page.fullPath, nickname: page.nickname })),
      });
    },
  );
}
