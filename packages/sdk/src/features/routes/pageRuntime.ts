import type { Router } from "@camox/api-contract";
import { queryKeys } from "@camox/api-contract/query-keys";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import type { QueryClient } from "@tanstack/react-query";

import type { CamoxApp } from "../../core/createApp";
import type { Layout } from "../../core/createLayout";

export type PageSource = "draft" | "live";

type PageWithBlocks = Awaited<ReturnType<RouterClient<Router>["pages"]["getByPath"]>>;

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
  environmentName?: string;
  pathname: string;
  projectSlug: string;
  queryClient: QueryClient;
  source: PageSource;
}

interface LoadPageForRequestOptions {
  apiUrl: string;
  authCookieHeader?: string;
  environmentName?: string;
  origin: string;
  pathname: string;
  projectSlug: string;
  queryClient: QueryClient;
}

interface LoadPageForRequestResult {
  data: CamoxPageLoaderData;
  shouldClearAuthCookie: boolean;
  source: PageSource;
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

export function createServerApiClient(
  apiUrl: string,
  environmentName?: string,
  options?: { authCookieHeader?: string },
): RouterClient<Router> {
  const headers: Record<string, string> = {};
  if (environmentName) headers["x-environment-name"] = environmentName;
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

function visitForFileIds(value: unknown, ids: Set<number>) {
  if (value == null || typeof value !== "object") return;
  if ("_fileId" in value && typeof (value as { _fileId: unknown })._fileId === "number") {
    ids.add((value as { _fileId: number })._fileId);
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

function collectFileIdsFromContent(content: Record<string, unknown>, ids: Set<number>) {
  for (const value of Object.values(content)) {
    visitForFileIds(value, ids);
  }
}

export function seedBlockCaches(
  queryClient: QueryClient,
  pageData: Pick<PageWithBlocks, "blocks" | "files" | "repeatableItems">,
  source: PageSource = "draft",
) {
  const filesById = new Map(pageData.files.map((f) => [f.id, f]));

  for (const block of pageData.blocks) {
    const blockItems = pageData.repeatableItems.filter((i) => i.blockId === block.id);
    const fileIds = new Set<number>();
    collectFileIdsFromContent(block.content as Record<string, unknown>, fileIds);
    for (const item of blockItems) {
      collectFileIdsFromContent(item.content as Record<string, unknown>, fileIds);
    }
    const blockFiles = [...fileIds].map((id) => filesById.get(id)).filter((f) => f != null);

    queryClient.setQueryData(queryKeys.blocks.get(block.id, source), {
      block,
      repeatableItems: blockItems,
      files: blockFiles,
    });

    for (const file of blockFiles) {
      queryClient.setQueryData(queryKeys.files.get(file.id), file);
    }
  }
}

export async function loadCamoxPage({
  apiUrl,
  authCookieHeader,
  environmentName,
  pathname,
  projectSlug,
  queryClient,
  source,
}: LoadPageOptions): Promise<PageStructure> {
  const serverApi = createServerApiClient(apiUrl, environmentName, { authCookieHeader });
  return queryClient.ensureQueryData({
    queryKey: queryKeys.pages.getByPath(pathname, source),
    queryFn: async () => {
      const [data, pagesList] = await Promise.all([
        serverApi.pages.getByPath({
          path: pathname,
          projectSlug,
          source,
        }),
        serverApi.pages.listBySlug({ projectSlug }).catch(() => null),
      ]);
      seedBlockCaches(queryClient, data, source);
      queryClient.setQueryData(queryKeys.pages.getByPath(pathname, source), {
        page: data.page,
        layout: data.layout,
        projectName: data.projectName,
        project: data.project,
      });
      if (source === "live") {
        seedBlockCaches(queryClient, data, "draft");
        queryClient.setQueryData(queryKeys.pages.getByPath(pathname, "draft"), {
          page: data.page,
          layout: data.layout,
          projectName: data.projectName,
          project: data.project,
        });
      }
      if (pagesList) {
        queryClient.setQueryData(queryKeys.pages.list, pagesList);
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

async function loadLivePage(
  options: Omit<LoadPageOptions, "authCookieHeader" | "source">,
): Promise<PageStructure> {
  return loadCamoxPage({ ...options, source: "live" });
}

export function buildFaviconUrl(
  apiUrl: string,
  project: { id: number; updatedAt: number | string },
) {
  return `${apiUrl}/favicons/${project.id}?v=${project.updatedAt}`;
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
  environmentName,
  origin,
  pathname,
  projectSlug,
  queryClient,
}: LoadPageForRequestOptions): Promise<LoadPageForRequestResult> {
  const loadOptions = {
    apiUrl,
    environmentName,
    pathname,
    projectSlug,
    queryClient,
  };

  if (!authCookieHeader) {
    const page = await loadLivePage(loadOptions);
    return {
      data: buildCamoxPageLoaderData(apiUrl, page, origin),
      shouldClearAuthCookie: false,
      source: "live",
    };
  }

  try {
    const page = await loadCamoxPage({ ...loadOptions, authCookieHeader, source: "draft" });
    return {
      data: buildCamoxPageLoaderData(apiUrl, page, origin),
      shouldClearAuthCookie: false,
      source: "draft",
    };
  } catch (error) {
    if (!isAuthSessionError(error)) throw error;

    console.warn("[camox] Ignoring stale camox_auth_cookie and retrying published page load.");
    const page = await loadLivePage(loadOptions);
    return {
      data: buildCamoxPageLoaderData(apiUrl, page, origin),
      shouldClearAuthCookie: true,
      source: "live",
    };
  }
}

export async function createMarkdownResponse({
  apiUrl,
  environmentName,
  pathname,
  projectSlug,
  request,
  onNotFound,
}: {
  apiUrl: string;
  environmentName?: string;
  pathname?: string;
  projectSlug: string;
  request: Request;
  /** Answers for a path without a curated page, such as a derived layout's page. */
  onNotFound?: () => Promise<Response | null>;
}): Promise<Response | null> {
  const accept = request.headers.get("Accept") ?? "";
  if (!prefersMarkdown(accept)) return null;

  const api = createServerApiClient(apiUrl, environmentName);
  const requestPathname = pathname ?? new URL(request.url).pathname;
  try {
    const page = await api.pages.getByPath({ path: requestPathname, projectSlug, source: "live" });
    const { markdown } = await api.blocks.getPageMarkdown({ pageId: page.page.id, source: "live" });
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

  return {
    meta,
    links: [{ rel: "icon", href: input.faviconUrl }],
  };
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
  });
}
