import { withLocaleInput } from "./lib/locale-input";
import type { ToolContext, ToolDefinition, ToolProvider } from "./types";

/**
 * A localized tool taking its `locale` too. The locale reaches it through its context, so its
 * handler gets its own input.
 */
function localized(tool: ToolDefinition): ToolDefinition {
  return {
    ...tool,
    inputSchema: withLocaleInput(tool.inputSchema),
    handler: (input, ctx) => {
      const { locale: _locale, ...own } = input as Record<string, unknown>;
      return tool.handler(own, ctx);
    },
  };
}

/** The tools of every provider. */
export async function resolveTools(
  providers: ToolProvider[],
  ctx: ToolContext,
): Promise<ToolDefinition[]> {
  const lists = await Promise.all(providers.map(async (p) => p(ctx)));
  return lists.flat().map((tool) => (tool.meta.localized ? localized(tool) : tool));
}
