/**
 * The URLs the runtime answers that aren't pages or the Studio, besides artifact documents
 * (`ARTIFACTS_PATH_PREFIX`). Worker request filtering, runtime route matching and client
 * navigation all match them through `matchRuntimeOwnedRoute`, so a new one can't be forgotten in
 * any of them. Other prefix rules stay with their readers: the Worker also answers every
 * `/camox/` Studio path, and client navigation also skips any other `/_camox/` path.
 * No imports: client navigation ships this module in the browser bundle.
 */
export const RUNTIME_ROUTE_PATHS = {
  data: "/_camox/data",
  health: "/_camox/health",
  /**
   * The lightweight document the agent's `look` tool captures (ADR 0032): one page of a draft,
   * read with a look token, without the studio.
   */
  look: "/_camox/look",
  registry: "/_camox/registry",
  /** The renderer frame's document (ADR 0023), which the studio loads to render its pages. */
  renderer: "/_camox/renderer",
  routes: "/_camox/routes",
  logo: "/_camox/logo.png",
  og: "/og",
  sitemap: "/sitemap.xml",
  "llms-txt": "/llms.txt",
} as const;

/**
 * Where public pages load artifacts from: `<prefix><shellHash>/<sourceHash>`. Each document is
 * cached by its own URL, never as a page.
 */
export const ARTIFACTS_PATH_PREFIX = "/_camox/artifacts/";

export type RuntimeOwnedRouteKind = keyof typeof RUNTIME_ROUTE_PATHS | "artifact";

/** Which runtime-owned route a path inside the runtime (base path removed) is, if any. */
export function matchRuntimeOwnedRoute(pathname: string): RuntimeOwnedRouteKind | null {
  for (const [kind, path] of Object.entries(RUNTIME_ROUTE_PATHS))
    if (pathname === path) return kind as RuntimeOwnedRouteKind;
  if (pathname.startsWith(ARTIFACTS_PATH_PREFIX)) return "artifact";
  return null;
}
