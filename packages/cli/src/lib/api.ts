import type { Router } from "@camox/api-contract/router";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";

import { installLocalhostDns } from "./local-dns";

const CAMOX_API_URL = process.env.CAMOX_API_URL || "https://api.camox.ai";
installLocalhostDns(new URL(CAMOX_API_URL).hostname);

function createRpcClient(token: string) {
  const link = new RPCLink({
    url: `${CAMOX_API_URL}/rpc`,
    headers: { Authorization: `Bearer ${token}`, "x-camox-client": "cli" },
  });
  return createORPCClient<RouterClient<Router>>(link);
}

// --- Session validation ---

export async function verifySession(token: string): Promise<boolean> {
  const res = await fetch(`${CAMOX_API_URL}/api/auth/get-session`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  return res.ok;
}

// --- Projects ---

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The Project ID of a project named by its Project ID or its Project Slug. */
async function projectIdOf(token: string, project: string) {
  if (UUID_SHAPE.test(project)) return project.toLowerCase();
  const { uuid } = await createRpcClient(token).projects.getBySlug({ slug: project });
  return uuid;
}

/**
 * A short-lived read token for a project's repo, with the repo's Git remote: only for a member,
 * on a project whose code can be worked on outside Camox (ADR 0026).
 */
export async function createCodeReadToken(token: string, project: string) {
  const projectUuid = await projectIdOf(token, project);
  return createRpcClient(token).projects.createCodeReadToken({ projectUuid });
}
