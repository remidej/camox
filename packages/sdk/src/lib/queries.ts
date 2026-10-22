import { type ApiClient, getApiUrl, getContentWriteHeaders, getOrpc } from "./api-client";
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
  /** Each block's Structured Data nodes, from a full read: a structure read has none. */
  structuredData?: PageWithBlocks["structuredData"];
};
export type Project = Awaited<ReturnType<ApiClient["projects"]["getByUuid"]>>;
export type Layout = Awaited<ReturnType<ApiClient["layouts"]["list"]>>[number];
export type BlockUsageCounts = Awaited<ReturnType<ApiClient["blocks"]["getUsageCounts"]>>;
export type DraftList = Awaited<ReturnType<ApiClient["drafts"]["list"]>>;
export type DraftSummary = DraftList["drafts"][number];

// --- Mutations ---

export const collectionMutations = {
  create: () => getOrpc().collectionDefinitions.createRecord.mutationOptions(),
  edit: () => getOrpc().collectionDefinitions.editRecord.mutationOptions(),
  delete: () => getOrpc().collectionDefinitions.deleteRecord.mutationOptions(),
};

export type CollectionRecord = Awaited<ReturnType<ApiClient["collectionDefinitions"]["getRecord"]>>;
/** The pages and records deleted from a locale, as the default locale shows them. */
export type MissingFromLocale = Awaited<ReturnType<ApiClient["locales"]["listMissing"]>>;

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
  updateSocialProfiles: () => getOrpc().projects.updateSocialProfiles.mutationOptions(),
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

export const draftMutations = {
  publish: () => getOrpc().drafts.publish.mutationOptions(),
  discard: () => getOrpc().drafts.discard.mutationOptions(),
};

/** Adding and removing locales: content writes, so on Live they start a draft (ADR 0015). */
export const localeMutations = {
  add: () => getOrpc().locales.add.mutationOptions(),
  remove: () => getOrpc().locales.remove.mutationOptions(),
  /** Adds a page or record deleted from the locale viewed back to it. */
  addBack: () => getOrpc().locales.addBack.mutationOptions(),
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
