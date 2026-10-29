import { localizedPath, parseLocalePath } from "@camox/api-contract/locales";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { runService } from "../../lib/run-service";
import { listLocales } from "../locales/service";
import { getPageMarkdownAt } from "../pages/service";
import { draftArgument } from "./draft-ref";
import { WEBSITE_SCOPE } from "./oauth";
import { registerProjectTool } from "./projects";
import type { ConnectedAgentCall } from "./routes";
import { memberServiceContext, toolAnswer, toolRefusal } from "./tools";

/**
 * `read_page`: a page as its Markdown Representation, on Live or in a draft, in any locale
 * (ADR 0030). It reuses the page-Markdown read the website's `.md` routes use.
 */
export function registerReadPage(server: McpServer, call: ConnectedAgentCall) {
  registerProjectTool(
    server,
    call,
    "read_page",
    {
      title: "Read page",
      description:
        "A page of the website as text, as it reads on Live or in a draft. Read it to check the website's copy before asking for changes.",
      inputSchema: {
        path: z
          .string()
          .describe("The page's path, as `get_website` lists it, such as `/pricing`."),
        draft: draftArgument
          .optional()
          .describe(
            "A draft to read the page in, by its id or a studio link to it, which names its website. Live when left out.",
          ),
        locale: z
          .string()
          .optional()
          .describe(
            "The locale to read the page in, by its tag, such as `fr`. The website's default locale when left out.",
          ),
      },
      scope: WEBSITE_SCOPE,
      readOnly: true,
    },
    async ({ project, draft }, { path, locale: tag }) => {
      const ctx = memberServiceContext(call, draft?.id);
      let requested = path;
      if (tag !== undefined) {
        const locales = await runService(listLocales(ctx, { projectId: project.id }));
        const locale = locales.find((locale) => locale.tag.toLowerCase() === tag.toLowerCase());
        if (!locale) {
          const tags = locales.map((locale) => locale.tag).join(", ");
          return toolRefusal(`The website has no locale "${tag}". Its locales are: ${tags}.`);
        }
        // A path already under the locale's prefix stays as it is.
        if (parseLocalePath(path, locales).locale.tag !== locale.tag) {
          requested = localizedPath(path, locale);
        }
      }
      const read = await runService(
        getPageMarkdownAt(ctx, { projectUuid: project.uuid, path: requested }),
      );
      if (!read.page) return toolRefusal(`There's no page at ${requested}.`);
      return toolAnswer({
        path: localizedPath(read.path, read.locale),
        locale: read.locale.tag,
        markdown: read.markdown,
      });
    },
  );
}
