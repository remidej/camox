import { queryKeys } from "@camox/api-contract/query-keys";

import { type ApiClient, getApiUrl, getContentWriteHeaders, getOrpc } from "./api-client";
import { getAuthCookieHeader, getAuthRequestCredentials } from "./auth";
import type { DraftScope } from "./draft-scope";

// --- Inferred API response types ---

export type Page = Awaited<ReturnType<ApiClient["pages"]["list"]>>[number];
export type PageWithBlocks = Awaited<ReturnType<ApiClient["pages"]["getByPath"]>>;
export type BlockBundle = Awaited<ReturnType<ApiClient["blocks"]["get"]>>;
export type File = Awaited<ReturnType<ApiClient["files"]["list"]>>[number];
export type CollectionDefinition = Awaited<
  ReturnType<ApiClient["collectionDefinitions"]["list"]>
>[number];

/** Slim structural data stored in the page query cache (no blocks/items/files). */
export type PageStructure = {
  page: PageWithBlocks["page"];
  layout: PageWithBlocks["layout"];
  projectName: string;
  project: PageWithBlocks["project"];
};
export type Project = Awaited<ReturnType<ApiClient["projects"]["getBySlug"]>>;
export type Layout = Awaited<ReturnType<ApiClient["layouts"]["list"]>>[number];
export type BlockUsageCounts = Awaited<ReturnType<ApiClient["blocks"]["getUsageCounts"]>>;
export type DraftList = Awaited<ReturnType<ApiClient["drafts"]["list"]>>;
export type DraftSummary = DraftList["drafts"][number];

// --- Query factories ---

export const collectionQueries = {
  list: (scope: DraftScope, projectSlug: string) => ({
    ...getOrpc().collectionDefinitions.list.queryOptions({
      input: { projectSlug },
    }),
    queryKey: scope.keyFor(queryKeys.collections.list(projectSlug)),
  }),

  get: (scope: DraftScope, projectSlug: string, collectionId: string) => ({
    ...getOrpc().collectionDefinitions.get.queryOptions({
      input: { projectSlug, collectionId },
    }),
    queryKey: scope.keyFor(queryKeys.collections.get(projectSlug, collectionId)),
  }),

  record: (scope: DraftScope, projectSlug: string, collectionId: string, id: string) => ({
    ...getOrpc().collectionDefinitions.getRecord.queryOptions({
      input: { projectSlug, collectionId, id },
    }),
    queryKey: scope.keyFor(queryKeys.collections.record(projectSlug, collectionId, id)),
  }),

  /** How many blocks, repeatable items and records reference a record. */
  recordUsageCount: (scope: DraftScope, projectSlug: string, collectionId: string, id: string) => ({
    ...getOrpc().collectionDefinitions.getRecordUsageCount.queryOptions({
      input: { projectSlug, collectionId, id },
    }),
    queryKey: scope.keyFor(queryKeys.collections.recordUsageCount(projectSlug, collectionId, id)),
    select: (data: { count: number }) => data.count,
  }),

  records: (scope: DraftScope, projectSlug: string, collectionId: string) => ({
    ...getOrpc().collectionDefinitions.listRecords.queryOptions({
      input: { projectSlug, collectionId },
    }),
    queryKey: scope.keyFor(queryKeys.collections.records(projectSlug, collectionId)),
  }),
};

export const collectionMutations = {
  create: () => getOrpc().collectionDefinitions.createRecord.mutationOptions(),
  edit: () => getOrpc().collectionDefinitions.editRecord.mutationOptions(),
  delete: () => getOrpc().collectionDefinitions.deleteRecord.mutationOptions(),
};

export type CollectionRecord = Awaited<ReturnType<ApiClient["collectionDefinitions"]["getRecord"]>>;

export const pageQueries = {
  list: (scope: DraftScope, projectId: number) => ({
    ...getOrpc().pages.list.queryOptions({ input: { projectId }, staleTime: Infinity }),
    queryKey: scope.keyFor(queryKeys.pages.list),
  }),

  getByPath: (scope: DraftScope, fullPath: string, projectSlug: string) => ({
    ...getOrpc().pages.getByPath.queryOptions({
      input: { path: fullPath, projectSlug },
      staleTime: Infinity,
    }),
    queryKey: scope.keyFor(queryKeys.pages.getByPath(fullPath)),
  }),

  getById: (scope: DraftScope, id: string) => ({
    ...getOrpc().pages.get.queryOptions({
      input: { id },
      staleTime: Infinity,
    }),
    queryKey: scope.keyFor(queryKeys.pages.getById(id)),
  }),
};

