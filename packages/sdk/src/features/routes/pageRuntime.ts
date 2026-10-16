import type { Router } from "@camox/api-contract";
import {
  DRAFT_ENDED_ERROR_CODE,
  DRAFT_HEADER,
  DRAFT_SEARCH_PARAM,
  NO_DEVELOPMENT_DRAFT_ERROR,
  type EndedDraft,
} from "@camox/api-contract/drafts";
import { inScope, queryKeys } from "@camox/api-contract/query-keys";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import type { QueryClient } from "@tanstack/react-query";

import type { CamoxApp } from "../../core/createApp";
import type { Layout } from "../../core/createLayout";

type PageWithBlocks = Awaited<ReturnType<RouterClient<Router>["pages"]["getByPath"]>>;

export type MemberProject = Awaited<ReturnType<RouterClient<Router>["projects"]["getBySlug"]>>;

export type PageStructure = {
  page: PageWithBlocks["page"];
  layout: PageWithBlocks["layout"];
  projectName: string;
  project: PageWithBlocks["project"];
};

export interface CamoxPageLoaderData {
  page: PageStructure;
  origin: string;
  faviconUrl: string;
}

interface LoadPageOptions {
  apiUrl: string;
  authCookieHeader?: string;
  /** The draft to read instead of Live. Only sent along with a session. */
  draftId?: string;
  pathname: string;
  projectSlug: string;
  queryClient: QueryClient;
}

interface LoadPageForRequestOptions {
  apiUrl: string;
  authCookieHeader?: string;
  /** The draft the request's URL names. Only a member reads it; anyone else reads Live. */
  draftId?: string;
  origin: string;
  pathname: string;
  projectSlug: string;
  queryClient: QueryClient;
}

/**
 * Why a member can't see the draft a URL names: it doesn't exist, it's someone else's
 * development draft, or it was published or discarded (ADR 0011). In dev mode, the caller's
 * own development draft doesn't exist until the dev server's first sync creates it.
 */
export type DraftNotice =
  | { reason: "missing" }
  | { reason: "noDevelopmentDraft" }
  | { reason: "forbidden" }
  | ({ reason: "ended" } & EndedDraft);

/** Which draft a render read: the URL's, or Live when there was none or it couldn't be read. */
export interface DraftRead {
  /** The draft the render read. Absent for Live. */
  draftId?: string;
  /**
   * Present when the URL named a draft the render couldn't read, so it read Live instead. Only a
   * member gets a notice explaining why; anyone else sees Live as if the URL named no draft.
   */
  refusedDraft?: { notice: DraftNotice | null };
}

interface LoadPageForRequestResult extends DraftRead {
  data: CamoxPageLoaderData;
  /** The project, when the request carries a valid session of one of its members. */
  project?: MemberProject;
  shouldClearAuthCookie: boolean;
}

interface ErrorDetails {
  code?: string;
  status?: number;
  message: string;
}

export function parseQuality(part: string): number {
  const match = part.match(/;\s*q=([0-9.]+)/);
  return match ? parseFloat(match[1]) : 1;
}

export function prefersMarkdown(accept: string): boolean {
  let markdownQ = -1;
  let htmlQ = -1;
  for (const part of accept.split(",")) {
    const trimmed = part.trim();
    if (trimmed.startsWith("text/markdown")) {
      markdownQ = parseQuality(trimmed);
    } else if (trimmed.startsWith("text/html")) {
      htmlQ = parseQuality(trimmed);
    }
  }
  return markdownQ > 0 && markdownQ >= htmlQ;
}

/** Where a page's Markdown Representation lives: `/index.md` for the home page, `<path>.md` otherwise. */
export function getMarkdownPath(pageFullPath: string): string {
  const path = pageFullPath.replace(/\/+$/, "");
  return path ? `${path}.md` : "/index.md";
}

/** The page path a Markdown URL represents, or null when the URL isn't one. */
export function parseMarkdownPath(pathname: string): string | null {
  if (!pathname.endsWith(".md")) return null;
  if (pathname === "/index.md") return "/";
  return pathname.slice(0, -".md".length) || null;
}

export function createServerApiClient(
  apiUrl: string,
  options?: { authCookieHeader?: string; draftId?: string },
): RouterClient<Router> {
  const headers: Record<string, string> = {};
  // Only a session can read a draft, so a draft is only ever named along with one.
  if (options?.draftId && options.authCookieHeader) headers[DRAFT_HEADER] = options.draftId;
  return createORPCClient<RouterClient<Router>>(
    new RPCLink({
      url: `${apiUrl}/rpc`,
      headers,
      fetch: (request, init) => {
        if (options?.authCookieHeader && request instanceof Request) {
          request.headers.set("Better-Auth-Cookie", options.authCookieHeader);
        }
        return fetch(request, init);
      },
    }),
  );
}

