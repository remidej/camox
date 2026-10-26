import type { ToolRegistration } from "@earendil-works/pi-durable";
import { webFetchTool } from "agents/webfetch/pi";
import { webSearchTool } from "agents/websearch/pi";

import type { Bindings } from "../../types";

/**
 * The agent's tools for the web, from Cloudflare's Agents SDK, both through the Workers AI
 * binding: `web_search` searches with Cloudflare's Web Search API through Exa (better results
 * than the default Ceramic provider), billed to the account's default AI Gateway, and
 * `web_fetch` reads a public page, converted to Markdown.
 *
 * Only the model calls them, not code mode scripts, whose tools are for content (ADR 0018): a
 * page reaches the model marked as untrusted, and never through a script's output.
 */
export const webTools = (env: Bindings): ToolRegistration[] =>
  [webSearchTool({ binding: env.AI, provider: "exa" }), webFetchTool({ binding: env.AI })].map(
    (tool): ToolRegistration => ({ ...tool, callers: ["model"] }),
  );
