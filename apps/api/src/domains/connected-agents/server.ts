import { McpServer } from "@modelcontextprotocol/server";

import { projectInstructions, registerNoProjectTool } from "./projects";
import type { ConnectedAgentCall } from "./routes";
import { registerWebsiteTools } from "./website";

/**
 * Camox's MCP server as one call's member sees it (ADR 0030): built for each call, so its tools
 * are shaped by the member's projects as they are now. Every tool is registered here.
 */
export function connectedAgentServer(call: ConnectedAgentCall) {
  // Each part stands on its own, so parts compose by joining the ones a member gets.
  const instructions = [projectInstructions(call.member)].filter(Boolean).join("\n\n");
  const server = new McpServer(
    { name: "camox", title: "Camox", version: "1.0.0" },
    { instructions: instructions || undefined, capabilities: { tools: { listChanged: true } } },
  );
  if (!call.member.projects.length) {
    registerNoProjectTool(server, call);
    return server;
  }
  registerWebsiteTools(server, call);
  return server;
}
