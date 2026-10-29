import { McpServer } from "@modelcontextprotocol/server";

import type { ConnectedAgentCall } from "./routes";
import { registerWebsiteTools } from "./website";

/**
 * Camox's MCP server as one call's member sees it (ADR 0030): built for each call, so its tools
 * are shaped by the member's projects as they are now. Every tool is registered here.
 */
export function connectedAgentServer(call: ConnectedAgentCall) {
  const server = new McpServer({ name: "camox", title: "Camox", version: "1.0.0" });
  registerWebsiteTools(server, call);
  return server;
}
