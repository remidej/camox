/** How a layout's pages come about: authored by editors, derived from data, or one fixed page. */
export type LayoutKind = "curated" | "derived" | "singleton";

/** A layout as route matching reads it: its id, which is its file route, and its kind. */
export type LayoutRoute = { id: string; kind: LayoutKind };

/** The segments of a layout's file route, such as `blog.$slug`: `$` segments are params. */
export function routeSegments(id: string) {
  return id.split(".");
}

/**
 * The singleton or derived layout whose route matches `pathname`, a path in its Locale, with its
 * params, or null. The route with the fewest params wins, so a singleton's fixed route wins over
 * a derived route that would match it too. The SDK renders pages and the API checks them with it.
 */
export function matchLayoutRoute<L>(
  layouts: readonly L[],
  pathname: string,
  routeOf: (layout: L) => LayoutRoute,
): { layout: L; params: Record<string, string> } | null {
  const path = pathname.replace(/^\/|\/$/g, "").split("/");
  const paramCount = (layout: L) =>
    routeSegments(routeOf(layout).id).filter((s) => s.startsWith("$")).length;
  const candidates = layouts
    .filter((layout) => routeOf(layout).kind !== "curated")
    .sort((a, b) => paramCount(a) - paramCount(b));
  for (const layout of candidates) {
    const segments = routeSegments(routeOf(layout).id);
    if (segments.length !== path.length) continue;
    const params: Record<string, string> = {};
    let matches = true;
    for (const [index, segment] of segments.entries()) {
      let value: string;
      try {
        value = decodeURIComponent(path[index]!);
      } catch {
        matches = false;
        break;
      }
      if (segment.startsWith("$") && value && !value.includes("/"))
        params[segment.slice(1)] = value;
      else if (segment !== value) {
        matches = false;
        break;
      }
    }
    if (matches) return { layout, params };
  }
  return null;
}
