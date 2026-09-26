/**
 * Use TypeScript to enforce 'camox' as the first query key to ensure they're all namespaced.
 * This is because the Tanstack Query client on the frontend may be shared with the user's routes,
 * so we ensure there won't be any key collisions.
 */
export type QueryKey = [first: "camox", ...rest: Array<string | number>];
type QueryKeyGroup = Record<string, QueryKey | ((...args: any[]) => QueryKey)>;

/**
 * Source axis on read query keys. `'live'` reads the page's live published
 * checkpoint snapshot; `'draft'` reads the live editor rows. The two render
 * through the same component — only the cache slot differs, so toggling the
 * source select is instant once both have been seeded.
 *
 * Block / page-read query keys include the source as the trailing key segment.
 * Omitting it on `invalidateQueries` is a prefix invalidation that hits every
 * source — used for navigation events and other source-agnostic invalidations.
 * Edit-time invalidations (which only touch draft data) pass `'draft'`
 * explicitly so the `'live'` cache stays untouched.
 */
export type ReadSource = "draft" | "live";

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
    getByPath: (path: string, source?: ReadSource) =>
      source
        ? ["camox", "pages", "getByPath", path, source]
        : ["camox", "pages", "getByPath", path],
    getByPathAll: ["camox", "pages", "getByPath"],
    getById: (id: number) => ["camox", "pages", "getById", id],
  },
  files: {
    list: ["camox", "files", "list"],
    get: (id: number) => ["camox", "files", "get", id],
  },
  blocks: {
    get: (id: number, source?: ReadSource) =>
      source ? ["camox", "blocks", "get", id, source] : ["camox", "blocks", "get", id],
    getUsageCounts: ["camox", "blocks", "getUsageCounts"],
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
