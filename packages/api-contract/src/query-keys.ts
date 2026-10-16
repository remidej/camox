import type { EndedDraft } from "./drafts";

/**
 * Use TypeScript to enforce 'camox' as the first query key to ensure they're all namespaced.
 * This is because the Tanstack Query client on the frontend may be shared with the user's routes,
 * so we ensure there won't be any key collisions.
 */
export type QueryKey = [first: "camox", ...rest: Array<string | number>];
type QueryKeyGroup = Record<string, QueryKey | ((...args: any[]) => QueryKey)>;

export const queryKeys = {
  collections: {
    list: (projectSlug: string) => ["camox", "collections", "list", projectSlug],
    get: (projectSlug: string, collectionId: string) => [
      "camox",
      "collections",
      "get",
      projectSlug,
      collectionId,
    ],
    record: (projectSlug: string, collectionId: string, id: string) => [
      "camox",
      "collections",
      "record",
      projectSlug,
      collectionId,
      id,
    ],
    recordUsageCount: (projectSlug: string, collectionId: string, id: string) => [
      "camox",
      "collections",
      "recordUsageCount",
      projectSlug,
      collectionId,
      id,
    ],
    records: (projectSlug: string, collectionId: string) => [
      "camox",
      "collections",
      "records",
      projectSlug,
      collectionId,
    ],
  },
  comments: {
    all: ["camox", "comments"],
    list: (pageId: string) => ["camox", "comments", "list", pageId],
  },
  pages: {
    list: ["camox", "pages", "list"],
    getByPath: (path: string) => ["camox", "pages", "getByPath", path],
    getByPathAll: ["camox", "pages", "getByPath"],
    getById: (id: string) => ["camox", "pages", "getById", id],
  },
  files: {
    list: ["camox", "files", "list"],
    get: (id: string) => ["camox", "files", "get", id],
  },
  blocks: {
    get: (id: string) => ["camox", "blocks", "get", id],
    getUsageCounts: ["camox", "blocks", "getUsageCounts"],
    // Under the usage counts prefix, so every usage invalidation refreshes it too.
    getPagesUsing: (type: string) => ["camox", "blocks", "getUsageCounts", "pages", type],
    // Also under that prefix, so placing or removing the block refreshes it.
    getSyncedContent: (type: string) => ["camox", "blocks", "getUsageCounts", "synced", type],
    getPageMarkdown: (pageId: string) => ["camox", "blocks", "getPageMarkdown", pageId],
  },
  repeatableItems: {
    get: (id: string) => ["camox", "repeatableItems", "get", id],
  },
  layouts: {
    all: ["camox", "layouts"],
  },
  drafts: {
    all: ["camox", "drafts"],
    // Open drafts and Live's latest publish: the same for every viewer, whatever they're in.
    list: ["camox", "drafts", "list"],
    // The draft a viewer is in, scoped to it like content.
    get: ["camox", "drafts", "get"],
    previewPublish: ["camox", "drafts", "previewPublish"],
  },
} satisfies Record<string, QueryKeyGroup>;

/** The last segment of a query key: what the query reads, Live or a draft (ADR 0011). */
export const LIVE_KEY_SCOPE = "live";

/**
 * A query key read from Live (`draftId` null) or from a draft. The keys above are prefixes naming
 * what a query reads; the cache holds them with the scope appended, so each draft's queries are
 * kept and invalidated apart.
 */
export function inScope(key: QueryKey, draftId: string | null): QueryKey {
  return [...key, draftId ?? LIVE_KEY_SCOPE];
}

/** The scope a scoped query key ends in: `"live"` or a draft's id. */
export function scopeOfKey(key: readonly unknown[]): unknown {
  return key[key.length - 1];
}

/**
 * Refetch the queries under these prefixes. `draftId` names the draft the change came from, so
 * only that draft's queries refetch; a Live change (`null`) refetches every draft's too, since
 * drafts read Live wherever they change nothing.
 */
export type InvalidationMessage = {
  type: "invalidate";
  draftId: string | null;
  targets: QueryKey[];
};

/** A draft was published or discarded: its viewers go back to Live. */
export type DraftEndedMessage = { type: "draftEnded" } & EndedDraft;

/** Everything the project room broadcasts. */
export type ProjectRoomMessage = InvalidationMessage | DraftEndedMessage;
