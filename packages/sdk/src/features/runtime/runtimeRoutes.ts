/**
 * The URLs the runtime answers that aren't pages or the Studio. Worker request filtering, runtime
 * route matching and client navigation all read this list, so a new one can't be forgotten in any
 * of them. Prefix rules stay with their readers: the Worker also answers every `/camox/` Studio
 * path, and client navigation also skips any other `/_camox/` path.
 * No imports: client navigation ships this module in the browser bundle.
 */
export const RUNTIME_ROUTE_PATHS = {
  data: "/_camox/data",
  health: "/_camox/health",
  registry: "/_camox/registry",
  routes: "/_camox/routes",
  logo: "/_camox/logo.png",
  og: "/og",
  sitemap: "/sitemap.xml",
  "llms-txt": "/llms.txt",
} as const;

export type RuntimeOwnedRouteKind = keyof typeof RUNTIME_ROUTE_PATHS;

/** Which runtime-owned route a path inside the runtime (base path removed) is, if any. */
export function matchRuntimeOwnedRoute(pathname: string): RuntimeOwnedRouteKind | null {
  for (const [kind, path] of Object.entries(RUNTIME_ROUTE_PATHS))
    if (pathname === path) return kind as RuntimeOwnedRouteKind;
  return null;
}
