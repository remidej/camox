import type { ConnectedAgentClient } from "@camox/api-contract/threads";
import { and, desc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import { requireUser } from "../../authorization";
import type { Database } from "../../db";
import { decodeInput, NotFoundError } from "../../lib/errors";
import { oauthAccessToken, oauthClient, oauthConsent, oauthRefreshToken } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";

/**
 * The app a Connected Agent runs in, as members see it, of its OAuth client's registered name and
 * how it registered: the name is verified only when it comes from a Client ID Metadata Document.
 * A client gone or registered with no name is an unnamed app.
 */
export const clientNamed = (
  name: string | null | undefined,
  discovery: string | null | undefined,
): ConnectedAgentClient => ({ name: name ?? "An unnamed app", verified: discovery === "cimd" });

/** The app a Connected Agent runs in, by its OAuth client id, if it's registered. */
export async function connectedAgentClientOf(
  db: Database,
  clientId: string,
): Promise<ConnectedAgentClient | undefined> {
  const client = await db
    .select({ name: oauthClient.name, discovery: oauthClient.clientDiscoveryId })
    .from(oauthClient)
    .where(eq(oauthClient.clientId, clientId))
    .get();
  return client && clientNamed(client.name, client.discovery);
}

/**
 * Whether the member `userId` still grants the Connected Agent `clientId` access, recording the
 * call as its last use when they do. An access token outlives a disconnection (it isn't stored),
 * so every call checks the grant it was issued under still exists.
 */
export async function recordConnectedAgentCall(db: Database, userId: string, clientId: string) {
  const granted = await db
    .update(oauthConsent)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)))
    .returning({ id: oauthConsent.id });
  return granted.length > 0;
}

export const listInput = z.object({});

/**
 * The signed-in member's Connected Agents, latest connected first: each client's name, whether
 * it's verified (only when it comes from a Client ID Metadata Document), when it was connected
 * and when it last called the MCP server.
 */
export const listConnectedAgents = Effect.fn("connectedAgents.list")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof listInput>,
) {
  const user = yield* requireUser(ctx);
  yield* decodeInput(listInput, rawInput);
  const rows = yield* Effect.promise(() =>
    ctx.db
      .select({
        id: oauthConsent.id,
        name: oauthClient.name,
        discovery: oauthClient.clientDiscoveryId,
        connectedAt: oauthConsent.createdAt,
        lastUsedAt: oauthConsent.lastUsedAt,
      })
      .from(oauthConsent)
      .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
      .where(eq(oauthConsent.userId, user.id))
      .orderBy(desc(oauthConsent.createdAt)),
  );
  return rows.map(({ id, name, discovery, connectedAt, lastUsedAt }) => ({
    id,
    client: clientNamed(name, discovery),
    connectedAt,
    lastUsedAt,
  }));
});

export const disconnectInput = z.object({ id: z.string() });

/**
 * Disconnects one of the signed-in member's Connected Agents: revokes its grant, and the tokens
 * issued under it. Its refresh is refused from now on, and so is its next MCP call, which checks
 * the grant still exists (its access token isn't stored, so it can't be deleted).
 */
export const disconnectConnectedAgent = Effect.fn("connectedAgents.disconnect")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof disconnectInput>,
) {
  const user = yield* requireUser(ctx);
  const { id } = yield* decodeInput(disconnectInput, rawInput);
  const grant = yield* Effect.promise(() =>
    ctx.db
      .select({ clientId: oauthConsent.clientId })
      .from(oauthConsent)
      .where(and(eq(oauthConsent.id, id), eq(oauthConsent.userId, user.id)))
      .get(),
  );
  if (!grant) return yield* new NotFoundError();
  const issuedUnderGrant = <T extends typeof oauthAccessToken | typeof oauthRefreshToken>(
    table: T,
  ) => and(eq(table.userId, user.id), eq(table.clientId, grant.clientId));
  yield* Effect.promise(() =>
    ctx.db.batch([
      // Access tokens point at their refresh token, so they go first.
      ctx.db.delete(oauthAccessToken).where(issuedUnderGrant(oauthAccessToken)),
      ctx.db.delete(oauthRefreshToken).where(issuedUnderGrant(oauthRefreshToken)),
      ctx.db.delete(oauthConsent).where(eq(oauthConsent.id, id)),
    ]),
  );
});
