import { reads } from "../../lib/studio-reads";

/**
 * The block definitions a render input's blocks use. Every block a page or layout renders
 * is seeded as a block query, so its dehydrated state names them all.
 */
export function getPageBlockTypes(dehydratedState: unknown): string[] {
  if (
    !dehydratedState ||
    typeof dehydratedState !== "object" ||
    !("queries" in dehydratedState) ||
    !Array.isArray(dehydratedState.queries)
  )
    return [];
  const types = new Set<string>();
  for (const query of dehydratedState.queries as {
    queryKey?: unknown[];
    state?: { data?: { block?: { type?: unknown } } };
  }[]) {
    if (!query.queryKey || reads.blockBundle.paramsOf(query.queryKey) === null) continue;
    const type = query.state?.data?.block?.type;
    if (typeof type === "string") types.add(type);
  }
  return [...types];
}
