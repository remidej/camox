import type { Router } from "@camox/api-contract";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

import { getAuthCookieHeader, getAuthRequestCredentials } from "./auth";
import { getDraftRequestHeaders, readDraftFromUrl } from "./studio-draft";

declare const __CAMOX_TELEMETRY_DISABLED__: boolean;

export type ApiClient = RouterClient<Router>;

let _client: ApiClient | null = null;
let _orpc: ReturnType<typeof createTanstackQueryUtils<ApiClient>> | null = null;
let _apiUrl: string | null = null;

export function initApiClient(apiUrl: string): ApiClient {
  _apiUrl = apiUrl;
  readDraftFromUrl();

  const headers: Record<string, string> = { "x-camox-client": "studio" };
  if (__CAMOX_TELEMETRY_DISABLED__) headers["x-camox-telemetry-disabled"] = "1";

  const link = new RPCLink({
    url: `${apiUrl}/rpc`,
    headers,
    fetch: async (request, init, _options, path) => {
      const authCookieHeader = getAuthCookieHeader();
      if (authCookieHeader) request.headers.set("Better-Auth-Cookie", authCookieHeader);
      const draft = getDraftRequestHeaders(path);
      for (const [name, value] of Object.entries(draft.headers)) request.headers.set(name, value);
      const response = await fetch(request, {
        ...init,
        credentials: getAuthRequestCredentials(authCookieHeader),
      });
      draft.settle(response.ok);
      return response;
    },
  });

  _client = createORPCClient<ApiClient>(link);
  _orpc = createTanstackQueryUtils(_client);
  return _client;
}

export function getApiClient(): ApiClient {
  if (!_client) throw new Error("API client not initialized — call initApiClient first");
  return _client;
}

export function getOrpc() {
  if (!_orpc) throw new Error("API client not initialized — call initApiClient first");
  return _orpc;
}

export function getApiUrl(): string {
  if (!_apiUrl) throw new Error("API client not initialized — call initApiClient first");
  return _apiUrl;
}
