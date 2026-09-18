import type { Layout } from "./createLayout";

export function routeSegments(id: string) {
  return id.split(".");
}

export function matchDerivedLayout(layouts: Layout[], pathname: string) {
  const path = pathname.replace(/^\/|\/$/g, "").split("/");
  const candidates = layouts
    .filter((layout) => layout._internal.kind !== "curated")
    .sort(
      (a, b) =>
        routeSegments(a._internal.id).filter((s) => s.startsWith("$")).length -
        routeSegments(b._internal.id).filter((s) => s.startsWith("$")).length,
    );
  for (const layout of candidates) {
    const segments = routeSegments(layout._internal.id);
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
