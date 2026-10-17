import type { DraftScope } from "../../lib/draft-scope";

export function runtimePath(pathname: string, basePath: string) {
  const base = basePath.replace(/\/$/, "");
  if (!base || pathname === base || pathname.startsWith(`${base}/`)) return pathname;
  return `${base}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

/**
 * Requests one of the runtime's JSON endpoints (`/_camox/data`, `/_camox/routes`) as the editor,
 * reading `draft` (null for Live). Dev mode's runtime always reads the development draft.
 */
export function fetchRuntimeJson(
  draftScope: DraftScope,
  endpoint: string,
  runtimeBasePath: string,
  params: Record<string, string>,
  draft: string | null,
  signal: AbortSignal,
) {
  const url = new URL(runtimePath(endpoint, runtimeBasePath), window.location.origin);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return fetch(new URL(draftScope.hrefFor(url.href, { draft })), {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal,
  });
}

export function getNavigationTarget(to: string, currentHref: string, basePath: string) {
  const url = new URL(to, currentHref);
  const current = new URL(currentHref);
  if (url.origin !== current.origin || !["http:", "https:"].includes(url.protocol)) return null;
  const base = basePath.replace(/\/$/, "");
  // Absolute URLs outside a mounted runtime belong to the host application.
  if (
    base &&
    /^(https?:)?\/\//.test(to) &&
    url.pathname !== base &&
    !url.pathname.startsWith(`${base}/`)
  )
    return null;
  const pathname =
    base && (url.pathname === base || url.pathname.startsWith(`${base}/`))
      ? url.pathname.slice(base.length) || "/"
      : url.pathname;
  if (
    pathname === "/_camox" ||
    pathname.startsWith("/_camox/") ||
    pathname === "/og" ||
    pathname === "/sitemap.xml"
  )
    return null;
  url.pathname = runtimePath(pathname, base);
  return { url, pathname };
}
