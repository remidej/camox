import type { Router } from "@camox/api-contract";
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

function createRpcClient(
  token: string,
  apiUrl: string = CAMOX_API_URL,
  environmentName?: string,
  disableTelemetry?: boolean,
) {
  installLocalhostDns(new URL(apiUrl).hostname);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "x-camox-client": "cli",
  };
  if (environmentName) headers["x-environment-name"] = environmentName;
  if (disableTelemetry) headers["x-camox-telemetry-disabled"] = "1";
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

// --- Organizations ---

export interface Organization {
  id: string;
  name: string;
  slug: string;
}

export async function listOrganizations(token: string): Promise<Organization[]> {
  const res = await fetch(`${CAMOX_API_URL}/api/auth/organization/list`, {
    method: "GET",
    headers: authHeaders(token),
  });

  if (!res.ok) {
    throw new Error(`Failed to list organizations: ${res.status}`);
  }

  return res.json();
}

export async function createOrganization(
  token: string,
  name: string,
  slug: string,
): Promise<Organization> {
  const res = await fetch(`${CAMOX_API_URL}/api/auth/organization/create`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ name, slug }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create organization: ${res.status} ${text}`);
  }

  return res.json();
}

export async function setActiveOrganization(token: string, organizationId: string): Promise<void> {
  const res = await fetch(`${CAMOX_API_URL}/api/auth/organization/set-active`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ organizationId }),
  });

  if (!res.ok) {
    throw new Error(`Failed to set active organization: ${res.status}`);
  }
}

// --- Projects ---

export async function checkSlugAvailability(token: string, slug: string) {
  const client = createRpcClient(token);
  return client.projects.checkSlugAvailability({ slug });
}

export async function createProject(
  token: string,
  name: string,
  slug: string,
  organizationId: string,
) {
  const client = createRpcClient(token);
  const result = await client.projects.create({ name, slug, organizationId });
  return result;
}

export async function getProjectBySlug(token: string, slug: string, apiUrl?: string) {
  const client = createRpcClient(token, apiUrl);
  return client.projects.getBySlug({ slug });
}

// --- Agentic tools ---

export type CallToolResponse =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

export type CallToolParams = {
  token: string;
  apiUrl: string;
  environmentName: string;
  projectId: number;
  name: string;
  args: unknown;
  disableTelemetry?: boolean;
};

export async function callTool(params: CallToolParams): Promise<CallToolResponse> {
  const client = createRpcClient(
    params.token,
    params.apiUrl,
    params.environmentName,
    params.disableTelemetry,
  );
  return (await client.agent.callTool({
    projectId: params.projectId,
    name: params.name,
    arguments: params.args,
  })) as CallToolResponse;
}
