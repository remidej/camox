type PathRow = { id: string; environmentId: number; fullPath: string };

/**
 * The pages sharing their full path with another page of their environment, as one scope reads
 * them: a duplicate path (ADR 0009). Each page of a duplicate path is listed.
 */
export function pagesWithDuplicatePaths<T extends PathRow>(rows: readonly T[]): T[][] {
  const byPath = new Map<string, T[]>();
  for (const row of rows) {
    const key = `${row.environmentId}:${row.fullPath}`;
    byPath.set(key, [...(byPath.get(key) ?? []), row]);
  }
  return [...byPath.values()].filter((group) => group.length > 1);
}

/** The ids of the pages sharing their full path with another page. */
export function duplicatePathIds(rows: readonly PathRow[]): Set<string> {
  return new Set(pagesWithDuplicatePaths(rows).flatMap((group) => group.map((row) => row.id)));
}
