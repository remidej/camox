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
    const key = query.queryKey;
    if (key?.[0] !== "camox" || key[1] !== "blocks" || key[2] !== "get") continue;
    const type = query.state?.data?.block?.type;
    if (typeof type === "string") types.add(type);
  }
  return [...types];
}
