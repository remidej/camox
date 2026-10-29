import { createResourceServerChallenge } from "@better-auth/oauth-provider";
import { type AuthInfo, createMcpHandler, type ProtocolEra } from "@modelcontextprotocol/server";
import { APIError } from "better-auth/api";
import { verifyJwsAccessToken } from "better-auth/oauth2";
import { Hono } from "hono";

import type { Database } from "../../db";
import type { AppEnv, Bindings } from "../../types";
import { createAuth } from "../auth/routes";
import { memberChanges } from "./changes";
import { type ConnectedMember, loadConnectedMember } from "./member";
import { issuerOf, mcpResourceOf, REQUESTED_SCOPES, servesMcp } from "./oauth";
import { connectedAgentServer } from "./server";

/** A Connected Agent's call, verified: the member it acts as, and what services run with. */
export type ConnectedAgentCall = {
  member: ConnectedMember;
  /** The OAuth client id of the Connected Agent's app, which its token was issued to. */
  clientId: string;
  db: Database;
  env: Bindings;
  waitUntil: (promise: Promise<unknown>) => void;
  apiOrigin: string;
  /** The MCP revisions the call speaks: 2025-era (`legacy`) or 2026-07-28 and later (`modern`). */
  era: ProtocolEra;
};

const unauthorized = (message: string) => new APIError("UNAUTHORIZED", { message });

/**
 * The `401` (or `403`) that tells a Connected Agent how to get a token: its `WWW-Authenticate`
 * names the server's Protected Resource Metadata, and the scopes to ask for.
 */
function challenge(error: unknown, resource: string) {
  const answer = createResourceServerChallenge(error, resource, {
    challengeScopes: REQUESTED_SCOPES,
  });
  if (!answer) throw error;
  const headers = new Headers(answer.headers);
  headers.set("content-type", "application/json");
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: answer.message }, id: null }),
    { status: answer.statusCode, headers },
  );
}

/**
 * The claims of the request's access token, verified in-process against the authorization
 * server's own keys: signed by it, unexpired, and issued for this MCP server and no other.
 */
async function verifiedClaims(
  request: Request,
  auth: ReturnType<typeof createAuth>,
  origin: string,
) {
  const token = /^Bearer (\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) throw unauthorized("An access token is required");
  try {
    const claims = await verifyJwsAccessToken(token, {
      jwksFetch: () => auth.api.getJwks(),
      verifyOptions: {
        issuer: issuerOf(origin),
        audience: mcpResourceOf(origin),
        requiredClaims: ["sub", "azp"],
      },
    });
    // Tokens bound to a DPoP key need a proof this server doesn't check.
    if (claims.cnf) throw unauthorized("DPoP-bound tokens aren't supported");
    return { token, claims };
  } catch {
    throw unauthorized("The access token isn't valid for this server");
  }
}

/**
 * The MCP server Connected Agents call (ADR 0030), over Streamable HTTP. Every call verifies its
 * token and loads the member it acts as, then runs in-process as them: the token never goes
 * further.
 */
export const mcpRoutes = new Hono<AppEnv>().all("/", async (c) => {
  const origin = new URL(c.req.url).origin;
  if (!servesMcp(origin)) return c.notFound();
  const resource = mcpResourceOf(origin);
  const auth = createAuth(c.var.db, c.env, origin);
  try {
    const { token, claims } = await verifiedClaims(c.req.raw, auth, origin);
    const member = await loadConnectedMember(c.var.db, claims.sub!);
    if (!member) throw unauthorized("The member this token was issued to no longer exists");
    const call: Omit<ConnectedAgentCall, "era"> = {
      member,
      clientId: String(claims.azp),
      db: c.var.db,
      env: c.env,
      waitUntil: (promise) => c.executionCtx.waitUntil(promise),
      apiOrigin: origin,
    };
    const authInfo: AuthInfo = {
      token,
      clientId: call.clientId,
      scopes: typeof claims.scope === "string" ? claims.scope.split(" ") : [],
      expiresAt: claims.exp,
      resource: new URL(resource),
    };
    // A handler per call, so a subscription hears of its own member's changes only.
    const handler = createMcpHandler(({ era }) => connectedAgentServer({ ...call, era }), {
      bus: memberChanges(call),
    });
    return await handler.fetch(c.req.raw, { authInfo });
  } catch (error) {
    return challenge(error, resource);
  }
});

/**
 * The discovery documents at the root of the API: the MCP server's Protected Resource Metadata,
 * and the authorization server's metadata, which Better Auth serves.
 */
export const wellKnownRoutes = new Hono<AppEnv>().get("/*", (c) =>
  createAuth(c.var.db, c.env, new URL(c.req.url).origin).handler(c.req.raw),
);
