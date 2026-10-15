import type { Router } from "@camox/api-contract";
import { DRAFT_HEADER } from "@camox/api-contract/drafts";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";

export type ServerApiClient = RouterClient<Router>;

/**
 * An API client for the plugin's own requests. `draftId` names the draft they read and write:
 * dev mode sends `development`, and a release names none, so it writes Live.
 */
export function createServerApiClient(
  apiUrl: string,
  environmentName?: string,
  authToken?: string,
  draftId?: string,
): ServerApiClient {
  const headers: Record<string, string> = {};
  if (environmentName) headers["x-environment-name"] = environmentName;
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (draftId) headers[DRAFT_HEADER] = draftId;
  const link = new RPCLink({ url: `${apiUrl}/rpc`, headers });
  return createORPCClient<ServerApiClient>(link);
}
