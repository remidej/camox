import type { DraftScope } from "../../lib/draft-scope";
import { localeHeaders, type LocaleView } from "../../lib/locale-path";
import { matchRuntimeOwnedRoute } from "./runtimeRoutes";

export function runtimePath(pathname: string, basePath: string) {
  const base = basePath.replace(/\/$/, "");
  if (!base || pathname === base || pathname.startsWith(`${base}/`)) return pathname;
  return `${base}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

/**
 * Requests one of the runtime's JSON endpoints (`/_camox/data`, `/_camox/routes`) as the editor,
 * reading `draft` (null for Live) in `locale` (the default locale without it). A path the endpoint takes names its own locale by its
 * prefix; route discovery, which takes none, reads the locale the request names.
 */
export function fetchRuntimeJson(
  draftScope: DraftScope,
  endpoint: string,
  runtimeBasePath: string,
  params: Record<string, string>,
  draft: string | null,
  signal: AbortSignal,
  locale?: LocaleView,
) {
  const url = new URL(runtimePath(endpoint, runtimeBasePath), window.location.origin);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return fetch(new URL(draftScope.hrefFor(url.href, { draft })), {
    credentials: "same-origin",
    headers: { Accept: "application/json", ...localeHeaders(locale) },
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
  // Runtime-owned routes aren't pages: the browser makes a document request for them.
  if (pathname === "/_camox" || pathname.startsWith("/_camox/") || matchRuntimeOwnedRoute(pathname))
    return null;
  url.pathname = runtimePath(pathname, base);
  return { url, pathname };
}
