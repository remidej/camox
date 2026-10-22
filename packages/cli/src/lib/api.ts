import type { Router } from "@camox/api-contract";
import { DEVELOPMENT_DRAFT, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";

import { installLocalhostDns } from "./local-dns";

const CAMOX_API_URL = process.env.CAMOX_API_URL || "https://api.camox.dev";
installLocalhostDns(new URL(CAMOX_API_URL).hostname);

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

/**
 * Headers of every request a command sends about a project: the CLI works only in the
 * caller's development draft (ADR 0010).
 */
export function developmentDraftHeaders(token: string, disableTelemetry?: boolean) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "x-camox-client": "cli",
    [DRAFT_HEADER]: DEVELOPMENT_DRAFT,
  };
  if (disableTelemetry) headers["x-camox-telemetry-disabled"] = "1";
  return headers;
}

function createRpcClient(
  token: string,
  apiUrl: string = CAMOX_API_URL,
  options: { developmentDraft?: boolean; disableTelemetry?: boolean } = {},
) {
  installLocalhostDns(new URL(apiUrl).hostname);
  const headers = options.developmentDraft
    ? developmentDraftHeaders(token, options.disableTelemetry)
    : { Authorization: `Bearer ${token}`, "x-camox-client": "cli" };
  const link = new RPCLink({ url: `${apiUrl}/rpc`, headers });
  return createORPCClient<RouterClient<Router>>(link);
}

// --- Session validation ---

export async function verifySession(token: string): Promise<boolean> {
  const res = await fetch(`${CAMOX_API_URL}/api/auth/get-session`, {
    method: "GET",
    headers: authHeaders(token),
  });
  return res.ok;
}

// --- Projects ---

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Load a project named by its Project ID or its Project Slug. A UUID-shaped name is a
 * Project ID, which the API validates; anything else is a slug.
 */
export async function getProject(token: string, project: string, apiUrl?: string) {
  const client = createRpcClient(token, apiUrl, { developmentDraft: true });
  return UUID_SHAPE.test(project)
    ? client.projects.getByUuid({ projectUuid: project })
    : client.projects.getBySlug({ slug: project });
}

// --- Drafts ---

/**
 * The caller's development draft in a project, summarized: it fails with
 * `NO_DEVELOPMENT_DRAFT` until dev mode created it.
 */
export async function getDevelopmentDraft(params: {
  token: string;
  apiUrl: string;
  projectId: number;
  disableTelemetry?: boolean;
}) {
  const client = createRpcClient(params.token, params.apiUrl, {
    developmentDraft: true,
    disableTelemetry: params.disableTelemetry,
  });
  return client.drafts.get({ projectId: params.projectId });
}

// --- Agentic tools ---

export type CallToolResponse =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

export type CallToolParams = {
  token: string;
  apiUrl: string;
  projectId: number;
  name: string;
  args: unknown;
  disableTelemetry?: boolean;
};

export async function callTool(params: CallToolParams): Promise<CallToolResponse> {
  const client = createRpcClient(params.token, params.apiUrl, {
    developmentDraft: true,
    disableTelemetry: params.disableTelemetry,
  });
  return (await client.agent.callTool({
    projectId: params.projectId,
    name: params.name,
    arguments: params.args,
  })) as CallToolResponse;
}
