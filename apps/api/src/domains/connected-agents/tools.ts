import type { CallToolResult, ScopeChallengeHandler } from "@modelcontextprotocol/server";
import { ORPCError } from "@orpc/server";

import type { ServiceContext } from "../_shared/service-context";
import type { DraftRequest } from "../drafts/scope";
import { REQUESTED_SCOPES } from "./oauth";
import type { ConnectedAgentCall } from "./routes";

// What every tool of the MCP server shares: how it answers, refuses, checks its scope, and runs
// Camox's services as the member.

/** A tool's answer: what it read, as JSON the Connected Agent reads as text. */
export const toolAnswer = (value: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
});

/** A tool's refusal, which the Connected Agent reads and can act on. */
export const toolRefusal = (message: string): CallToolResult => ({
  isError: true,
  content: [{ type: "text", text: message }],
});

/** A service's refusal (an error of the caller's making) as the tool's. Anything else is thrown again. */
export function serviceRefusal(error: unknown): CallToolResult {
  if (error instanceof ORPCError && error.status < 500) return toolRefusal(error.message);
  throw error;
}

/**
 * Refuses a call whose token lacks `scope` with a `403` asking for both Connected Agent scopes,
 * which a consent grants together: the Connected Agent connects again to get them.
 */
export const requireScope =
  (scope: string): ScopeChallengeHandler =>
  ({ authInfo }) =>
    authInfo && !authInfo.scopes.includes(scope)
      ? {
          scopes: REQUESTED_SCOPES as [string, ...string[]],
          errorDescription: `This tool needs the ${scope} scope`,
        }
      : undefined;

/**
 * The context Camox's services run in for a Connected Agent's call: as its member, on Live, or in
 * the open draft `draftId`.
 */
export function memberServiceContext(
  call: ConnectedAgentCall,
  draftId: string,
): ServiceContext & { draft: DraftRequest };
export function memberServiceContext(call: ConnectedAgentCall, draftId?: string): ServiceContext;
export function memberServiceContext(call: ConnectedAgentCall, draftId?: string): ServiceContext {
  return {
    db: call.db,
    user: call.member.user,
    env: call.env,
    waitUntil: call.waitUntil,
    client: "connected-agent",
    telemetryDisabled: false,
    draft: draftId ? { id: draftId, create: false } : null,
    apiOrigin: call.apiOrigin,
  };
}
