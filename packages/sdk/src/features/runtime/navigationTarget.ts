import { DRAFT_SEARCH_PARAM } from "@camox/api-contract/drafts";

import { getCurrentDraftId } from "../../lib/studio-draft";

export function runtimePath(pathname: string, basePath: string) {
  const base = basePath.replace(/\/$/, "");
  if (!base || pathname === base || pathname.startsWith(`${base}/`)) return pathname;
  return `${base}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

/** Requests one of the runtime's JSON endpoints (`/_camox/data`, `/_camox/routes`) as the editor. */
export function fetchRuntimeJson(
  endpoint: string,
  runtimeBasePath: string,
  params: Record<string, string>,
  signal: AbortSignal,
) {
  const url = new URL(runtimePath(endpoint, runtimeBasePath), window.location.origin);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  // The runtime reads the draft the studio is in, like the page around it.
  const draftId = getCurrentDraftId();
  if (draftId) url.searchParams.set(DRAFT_SEARCH_PARAM, draftId);
  return fetch(url, {
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
