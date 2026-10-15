import type { Router } from "@camox/api-contract";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";

declare const __CAMOX_API_URL__: string;
declare const __CAMOX_PROJECT_SLUG__: string;
declare const __CAMOX_ENVIRONMENT_NAME__: string;

export type SitemapEntry = {
  loc: string;
  lastmod: string;
};

export async function generateSitemap(origin: string): Promise<SitemapEntry[]> {
  const headers: Record<string, string> = {
    "x-environment-name": __CAMOX_ENVIRONMENT_NAME__,
  };

  const api = createORPCClient<RouterClient<Router>>(
    new RPCLink({ url: `${__CAMOX_API_URL__}/rpc`, headers }),
  );

  const pages = await api.pages.listBySlug({ projectSlug: __CAMOX_PROJECT_SLUG__ });

  // Pages whose layout is gone, or whose URL a singleton serves, aren't served.
  return pages
    .filter((page) => !page.needsLayout && !page.shadowed)
    .map((page) => ({
      loc: `${origin}${page.fullPath}`,
      lastmod: new Date(page.updatedAt).toISOString(),
    }));
}
