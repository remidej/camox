export function runtimePath(pathname: string, basePath: string) {
  const base = basePath.replace(/\/$/, "");
  if (!base || pathname === base || pathname.startsWith(`${base}/`)) return pathname;
  return `${base}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
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
