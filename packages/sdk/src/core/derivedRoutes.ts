import type { Layout } from "./createLayout";
import { asCollectionItem } from "./recordItem";
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

/**
 * A discovered page: its path, and the record it renders when its entry names one, with that
 * record's Label when the entry carries it.
 */
export interface DiscoveredPage {
  path: string;
  recordId?: string;
  label?: string;
}

/** The record a discovery entry names, if its `target` is a record target. */
function targetRecord(entry: unknown): Omit<DiscoveredPage, "path"> {
  const target = asCollectionItem(
    (entry as { target?: { kind?: unknown; id?: unknown; label?: unknown } } | null)?.target,
  );
  if (typeof target?.id !== "string") return {};
  return {
    recordId: target.id,
    ...(typeof target.label === "string" && { label: target.label }),
  };
}

/**
 * Runs a derived layout's route discovery, keeping the record each page renders. An invalid
 * result throws rather than omitting pages.
 */
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
  return entries.map((entry) => ({
    path: derivedLayoutPath(id, (entry as { params?: unknown })?.params),
    ...targetRecord(entry),
  }));
}
