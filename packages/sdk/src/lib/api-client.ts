import type { Router } from "@camox/api-contract";
import { DRAFT_HEADER, isContentWrite } from "@camox/api-contract/drafts";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

import { getAuthCookieHeader, getAuthRequestCredentials } from "./auth";
import type { DraftRequestHeaders, DraftScope } from "./draft-scope";

declare const __CAMOX_TELEMETRY_DISABLED__: boolean;

export type ApiClient = RouterClient<Router>;

let _client: ApiClient | null = null;
let _orpc: ReturnType<typeof createTanstackQueryUtils<ApiClient>> | null = null;
let _apiUrl: string | null = null;
let _draftScope: DraftScope | null = null;
const _readClients = new Map<string | null, ApiClient>();

/** Creates the window's API client, whose requests read and write the draft `draftScope` views. */
export function initApiClient(apiUrl: string, draftScope: DraftScope): ApiClient {
  _apiUrl = apiUrl;
  _draftScope = draftScope;
  _readClients.clear();
  _client = createStudioClient(apiUrl, (path) => draftScope.requestHeaders(isContentWrite(path)));
  _orpc = createTanstackQueryUtils(_client);
  return _client;
}

/**
 * A client of the window's API whose requests name `draft` (null for Live), whatever draft the
 * studio views by the time they're sent. The studio's reads fetch through it, so a read caches
 * only the draft its key names.
 */
export function getDraftReadClient(draft: string | null): ApiClient {
  let client = _readClients.get(draft);
  if (client) return client;
  const headers: Record<string, string> = draft ? { [DRAFT_HEADER]: draft } : {};
  client = createStudioClient(getApiUrl(), () => ({ headers, settle: () => {} }));
  _readClients.set(draft, client);
  return client;
}

function createStudioClient(
  apiUrl: string,
  draftHeaders: (path: readonly string[]) => DraftRequestHeaders,
): ApiClient {
  const headers: Record<string, string> = { "x-camox-client": "studio" };
  if (__CAMOX_TELEMETRY_DISABLED__) headers["x-camox-telemetry-disabled"] = "1";

  const link = new RPCLink({
    url: `${apiUrl}/rpc`,
    headers,
    fetch: async (request, init, _options, path) => {
      const authCookieHeader = getAuthCookieHeader();
      if (authCookieHeader) request.headers.set("Better-Auth-Cookie", authCookieHeader);
      const draft = draftHeaders(path);
      for (const [name, value] of Object.entries(draft.headers)) request.headers.set(name, value);
      const response = await fetch(request, {
        ...init,
        credentials: getAuthRequestCredentials(authCookieHeader),
      });
      draft.settle(response.ok);
      return response;
    },
  });
  return createORPCClient<ApiClient>(link);
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

/**
 * Headers for a content write sent outside oRPC, such as a file upload: on Live it starts a draft
 * like any other content write. Report the outcome through `settle`.
 */
export function getContentWriteHeaders(): DraftRequestHeaders {
  if (!_draftScope) throw new Error("API client not initialized — call initApiClient first");
  return _draftScope.requestHeaders(true);
}