function getErrorDetails(error: unknown): ErrorDetails {
  if (!error || typeof error !== "object") {
    return { message: String(error) };
  }

  const errorRecord = error as Record<string, unknown>;
  return {
    code: typeof errorRecord.code === "string" ? errorRecord.code : undefined,
    status: typeof errorRecord.status === "number" ? errorRecord.status : undefined,
    message:
      error instanceof Error
        ? error.message
        : typeof errorRecord.message === "string"
          ? errorRecord.message
          : "",
  };
}

export function isAuthSessionError(error: unknown): boolean {
  const { code, status, message } = getErrorDetails(error);
  if (code === "UNAUTHORIZED" || code === "FORBIDDEN") return true;
  if (status === 401 || status === 403) return true;

  const lowerMessage = message.toLowerCase();
  return (
    lowerMessage.includes("unauthorized") ||
    lowerMessage.includes("forbidden") ||
    lowerMessage.includes("invalid session") ||
    lowerMessage.includes("session expired") ||
    lowerMessage.includes("expired session")
  );
}

export function isNotFoundError(error: unknown): boolean {
  const { code, status } = getErrorDetails(error);
  return code === "NOT_FOUND" || status === 404;
}

/**
 * The notice for an API error refusing the draft a member named, or undefined when the error
 * isn't about the draft.
 */
function draftRefusalNotice(error: unknown, draftId: string): DraftNotice | null | undefined {
  const { code, status } = getErrorDetails(error);
  const data = (error as { data?: unknown } | null)?.data as Record<string, unknown> | undefined;
  if (code === DRAFT_ENDED_ERROR_CODE && data) return { reason: "ended", ...(data as EndedDraft) };
  if (code === NO_DEVELOPMENT_DRAFT_ERROR) return { reason: "noDevelopmentDraft" };
  if (isNotFoundError(error) && data?.draftId === draftId) return { reason: "missing" };
  if (code === "FORBIDDEN" || status === 403) return { reason: "forbidden" };
  if (code === "UNAUTHORIZED" || status === 401) return null;
  return undefined;
}

/**
 * Reads with the draft a URL names, or Live (ADR 0011). Only a member's request names the draft;
 * anyone else reads Live. When the API refuses the draft, the same response reads Live instead.
 */
export async function readDraftOrLive<T>(
  draftId: string | undefined,
  member: boolean,
  read: (draftId: string | undefined) => Promise<T>,
): Promise<DraftRead & { value: T }> {
  if (!draftId) return { value: await read(undefined) };
  if (!member) return { value: await read(undefined), refusedDraft: { notice: null } };
  try {
    return { value: await read(draftId), draftId };
  } catch (error) {
    const notice = draftRefusalNotice(error, draftId);
    if (notice === undefined) throw error;
    return { value: await read(undefined), refusedDraft: { notice } };
  }
}

/** The URL a render shows: without the draft param when the draft couldn't be read. */
export function renderedHref(url: string, read: DraftRead): string {
  if (!read.refusedDraft) return url;
  const href = new URL(url);
  href.searchParams.delete(DRAFT_SEARCH_PARAM);
  return href.href;
}

function visitForFileIds(value: unknown, ids: Set<string>) {
  if (value == null || typeof value !== "object") return;
  if ("_fileId" in value && typeof (value as { _fileId: unknown })._fileId === "string") {
    ids.add((value as { _fileId: string })._fileId);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) visitForFileIds(item, ids);
    return;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    visitForFileIds(child, ids);
  }
}

function collectFileIdsFromContent(content: Record<string, unknown>, ids: Set<string>) {
  for (const value of Object.values(content)) {
    visitForFileIds(value, ids);
  }
}

