import { queryKeys, type ReadSource } from "@camox/api-contract/query-keys";

import { type ApiClient, getApiUrl, getEnvironmentName, getOrpc } from "./api-client";
import { getAuthCookieHeader, getAuthRequestCredentials } from "./auth";

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
type CheckCompatibilityResponse = Awaited<
  ReturnType<ApiClient["environments"]["checkCompatibility"]>
>;
export type CompatibilityReason = CheckCompatibilityResponse["reasons"][number];

// --- Query factories ---

export const collectionQueries = {
  list: (projectSlug: string) => ({
    ...getOrpc().collectionDefinitions.list.queryOptions({
      input: { projectSlug },
    }),
    queryKey: queryKeys.collections.list(projectSlug, getEnvironmentName() ?? "production"),
  }),

  get: (projectSlug: string, collectionId: string) => ({
    ...getOrpc().collectionDefinitions.get.queryOptions({
      input: { projectSlug, collectionId },
    }),
    queryKey: queryKeys.collections.get(
      projectSlug,
      getEnvironmentName() ?? "production",
      collectionId,
    ),
  }),

  record: (projectSlug: string, collectionId: string, id: string) => ({
    ...getOrpc().collectionDefinitions.getRecord.queryOptions({
      input: { projectSlug, collectionId, id },
    }),
    queryKey: queryKeys.collections.record(
      projectSlug,
      getEnvironmentName() ?? "production",
      collectionId,
      id,
    ),
  }),

  records: (projectSlug: string, collectionId: string) => ({
    ...getOrpc().collectionDefinitions.listRecords.queryOptions({
      input: { projectSlug, collectionId },
    }),
    queryKey: queryKeys.collections.records(
      projectSlug,
      getEnvironmentName() ?? "production",
      collectionId,
    ),
  }),
};

export const collectionMutations = {
  create: () => getOrpc().collectionDefinitions.createRecord.mutationOptions(),
  edit: () => getOrpc().collectionDefinitions.editRecord.mutationOptions(),
  delete: () => getOrpc().collectionDefinitions.deleteRecord.mutationOptions(),
};

export type CollectionRecord = Awaited<ReturnType<ApiClient["collectionDefinitions"]["getRecord"]>>;

export const commentQueries = {
  list: (pageId: number) => ({
    ...getOrpc().comments.list.queryOptions({ input: { pageId }, staleTime: 30_000 }),
    queryKey: [...queryKeys.comments.list(pageId), getEnvironmentName() ?? "production"],
  }),
};

export const commentMutations = {
  create: () => getOrpc().comments.create.mutationOptions(),
  setResolved: () => getOrpc().comments.setResolved.mutationOptions(),
};

export const pageQueries = {
  list: (projectId: number) => ({
    ...getOrpc().pages.list.queryOptions({ input: { projectId }, staleTime: Infinity }),
    queryKey: queryKeys.pages.list,
  }),

  getByPath: (fullPath: string, projectSlug: string, source: ReadSource = "draft") => ({
    ...getOrpc().pages.getByPath.queryOptions({
      input: { path: fullPath, projectSlug, source },
      staleTime: Infinity,
    }),
    queryKey: queryKeys.pages.getByPath(fullPath, source),
  }),

  getById: (id: number) => ({
    ...getOrpc().pages.get.queryOptions({
      input: { id },
      staleTime: Infinity,
    }),
    queryKey: queryKeys.pages.getById(id),
  }),
};

