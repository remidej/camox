import { McpServer } from "@modelcontextprotocol/server";

import { registerDraftTools } from "./drafts";
import { registerGetDraft } from "./get-draft";
import { WORKING_WITH_CAMOX } from "./guidance";
import { projectInstructions, registerNoProjectTool } from "./projects";
import { registerReadPage } from "./read-page";
import type { ConnectedAgentCall } from "./routes";
import { registerWebsiteTools } from "./website";

/**
 * Camox's MCP server as one call's member sees it (ADR 0030): built for each call, so its tools
 * are shaped by the member's projects as they are now. Every tool is registered here.
 */
export function connectedAgentServer(call: ConnectedAgentCall) {
  const server = new McpServer(
    { name: "camox", title: "Camox", version: "1.0.0" },
    { instructions: serverInstructions(call), capabilities: { tools: { listChanged: true } } },
  );
  if (!call.member.projects.length) {
    registerNoProjectTool(server, call);
    return server;
  }
  registerWebsiteTools(server, call);
  registerReadPage(server, call);
  registerDraftTools(server, call);
  registerGetDraft(server, call);
  return server;
}

/**
 * The server's instructions for the call's member: parts, each written on its own, joined in
 * order. How to work with Camox is the same for every member; the project list only shows when
 * the member has several projects to choose from.
 */
function serverInstructions(call: ConnectedAgentCall) {
  return [WORKING_WITH_CAMOX, projectInstructions(call.member)].filter(Boolean).join("\n\n");
}
