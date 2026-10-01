import type { Router } from "@camox/api-contract";
import { createORPCClient } from "@orpc/client";
import type { InferClientOutputs } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";

import { apiTransportUrl } from "./api-url";

const link = new RPCLink({
  url: `${apiTransportUrl(import.meta.env.VITE_API_URL!, import.meta.env.DEV && import.meta.env.SSR)}/rpc`,
  fetch: (request, init) => fetch(request, { ...init, credentials: "include" }),
});

export const api = createORPCClient<RouterClient<Router>>(link);

export type Project = InferClientOutputs<RouterClient<Router>>["projects"]["list"][number];

// --- Favicon helpers ---
//
// Favicons live in R2 keyed by projectId, served via a public endpoint with a
// short cache. `updatedAt` from the project row drives the cache-bust query
// param: when we upload or delete, the API bumps `projects.updatedAt`, which
// flows through React Query and changes this URL on the next render.

const FAVICON_API_BASE = `${import.meta.env.VITE_API_URL!}/favicons`;

export function getFaviconUrl(project: { id: number; updatedAt: number }) {
  return `${FAVICON_API_BASE}/${project.id}?v=${project.updatedAt}`;
}

export async function uploadFavicon(projectId: number, file: File): Promise<{ updatedAt: number }> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("projectId", String(projectId));

  const res = await fetch(`${FAVICON_API_BASE}/upload`, {
    method: "POST",
    body: formData,
    credentials: "include",
  });
  if (!res.ok) {
    const message = await res.text().catch(() => "Failed to upload favicon");
    throw new Error(message || `Upload failed with status ${res.status}`);
  }
  return res.json();
}

export async function deleteFavicon(projectId: number): Promise<void> {
  const res = await fetch(`${FAVICON_API_BASE}/${projectId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    const message = await res.text().catch(() => "Failed to delete favicon");
    throw new Error(message || `Delete failed with status ${res.status}`);
  }
}