export const fileQueries = {
  list: (projectId: number) => ({
    ...getOrpc().files.list.queryOptions({ input: { projectId }, staleTime: Infinity }),
    queryKey: queryKeys.files.list,
  }),

  get: (id: number) => ({
    ...getOrpc().files.get.queryOptions({
      input: { id },
      staleTime: Infinity,
    }),
    queryKey: queryKeys.files.get(id),
  }),

  getUsageCount: (id: number) => ({
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

export const layoutQueries = {
  list: (projectId: number) => ({
    ...getOrpc().layouts.list.queryOptions({
      input: { projectId },
      staleTime: Infinity,
    }),
    queryKey: queryKeys.layouts.all,
  }),
};

export const blockQueries = {
  // Source is split into draft/live cache slots so toggling the studio source
  // select is instant once both have been populated. The studio's default is
  // 'draft' (matches today's edit-loop behavior); SSR seeds 'live' for the
  // public visitor path.
  get: (id: number, source: ReadSource = "draft") => ({
    ...getOrpc().blocks.get.queryOptions({
      input: { id, source },
      staleTime: Infinity,
    }),
    queryKey: queryKeys.blocks.get(id, source),
  }),

  getUsageCounts: (projectId: number) => ({
    ...getOrpc().blocks.getUsageCounts.queryOptions({
      input: { projectId },
      staleTime: Infinity,
    }),
    queryKey: queryKeys.blocks.getUsageCounts,
    select: (data: BlockUsageCounts) => {
      const counts: Record<string, number> = {};
      for (const { type, count } of data) {
        counts[type] = count;
      }
      return counts;
    },
  }),

  getPageMarkdown: (pageId: number) => ({
    ...getOrpc().blocks.getPageMarkdown.queryOptions({
      input: { pageId },
      staleTime: Infinity,
    }),
    queryKey: queryKeys.blocks.getPageMarkdown(pageId),
    select: (data: { markdown: string }) => data.markdown,
  }),
};

export const environmentQueries = {
  // Param-aware queryKey so push (current → prod) and pull (prod → current) get
  // distinct cache slots; both still fall under the `environments.checkCompatibility`
  // namespace so the server-side broadcast invalidates them as a prefix.
  checkCompatibility: (projectId: number, sourceEnvName: string, targetEnvName: string) => ({
    ...getOrpc().environments.checkCompatibility.queryOptions({
      input: { projectId, sourceEnvName, targetEnvName },
      staleTime: Infinity,
    }),
    queryKey: [...queryKeys.environments.checkCompatibility, sourceEnvName, targetEnvName] as const,
  }),
};

export const environmentMutations = {
  replicate: () => getOrpc().environments.replicate.mutationOptions(),
};

export const repeatableItemQueries = {
  get: (id: number) => ({
    ...getOrpc().repeatableItems.get.queryOptions({
      input: { id },
      staleTime: Infinity,
    }),
    queryKey: queryKeys.repeatableItems.get(id),
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

function ogImageHeaders(): Record<string, string> {
  const authCookieHeader = getAuthCookieHeader();
  const headers: Record<string, string> = {};
  if (authCookieHeader) headers["Better-Auth-Cookie"] = authCookieHeader;
  const envName = getEnvironmentName();
  if (envName) headers["x-environment-name"] = envName;
  return headers;
}

export const pageMutations = {
  create: () => getOrpc().pages.create.mutationOptions(),
  delete: () => getOrpc().pages.delete.mutationOptions(),
  update: () => getOrpc().pages.update.mutationOptions(),
  setLayout: () => getOrpc().pages.setLayout.mutationOptions(),
  setAiSeo: () => getOrpc().pages.setAiSeo.mutationOptions(),
  setMetaTitle: () => getOrpc().pages.setMetaTitle.mutationOptions(),
  setMetaDescription: () => getOrpc().pages.setMetaDescription.mutationOptions(),
  publish: () => getOrpc().pages.publish.mutationOptions(),
  unpublish: () => getOrpc().pages.unpublish.mutationOptions(),
  discardChanges: () => getOrpc().pages.discardChanges.mutationOptions(),
  uploadCustomOgImage: () => ({
    mutationFn: async ({ pageId, file }: { pageId: number; file: globalThis.File }) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${getApiUrl()}/pages/${pageId}/og-image`, {
        method: "POST",
        body: formData,
        headers: ogImageHeaders(),
        credentials: getAuthRequestCredentials(),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Upload failed: ${res.status}`);
      }
      return res.json() as Promise<Page>;
    },
  }),
  deleteCustomOgImage: () => ({
    mutationFn: async ({ pageId }: { pageId: number }) => {
      const res = await fetch(`${getApiUrl()}/pages/${pageId}/og-image`, {
        method: "DELETE",
        headers: ogImageHeaders(),
        credentials: getAuthRequestCredentials(),
      });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      return res.json();
    },
  }),
};

export const fileMutations = {
  delete: () => getOrpc().files.delete.mutationOptions(),
  deleteMany: () => getOrpc().files.deleteMany.mutationOptions(),
  replace: () => getOrpc().files.replace.mutationOptions(),
  setAiMetadata: () => getOrpc().files.setAiMetadata.mutationOptions(),
  setFilename: () => getOrpc().files.setFilename.mutationOptions(),
  setAlt: () => getOrpc().files.setAlt.mutationOptions(),
};