export const fileQueries = {
  list: (scope: DraftScope, projectId: number) => ({
    ...getOrpc().files.list.queryOptions({ input: { projectId }, staleTime: Infinity }),
    queryKey: scope.keyFor(queryKeys.files.list),
  }),

  get: (scope: DraftScope, id: string) => ({
    ...getOrpc().files.get.queryOptions({
      input: { id },
      staleTime: Infinity,
    }),
    queryKey: scope.keyFor(queryKeys.files.get(id)),
  }),

  getUsageCount: (id: string) => ({
    ...getOrpc().files.getUsageCount.queryOptions({
      input: { id },
      staleTime: Infinity,
    }),
    select: (data: { count: number }) => data.count,
  }),
};

export const projectQueries = {
  getBySlug: (slug: string) => ({
    ...getOrpc().projects.getBySlug.queryOptions({
      input: { slug },
      staleTime: Infinity,
    }),
  }),
};

/**
 * Sends a change to the project's favicon. Unlike content writes it carries no draft: the favicon
 * is shared by Live and every draft, so changing it updates the whole site at once.
 */
async function sendFaviconChange(path: string, init: { method: string; body?: FormData }) {
  const authCookieHeader = getAuthCookieHeader();
  const res = await fetch(`${getApiUrl()}/favicons/${path}`, {
    ...init,
    headers: authCookieHeader ? { "Better-Auth-Cookie": authCookieHeader } : {},
    credentials: getAuthRequestCredentials(authCookieHeader),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Favicon change failed: ${res.status}`);
  }
  return res;
}

export const projectMutations = {
  uploadFavicon: () => ({
    mutationFn: async ({ projectId, file }: { projectId: number; file: globalThis.File }) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("projectId", String(projectId));
      const res = await sendFaviconChange("upload", { method: "POST", body: formData });
      return res.json() as Promise<{ updatedAt: number }>;
    },
  }),
  deleteFavicon: () => ({
    mutationFn: async ({ projectId }: { projectId: number }) => {
      await sendFaviconChange(String(projectId), { method: "DELETE" });
    },
  }),
};

export const layoutQueries = {
  list: (scope: DraftScope, projectId: number) => ({
    ...getOrpc().layouts.list.queryOptions({
      input: { projectId },
      staleTime: Infinity,
    }),
    queryKey: scope.keyFor(queryKeys.layouts.all),
  }),
};

export const blockQueries = {
  get: (scope: DraftScope, id: string) => ({
    ...getOrpc().blocks.get.queryOptions({
      input: { id },
      staleTime: Infinity,
    }),
    queryKey: scope.keyFor(queryKeys.blocks.get(id)),
  }),

  getUsageCounts: (scope: DraftScope, projectId: number) => ({
    ...getOrpc().blocks.getUsageCounts.queryOptions({
      input: { projectId },
      staleTime: Infinity,
    }),
    queryKey: scope.keyFor(queryKeys.blocks.getUsageCounts),
    select: (data: BlockUsageCounts) => {
      const counts: Record<string, number> = {};
      for (const { type, count } of data) {
        counts[type] = count;
      }
      return counts;
    },
  }),

  // The distinct Pages placing a Block Definition, unlike usage counts.
  getPagesUsing: (scope: DraftScope, projectId: number, type: string) => ({
    ...getOrpc().blocks.getPagesUsing.queryOptions({
      input: { projectId, type },
      staleTime: Infinity,
    }),
    queryKey: scope.keyFor(queryKeys.blocks.getPagesUsing(type)),
  }),

  // A Synced Block's shared content, or null when it has none yet.
  getSyncedContent: (scope: DraftScope, projectId: number, type: string) => ({
    ...getOrpc().blocks.getSyncedContent.queryOptions({
      input: { projectId, type },
      staleTime: Infinity,
    }),
    queryKey: scope.keyFor(queryKeys.blocks.getSyncedContent(type)),
  }),

  getPageMarkdown: (scope: DraftScope, pageId: string) => ({
    ...getOrpc().blocks.getPageMarkdown.queryOptions({
      input: { pageId },
      staleTime: Infinity,
    }),
    queryKey: scope.keyFor(queryKeys.blocks.getPageMarkdown(pageId)),
    select: (data: { markdown: string }) => data.markdown,
  }),
};

export const draftQueries = {
  // Open drafts and Live's latest publish. The same whatever draft the viewer is in, so a Live
  // invalidation refreshes it for everyone.
  list: (projectId: number) => ({
    ...getOrpc().drafts.list.queryOptions({ input: { projectId }, staleTime: Infinity }),
    queryKey: [...queryKeys.drafts.list, projectId] as const,
  }),
  // The draft the studio is in: its name, creator and change count.
  get: (projectId: number, draftId: string) => ({
    ...getOrpc().drafts.get.queryOptions({ input: { projectId }, staleTime: Infinity }),
    queryKey: [...queryKeys.drafts.get, draftId] as const,
  }),
  // What publishing the draft will do. Always refetched when the review opens, since conflicts
  // depend on Live at that moment.
  previewPublish: (projectId: number, draftId: string) => ({
    ...getOrpc().drafts.previewPublish.queryOptions({ input: { projectId }, staleTime: 0 }),
    queryKey: [...queryKeys.drafts.previewPublish, draftId] as const,
  }),
};

export const draftMutations = {
  rename: () => getOrpc().drafts.rename.mutationOptions(),
  publish: () => getOrpc().drafts.publish.mutationOptions(),
  discard: () => getOrpc().drafts.discard.mutationOptions(),
};

export const repeatableItemQueries = {
  get: (scope: DraftScope, id: string) => ({
    ...getOrpc().repeatableItems.get.queryOptions({
      input: { id },
      staleTime: Infinity,
    }),
    queryKey: scope.keyFor(queryKeys.repeatableItems.get(id)),
  }),
};

export const blockMutations = {
  create: () => getOrpc().blocks.create.mutationOptions(),
  delete: () => getOrpc().blocks.delete.mutationOptions(),
  deleteMany: () => getOrpc().blocks.deleteMany.mutationOptions(),
  duplicate: () => getOrpc().blocks.duplicate.mutationOptions(),
  updateContent: () => getOrpc().blocks.updateContent.mutationOptions(),
  updateSettings: () => getOrpc().blocks.updateSettings.mutationOptions(),
  updatePosition: () => getOrpc().blocks.updatePosition.mutationOptions(),
};

export const repeatableItemMutations = {
  create: () => getOrpc().repeatableItems.create.mutationOptions(),
  delete: () => getOrpc().repeatableItems.delete.mutationOptions(),
  duplicate: () => getOrpc().repeatableItems.duplicate.mutationOptions(),
  updateContent: () => getOrpc().repeatableItems.updateContent.mutationOptions(),
  updateSettings: () => getOrpc().repeatableItems.updateSettings.mutationOptions(),
  updatePosition: () => getOrpc().repeatableItems.updatePosition.mutationOptions(),
};

/**
 * Sends a change to a page's custom OG image. Like a file upload it is a content write outside
 * oRPC: on Live it starts a draft, which the studio enters once the change succeeds.
 */
async function sendOgImageChange(pageId: string, init: { method: string; body?: FormData }) {
  const authCookieHeader = getAuthCookieHeader();
  const draft = getContentWriteHeaders();
  try {
    const res = await fetch(`${getApiUrl()}/pages/${pageId}/og-image`, {
      ...init,
      headers: {
        ...(authCookieHeader ? { "Better-Auth-Cookie": authCookieHeader } : {}),
        ...draft.headers,
      },
      credentials: getAuthRequestCredentials(authCookieHeader),
    });
    draft.settle(res.ok);
    return res;
  } catch (error) {
    draft.settle(false);
    throw error;
  }
}

export const pageMutations = {
  create: () => getOrpc().pages.create.mutationOptions(),
  delete: () => getOrpc().pages.delete.mutationOptions(),
  update: () => getOrpc().pages.update.mutationOptions(),
  setLayout: () => getOrpc().pages.setLayout.mutationOptions(),
  setSeo: () => getOrpc().pages.setSeo.mutationOptions(),
  uploadCustomOgImage: () => ({
    mutationFn: async ({ pageId, file }: { pageId: string; file: globalThis.File }) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await sendOgImageChange(pageId, { method: "POST", body: formData });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Upload failed: ${res.status}`);
      }
      return res.json() as Promise<Page>;
    },
  }),
  deleteCustomOgImage: () => ({
    mutationFn: async ({ pageId }: { pageId: string }) => {
      const res = await sendOgImageChange(pageId, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      return res.json();
    },
  }),
};

export const fileMutations = {
  delete: () => getOrpc().files.delete.mutationOptions(),
  deleteMany: () => getOrpc().files.deleteMany.mutationOptions(),
  setAiMetadata: () => getOrpc().files.setAiMetadata.mutationOptions(),
  setFilename: () => getOrpc().files.setFilename.mutationOptions(),
  setAlt: () => getOrpc().files.setAlt.mutationOptions(),
};
