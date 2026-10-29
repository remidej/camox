import { McpServer } from "@modelcontextprotocol/server";

import { registerDraftTools } from "./drafts";
import { WORKING_WITH_CAMOX } from "./guidance";
import type { ConnectedAgentCall } from "./routes";
import { registerWebsiteTools } from "./website";

/**
 * Camox's MCP server as one call's member sees it (ADR 0030): built for each call, so its tools
 * are shaped by the member's projects as they are now. Every tool is registered here.
 */
export function connectedAgentServer(call: ConnectedAgentCall) {
  const server = new McpServer(
    { name: "camox", title: "Camox", version: "1.0.0" },
    { instructions: serverInstructions(call) },
  );
  registerWebsiteTools(server, call);
  registerDraftTools(server, call);
  return server;
}

/**
 * The server's instructions for the call's member: parts, each written on its own, joined in
 * order. How to work with Camox is the same for every member.
 */
function serverInstructions(_call: ConnectedAgentCall) {
  return [WORKING_WITH_CAMOX].join("\n\n");
}
