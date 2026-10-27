import { DRAFT_CREATE_HEADER, DRAFT_HEADER, isContentWrite } from "@camox/api-contract/drafts";
import type { Router } from "@camox/api-contract/router";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";

export type ServerApiClient = RouterClient<Router>;

/**
 * An API client for the plugin's own requests. A release names no draft, so it writes Live. With
 * `startsDraft`, its first content write starts that draft, as the studio's first write on Live
 * does: reads see Live until a write has started it, and the draft from then on.
 */
export function createServerApiClient(
  apiUrl: string,
  authToken?: string,
  startsDraft?: string,
): ServerApiClient {
  const base: Record<string, string> = {};
  if (authToken) base.Authorization = `Bearer ${authToken}`;
  let started = false;
  const link = new RPCLink({
    url: `${apiUrl}/rpc`,
    headers: (_options, path) => {
      if (!startsDraft) return base;
      if (isContentWrite(path)) {
        return { ...base, [DRAFT_HEADER]: startsDraft, [DRAFT_CREATE_HEADER]: "1" };
      }
      return started ? { ...base, [DRAFT_HEADER]: startsDraft } : base;
    },
    fetch: async (request, init, _options, path) => {
      const response = await fetch(request, init);
      if (response.ok && isContentWrite(path)) started = true;
      return response;
    },
  });
  return createORPCClient<ServerApiClient>(link);
}