/** Caches each block of a read from Live (`draftId` null) or a draft under that scope's keys. */
export function seedBlockCaches(
  queryClient: QueryClient,
  pageData: Pick<PageWithBlocks, "blocks" | "files" | "repeatableItems">,
  draftId: string | null,
) {
  const filesById = new Map(pageData.files.map((f) => [f.id, f]));

  for (const block of pageData.blocks) {
    const blockItems = pageData.repeatableItems.filter((i) => i.blockId === block.id);
    const fileIds = new Set<string>();
    collectFileIdsFromContent(block.content as Record<string, unknown>, fileIds);
    for (const item of blockItems) {
      collectFileIdsFromContent(item.content as Record<string, unknown>, fileIds);
    }
    const blockFiles = [...fileIds].map((id) => filesById.get(id)).filter((f) => f != null);

    queryClient.setQueryData(inScope(queryKeys.blocks.get(block.id), draftId), {
      block,
      repeatableItems: blockItems,
      files: blockFiles,
    });

    for (const file of blockFiles) {
      queryClient.setQueryData(inScope(queryKeys.files.get(file.id), draftId), file);
    }
  }
}

export async function loadCamoxPage({
  apiUrl,
  authCookieHeader,
  draftId,
  pathname,
  projectSlug,
  queryClient,
}: LoadPageOptions): Promise<PageStructure> {
  const serverApi = createServerApiClient(apiUrl, { authCookieHeader, draftId });
  // Only a session names the draft, so without one the read is Live's.
  const scope = draftId && authCookieHeader ? draftId : null;
  return queryClient.ensureQueryData({
    queryKey: inScope(queryKeys.pages.getByPath(pathname), scope),
    queryFn: async () => {
      const [data, pagesList] = await Promise.all([
        serverApi.pages.getByPath({ path: pathname, projectSlug }),
        serverApi.pages.listBySlug({ projectSlug }).catch(() => null),
      ]);
      seedBlockCaches(queryClient, data, scope);
      if (pagesList) {
        queryClient.setQueryData(inScope(queryKeys.pages.list, scope), pagesList);
      }
      return {
        page: data.page,
        layout: data.layout,
        projectName: data.projectName,
        project: data.project,
      };
    },
    staleTime: Infinity,
  });
}

/**
 * The project, when the auth cookie is a valid session of one of its members. A successful
 * protected project lookup validates both session and project access: cookie presence alone
 * is not proof of authentication. An invalid session asks for the cookie to be cleared.
 */
export async function resolveMemberProject({
  apiUrl,
  authCookieHeader,
  projectSlug,
}: {
  apiUrl: string;
  authCookieHeader?: string;
  projectSlug: string;
}): Promise<{ project?: MemberProject; clearAuthCookie: boolean }> {
  if (!authCookieHeader) return { clearAuthCookie: false };
  try {
    const project = await createServerApiClient(apiUrl, {
      authCookieHeader,
    }).projects.getBySlug({ slug: projectSlug });
    return { project, clearAuthCookie: false };
  } catch (error) {
    if (!isAuthSessionError(error)) throw error;
    return { clearAuthCookie: true };
  }
}

/**
 * The project's favicon, which falls back to the Camox mark when none was uploaded. Pass
 * `placeholder: false` to get a 404 instead, to learn whether there is one.
 */
export function buildFaviconUrl(
  apiUrl: string,
  project: { id: number; updatedAt: number | string },
  { placeholder = true }: { placeholder?: boolean } = {},
) {
  const url = `${apiUrl}/favicons/${project.id}?v=${project.updatedAt}`;
  return placeholder ? `${url}&placeholder=camox` : url;
}

/** The Camox mark a project without a favicon shows. */
export function buildFaviconPlaceholderUrl(apiUrl: string) {
  return `${apiUrl}/favicons/placeholder`;
}

export function buildCamoxPageLoaderData(
  apiUrl: string,
  page: PageStructure,
  origin: string,
): CamoxPageLoaderData {
  return { page, origin, faviconUrl: buildFaviconUrl(apiUrl, page.project) };
}

export async function loadCamoxPageForRequest({
  apiUrl,
  authCookieHeader,
  draftId,
  origin,
  pathname,
  projectSlug,
  queryClient,
}: LoadPageForRequestOptions): Promise<LoadPageForRequestResult> {
  // Without a draft in the URL, every reader sees Live. The session decides whether the Studio
  // shows, whether the URL's draft is read, and which version of linked records the API resolves.
  const member = await resolveMemberProject({
    apiUrl,
    authCookieHeader,
    projectSlug,
  });
  if (member.clearAuthCookie) console.warn("[camox] Ignoring stale camox_auth_cookie.");
  const { value: page, ...read } = await readDraftOrLive(draftId, !!member.project, (readDraftId) =>
    loadCamoxPage({
      apiUrl,
      authCookieHeader: member.project ? authCookieHeader : undefined,
      draftId: readDraftId,
      pathname,
      projectSlug,
      queryClient,
    }),
  );
  return {
    ...read,
    data: buildCamoxPageLoaderData(apiUrl, page, origin),
    project: member.project,
    shouldClearAuthCookie: member.clearAuthCookie,
  };
}

