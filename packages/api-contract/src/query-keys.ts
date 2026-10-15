/**
 * Use TypeScript to enforce 'camox' as the first query key to ensure they're all namespaced.
 * This is because the Tanstack Query client on the frontend may be shared with the user's routes,
 * so we ensure there won't be any key collisions.
 */
export type QueryKey = [first: "camox", ...rest: Array<string | number>];
type QueryKeyGroup = Record<string, QueryKey | ((...args: any[]) => QueryKey)>;

export const queryKeys = {
  collections: {
    list: (projectSlug: string, environmentName: string) => [
      "camox",
      "collections",
      "list",
      projectSlug,
      environmentName,
    ],
    get: (projectSlug: string, environmentName: string, collectionId: string) => [
      "camox",
      "collections",
      "get",
      projectSlug,
      environmentName,
      collectionId,
    ],
    record: (projectSlug: string, environmentName: string, collectionId: string, id: string) => [
      "camox",
      "collections",
      "record",
      projectSlug,
      environmentName,
      collectionId,
      id,
    ],
    recordUsageCount: (
      projectSlug: string,
      environmentName: string,
      collectionId: string,
      id: string,
    ) => [
      "camox",
      "collections",
      "recordUsageCount",
      projectSlug,
      environmentName,
      collectionId,
      id,
    ],
    records: (projectSlug: string, environmentName: string, collectionId: string) => [
      "camox",
      "collections",
      "records",
      projectSlug,
      environmentName,
      collectionId,
    ],
  },
  comments: {
    all: ["camox", "comments"],
    list: (pageId: number) => ["camox", "comments", "list", pageId],
  },
  pages: {
    list: ["camox", "pages", "list"],
    getByPath: (path: string) => ["camox", "pages", "getByPath", path],
    getByPathAll: ["camox", "pages", "getByPath"],
    getById: (id: number) => ["camox", "pages", "getById", id],
  },
  files: {
    list: ["camox", "files", "list"],
    get: (id: string) => ["camox", "files", "get", id],
  },
  blocks: {
    get: (id: number) => ["camox", "blocks", "get", id],
    getUsageCounts: ["camox", "blocks", "getUsageCounts"],
    // Under the usage counts prefix, so every usage invalidation refreshes it too.
    getPagesUsing: (type: string) => ["camox", "blocks", "getUsageCounts", "pages", type],
    // Also under that prefix, so placing or removing the block refreshes it.
    getSyncedContent: (type: string) => ["camox", "blocks", "getUsageCounts", "synced", type],
    getPageMarkdown: (pageId: number) => ["camox", "blocks", "getPageMarkdown", pageId],
  },
  repeatableItems: {
    get: (id: number) => ["camox", "repeatableItems", "get", id],
  },
  layouts: {
    all: ["camox", "layouts"],
  },
  environments: {
    all: ["camox", "environments"],
    checkCompatibility: ["camox", "environments", "checkCompatibility"],
  },
} satisfies Record<string, QueryKeyGroup>;

export type InvalidationMessage = {
  type: "invalidate";
  targets: QueryKey[];
};
