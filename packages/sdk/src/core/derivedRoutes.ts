import type { Layout } from "./createLayout";
import type { LayoutRequestContext } from "./requestContext";

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

/** Builds the path of one discovered page, rejecting params the route could not match. */
export function derivedLayoutPath(layoutId: string, params: unknown) {
  const segments = routeSegments(layoutId);
  const names = segments.filter((s) => s.startsWith("$")).map((s) => s.slice(1));
  if (!params || typeof params !== "object" || Array.isArray(params))
    throw new Error(`Layout "${layoutId}" routes returned an entry without params`);
  const values = params as Record<string, unknown>;
  const extra = Object.keys(values).find((name) => !names.includes(name));
  if (extra) throw new Error(`Layout "${layoutId}" routes returned an unknown param "${extra}"`);
  return `/${segments
    .map((segment) => {
      if (!segment.startsWith("$")) return encodeURIComponent(segment);
      const name = segment.slice(1);
      const value = values[name];
      if (typeof value !== "string" || !value || value.includes("/"))
        throw new Error(
          `Layout "${layoutId}" routes returned an invalid "${name}" param: ${JSON.stringify(value)}`,
        );
      return encodeURIComponent(value);
    })
    .join("/")}`;
}

/** Runs a derived layout's route discovery; an invalid result throws rather than omitting pages. */
export async function discoverLayoutPaths(
  layout: Layout,
  context: LayoutRequestContext,
): Promise<string[]> {
  return (await discoverLayoutPages(layout, context)).map((page) => page.path);
}

/** A discovered page: its path, and the record it renders when its entry names one. */
export interface DiscoveredPage {
  path: string;
  recordId?: string;
}

/** The record a discovery entry names, if its `target` is a record target. */
function targetRecordId(entry: unknown) {
  const target = (entry as { target?: { kind?: unknown; id?: unknown } } | null)?.target;
  if (target?.kind !== "collection-item" || typeof target.id !== "string") return undefined;
  return target.id;
}

/** Like `discoverLayoutPaths`, keeping the record each page renders. */
export async function discoverLayoutPages(
  layout: Layout,
  context: LayoutRequestContext,
): Promise<DiscoveredPage[]> {
  const { id, routes } = layout._internal;
  if (!routes) return [];
  let result: unknown;
  try {
    result = await routes({ context });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Layout "${id}" routes failed: ${message}`, { cause: error });
  }
  const entries = (result as { data?: unknown } | null)?.data;
  if (!Array.isArray(entries))
    throw new Error(`Layout "${id}" routes must return { data: [{ params }] }`);
  return entries.map((entry) => {
    const path = derivedLayoutPath(id, (entry as { params?: unknown })?.params);
    const recordId = targetRecordId(entry);
    return recordId ? { path, recordId } : { path };
  });
}
