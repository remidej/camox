import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import type { ConnectedAgentClient } from "@camox/api-contract/threads";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import { requireUser } from "../../authorization";
import type { Database } from "../../db";
import { decodeInput, InvalidInputError, NotFoundError } from "../../lib/errors";
import { oauthClient } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
import { CONNECTED_AGENT_SCOPES, DRAFTS_SCOPE, WEBSITE_SCOPE } from "./oauth";

/**
 * The app a Connected Agent runs in, by its OAuth client id: the name it registered with, which
 * is verified only when it comes from a Client ID Metadata Document.
 */
export async function connectedAgentClientOf(
  db: Database,
  clientId: string,
): Promise<ConnectedAgentClient | undefined> {
  const client = await db
    .select({ name: oauthClient.name, discovery: oauthClient.clientDiscoveryId })
    .from(oauthClient)
    .where(eq(oauthClient.clientId, clientId))
    .get();
  return client && { name: client.name ?? "An unnamed app", verified: client.discovery === "cimd" };
}

/** What each scope lets a Connected Agent do, as the consent screen says it. */
const SCOPE_DESCRIPTIONS: Record<(typeof CONNECTED_AGENT_SCOPES)[number], string> = {
  [WEBSITE_SCOPE]: "Read your websites: their pages, drafts and their threads",
  [DRAFTS_SCOPE]: "Start drafts and continue them, asking Camox's agent for changes",
};

export const consentInput = z.object({
  /** The authorization request, as the authorization server sent the member to the screen. */
  oauthQuery: z.string(),
});

/**
 * What the consent screen shows a member authorizing a Connected Agent: the client's name, and
 * whether it's verified, which it is only when it comes from a Client ID Metadata Document; and
 * the scopes, granted together.
 */
export const consentScreen = Effect.fn("connectedAgents.consentScreen")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof consentInput>,
) {
  yield* requireUser(ctx);
  const { oauthQuery } = yield* decodeInput(consentInput, rawInput);
  const signed = yield* Effect.promise(() =>
    verifyOAuthQueryParams(oauthQuery, ctx.env.BETTER_AUTH_SECRET),
  );
  if (!signed) {
    return yield* new InvalidInputError({ message: "This authorization request isn't valid" });
  }
  const query = new URLSearchParams(oauthQuery);
  const client = yield* Effect.promise(() =>
    connectedAgentClientOf(ctx.db, query.get("client_id") ?? ""),
  );
  if (!client) return yield* new NotFoundError();
  const requested = new Set(query.get("scope")?.split(" "));
  return {
    client,
    scopes: CONNECTED_AGENT_SCOPES.filter((scope) => requested.has(scope)).map((scope) => ({
      scope,
      description: SCOPE_DESCRIPTIONS[scope],
    })),
  };
});
