import type { Router } from "@camox/api-contract/router";
import { createORPCClient } from "@orpc/client";
import type { InferClientOutputs } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";

import { apiFetch } from "./api-fetch";
import { apiTransportUrl } from "./api-url";

const link = new RPCLink({
  url: `${apiTransportUrl(import.meta.env.VITE_API_URL!, import.meta.env.DEV && import.meta.env.SSR)}/rpc`,
  fetch: apiFetch,
});

export const api = createORPCClient<RouterClient<Router>>(link);

/** A project as the project list returns it, with its Live homepage's OG image. */
export type ListedProject = InferClientOutputs<RouterClient<Router>>["projects"]["list"][number];

export type Project = Omit<ListedProject, "homepageOgImageUrl">;

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
