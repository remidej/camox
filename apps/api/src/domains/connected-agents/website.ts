import { projectWebsiteUrl } from "@camox/api-contract/projects";
import type { McpServer } from "@modelcontextprotocol/server";
import { Effect } from "effect";

import { runService } from "../../lib/run-service";
import { listLocales } from "../locales/service";
import { listPages } from "../pages/service";
import { memberServiceContext, registerProjectTool, toolAnswer } from "./projects";
import type { ConnectedAgentCall } from "./routes";

/** `get_website`: an overview of a website, at the level of its pages (ADR 0030). */
export function registerWebsiteTools(server: McpServer, call: ConnectedAgentCall) {
  registerProjectTool(
    server,
    call,
    "get_website",
    {
      title: "Get website",
      description:
        "An overview of the website on Live: its name, its address, its locales, and its pages with their paths and nicknames. Read it to know what already exists before asking for changes.",
      inputSchema: {},
      readOnly: true,
    },
    async ({ project }) => {
      const ctx = memberServiceContext(call);
      const [pages, locales] = await runService(
        Effect.all([
          listPages(ctx, { projectId: project.id }),
          listLocales(ctx, { projectId: project.id }),
        ]),
      );
      return toolAnswer({
        name: project.name,
        address: projectWebsiteUrl(project),
        locales: locales.map(({ tag, isDefault }) => ({ tag, default: isDefault })),
        pages: pages.map((page) => ({ path: page.fullPath, nickname: page.nickname })),
      });
    },
  );
}
