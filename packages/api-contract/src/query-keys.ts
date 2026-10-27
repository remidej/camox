import type { EndedDraft } from "./drafts";

/**
 * Use TypeScript to enforce 'camox' as the first query key to ensure they're all namespaced.
 * This is because the Tanstack Query client on the frontend may be shared with the user's routes,
 * so we ensure there won't be any key collisions.
 */
export type QueryKey = [first: "camox", ...rest: Array<string | number>];
type QueryKeyGroup = Record<string, QueryKey | ((...args: any[]) => QueryKey)>;

/**
 * The key prefixes the API's realtime invalidations name (ADR 0011). The studio caches each read
 * under one of them, with the scope appended, so an invalidation reaches every read it should;
 * the studio's own keys live with its reads, in the SDK.
 */
export const queryKeys = {
  collections: {
    record: (projectUuid: string, collectionId: string, id: string) => [
      "camox",
      "collections",
      "record",
      projectUuid,
      collectionId,
      id,
    ],
    records: (projectUuid: string, collectionId: string) => [
      "camox",
      "collections",
      "records",
      projectUuid,
      collectionId,
    ],
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
    // Every placement change refreshes what's under this prefix: counts, pages using a block.
    getUsageCounts: ["camox", "blocks", "getUsageCounts"],
    // Under the usage counts prefix, so placing or removing the block refreshes it too.
    getSyncedContent: (type: string) => ["camox", "blocks", "getUsageCounts", "synced", type],
    getPageMarkdown: (pageId: string) => ["camox", "blocks", "getPageMarkdown", pageId],
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

/** A draft was published or deleted: its viewers go back to Live. */
export type DraftEndedMessage = { type: "draftEnded" } & EndedDraft;

/** A draft with code has a new revision, built with Camox's `sdkVersion`. */
export type RevisionAnnouncement = { draftId: string; revisionId: string; sdkVersion: string };

/** A draft's new revision: its viewers' frames load it. */
export type RevisionMessage = { type: "revision" } & RevisionAnnouncement;

/** Everything the project room broadcasts. */
export type ProjectRoomMessage = InvalidationMessage | DraftEndedMessage | RevisionMessage;