export async function createMarkdownResponse({
  apiUrl,
  pathname,
  projectSlug,
  request,
  onNotFound,
}: {
  apiUrl: string;
  pathname?: string;
  projectSlug: string;
  request: Request;
  /** Answers for a path without a curated page, such as a derived layout's page. */
  onNotFound?: () => Promise<Response | null>;
}): Promise<Response | null> {
  const api = createServerApiClient(apiUrl);
  const requestPathname = pathname ?? new URL(request.url).pathname;
  try {
    const page = await api.pages.getByPath({ path: requestPathname, projectSlug });
    const { markdown } = await api.blocks.getPageMarkdown({ pageId: page.page.id });
    if (!markdown) return null;

    return new Response(markdown, {
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
  } catch (error) {
    if (onNotFound && isNotFoundError(error)) return onNotFound();
    return null;
  }
}

export interface PageHeadInput {
  layout: Pick<Layout["_internal"], "id" | "buildMetaTitle" | "buildMetaDescription"> | undefined;
  /** The editor's meta title for curated pages, the layout's title for code-owned pages. */
  pageMetaTitle: string;
  pageMetaDescription: string | undefined;
  /** The title the /og image shows; defaults to the built meta title. */
  ogImageTitle?: string;
  customOgImageUrl?: string | null;
  data: unknown;
  /** On record pages: the record's String fields as plain text. */
  item?: Record<string, string>;
  params: Record<string, string>;
  projectName: string;
  pageFullPath: string;
  origin: string;
  faviconUrl: string;
  /** Whether the page has a Markdown Representation, which the head then links to. */
  hasMarkdown: boolean;
}

export type PageHead = {
  meta?: Array<Record<string, string>>;
  links?: Array<Record<string, string>>;
};

/** The head every page gets, whatever its layout kind. */
export function buildPageHead(input: PageHeadInput): PageHead {
  const context = {
    data: input.data,
    ...(input.item && { item: input.item }),
    params: input.params,
    projectName: input.projectName,
    pageFullPath: input.pageFullPath,
  };
  const title =
    input.layout?.buildMetaTitle({ ...context, pageMetaTitle: input.pageMetaTitle }) ??
    input.pageMetaTitle;
  const description = input.layout?.buildMetaDescription
    ? input.layout.buildMetaDescription({
        ...context,
        pageMetaDescription: input.pageMetaDescription,
      })
    : input.pageMetaDescription;

  const meta: Array<Record<string, string>> = [{ title }];
  if (description) meta.push({ name: "description", content: description });

  const ogImageParams = new URLSearchParams({
    ...(input.layout && { layoutId: input.layout.id }),
    title: input.ogImageTitle ?? title,
    ...(description && { description }),
    ...(input.projectName && { projectName: input.projectName }),
  });
  const ogImageUrl = input.customOgImageUrl ?? `${input.origin}/og?${ogImageParams.toString()}`;

  meta.push(
    { property: "og:title", content: title },
    { property: "og:image", content: ogImageUrl },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
  );
  if (description) meta.push({ property: "og:description", content: description });

  const links: Array<Record<string, string>> = [{ rel: "icon", href: input.faviconUrl }];
  if (input.hasMarkdown)
    links.push({
      rel: "alternate",
      type: "text/markdown",
      href: `${input.origin}${getMarkdownPath(input.pageFullPath)}`,
    });

  return { meta, links };
}

export function buildCamoxPageHead(camoxApp: CamoxApp, loaderData?: CamoxPageLoaderData): PageHead {
  if (!loaderData) return {};

  const { page, origin, faviconUrl } = loaderData;
  const pageMetaTitle = page.page.metaTitle ?? page.page.pathSegment;
  return buildPageHead({
    layout: page.layout ? camoxApp.getLayoutById(page.layout.layoutId)?._internal : undefined,
    pageMetaTitle,
    pageMetaDescription: page.page.metaDescription ?? undefined,
    ogImageTitle: pageMetaTitle,
    customOgImageUrl: page.page.customOgImageUrl,
    data: undefined,
    params: {},
    projectName: page.projectName,
    pageFullPath: page.page.fullPath,
    origin,
    faviconUrl,
    hasMarkdown: true,
  });
}
