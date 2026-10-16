type PathRow = { id: string; projectId: number; fullPath: string };

/**
 * The pages sharing their full path with another page of their project, as one scope reads
 * them: a duplicate path (ADR 0009). Each page of a duplicate path is listed.
 */
export function pagesWithDuplicatePaths<T extends PathRow>(rows: readonly T[]): T[][] {
  const byPath = new Map<string, T[]>();
  for (const row of rows) {
    const key = `${row.projectId}:${row.fullPath}`;
    byPath.set(key, [...(byPath.get(key) ?? []), row]);
  }
  return [...byPath.values()].filter((group) => group.length > 1);
}

/** The ids of the pages sharing their full path with another page. */
export function duplicatePathIds(rows: readonly PathRow[]): Set<string> {
  return new Set(pagesWithDuplicatePaths(rows).flatMap((group) => group.map((row) => row.id)));
}
