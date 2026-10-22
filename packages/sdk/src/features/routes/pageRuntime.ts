import type { Router } from "@camox/api-contract";
import {
  DRAFT_ENDED_ERROR_CODE,
  DRAFT_HEADER,
  NO_DEVELOPMENT_DRAFT_ERROR,
  type EndedDraft,
} from "@camox/api-contract/drafts";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import type { QueryClient } from "@tanstack/react-query";

import type { CamoxApp } from "../../core/createApp";
import type { Layout } from "../../core/createLayout";
import { curatedLayoutContext, type AnyLayoutContext } from "../../core/layoutContext";
import { isArticle, type LayoutStructuredData } from "../../core/structuredData";
import { createDraftScope, withoutDraft } from "../../lib/draft-scope";
import { linkFallbackLocale } from "../../lib/link-pages";
import { localeHeaders, UNNAMED_DEFAULT_LOCALE, type LocaleView } from "../../lib/locale-path";
import { createStudioCache, reads, type StudioCache } from "../../lib/studio-reads";
import { PAGE_IMAGE_SIZE, pageImageUrl } from "../og/pageImage";

type PageWithBlocks = Awaited<ReturnType<RouterClient<Router>["pages"]["getByPath"]>>;

export type MemberProject = Awaited<ReturnType<RouterClient<Router>["projects"]["getByUuid"]>>;

export type PageStructure = {
  page: PageWithBlocks["page"];
  layout: PageWithBlocks["layout"];
  projectName: string;
  project: PageWithBlocks["project"];
  /** Each block's Structured Data nodes, from a full read: a structure read has none. */
  structuredData?: PageWithBlocks["structuredData"];
  /** The nodes of the records its blocks reference, from a full read. */
  recordStructuredData?: PageWithBlocks["recordStructuredData"];
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
  /** The locale to read the page in. Without it, the default locale. */
  locale?: LocaleView;
  /** The page's path in its locale, after the locale's prefix. */
  pathname: string;
  projectUuid: string;
  queryClient: QueryClient;
}

interface LoadPageForRequestOptions {
  apiUrl: string;
  authCookieHeader?: string;
  /** The draft the request's URL names. Only a member reads it; anyone else reads Live. */
  draftId?: string;
  /** The locale to read the page in. Without it, the default locale. */
  locale?: LocaleView;
  origin: string;
  /** The page's path in its locale, after the locale's prefix. */
  pathname: string;
  projectUuid: string;
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
  options?: { authCookieHeader?: string; draftId?: string; locale?: LocaleView },
): RouterClient<Router> {
  const headers = localeHeaders(options?.locale);
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
  return read.refusedDraft ? withoutDraft(url) : url;
}

export async function loadCamoxPage({
  apiUrl,
  authCookieHeader,
  draftId,
  locale,
  pathname,
  projectUuid,
  queryClient,
}: LoadPageOptions): Promise<PageStructure> {
  const studioCache = createServerStudioCache(queryClient, { apiUrl, authCookieHeader, locale });
  // Only a session names the draft, so without one the read is Live's.
  const inDraft = { in: draftId && authCookieHeader ? draftId : null };
  const fallback = locale && linkFallbackLocale(locale);
  const [page] = await Promise.all([
    studioCache.ensure(reads.pageStructure({ path: pathname, projectUuid }), inDraft),
    // Links resolve against the site's pages, and the pages they fall back to, which a render can
    // do without.
    studioCache.ensure(reads.pageList({ projectUuid }), inDraft).catch(() => null),
    fallback &&
      studioCache
        .ensure(reads.pageList({ projectUuid }), { ...inDraft, locale: fallback })
        .catch(() => null),
  ]);
  return page;
}

/**
 * The studio's reads for one server request, read with its session. Each operation names the
 * draft it acts in, once the request settled which one it reads.
 */
export function createServerStudioCache(
  queryClient: QueryClient,
  {
    apiUrl,
    authCookieHeader,
    locale,
  }: {
    apiUrl: string;
    authCookieHeader?: string;
    /** The locale the request renders. Without it, the default locale. */
    locale?: LocaleView;
  },
): StudioCache {
  return createStudioCache({
    queryClient,
    scope: createDraftScope({ queryClient }),
    api: (draft, inLocale) =>
      createServerApiClient(apiUrl, {
        authCookieHeader,
        draftId: draft ?? undefined,
        locale: inLocale,
      }),
    ...(locale && { locale: () => locale }),
  });
}

/**
 * The locales of the scope a request reads: the URL's draft's for a session naming one, else
 * Live's. A draft the API refuses reads Live's, as the request's other reads then do.
 */
export async function readScopeLocales({
  apiUrl,
  authCookieHeader,
  draftId,
  projectUuid,
}: {
  apiUrl: string;
  authCookieHeader?: string;
  draftId?: string;
  projectUuid: string;
}): Promise<LocaleView[]> {
  // The API checks the session is a member's: a refusal reads Live's.
  const { value } = await readDraftOrLive(draftId, !!authCookieHeader, (readDraftId) =>
    createServerApiClient(apiUrl, {
      authCookieHeader: readDraftId ? authCookieHeader : undefined,
      draftId: readDraftId,
    }).locales.list({ projectUuid }),
  );
  return value;
}

/**
 * The project, when the auth cookie is a valid session of one of its members. A successful
 * protected project lookup validates both session and project access: cookie presence alone
 * is not proof of authentication. An invalid session asks for the cookie to be cleared.
 */
export async function resolveMemberProject({
  apiUrl,
  authCookieHeader,
  projectUuid,
}: {
  apiUrl: string;
  authCookieHeader?: string;
  projectUuid: string;
}): Promise<{ project?: MemberProject; clearAuthCookie: boolean }> {
  if (!authCookieHeader) return { clearAuthCookie: false };
  try {
    const project = await createServerApiClient(apiUrl, {
      authCookieHeader,
    }).projects.getByUuid({ projectUuid });
    return { project, clearAuthCookie: false };
  } catch (error) {
    if (!isAuthSessionError(error)) throw error;
    return { clearAuthCookie: true };
  }
}

/**
 * The project's favicon, which falls back to the default favicon when none was uploaded.
 * Pass `withDefault: false` to get a 404 instead, to learn whether there is one.
 */
export function buildFaviconUrl(
  apiUrl: string,
  project: { id: number; updatedAt: number | string },
  { withDefault = true }: { withDefault?: boolean } = {},
) {
  const url = `${apiUrl}/favicons/${project.id}?v=${project.updatedAt}`;
  return withDefault ? `${url}&default=camox` : url;
}

/** The default favicon, shown by a project without its own. */
export function buildDefaultFaviconUrl(apiUrl: string) {
  return `${apiUrl}/favicons/default`;
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
  locale,
  origin,
  pathname,
  projectUuid,
  queryClient,
}: LoadPageForRequestOptions): Promise<LoadPageForRequestResult> {
  // Without a draft in the URL, every reader sees Live. The session decides whether the Studio
  // shows, whether the URL's draft is read, and which version of linked records the API resolves.
  const member = await resolveMemberProject({
    apiUrl,
    authCookieHeader,
    projectUuid,
  });
  if (member.clearAuthCookie) console.warn("[camox] Ignoring stale camox_auth_cookie.");
  const { value: page, ...read } = await readDraftOrLive(draftId, !!member.project, (readDraftId) =>
    loadCamoxPage({
      apiUrl,
      authCookieHeader: member.project ? authCookieHeader : undefined,
      draftId: readDraftId,
      locale,
      pathname,
      projectUuid,
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
  camoxApp,
  locale,
  pathname,
  projectUuid,
  request,
  url,
  onNotFound,
}: {
  apiUrl: string;
  /** Builds the page's title and description with its layout's callbacks. */
  camoxApp: CamoxApp | undefined;
  /** The locale of the page. Without it, the default locale. */
  locale?: LocaleView;
  /** The page's path in its locale. Without it, the request's path. */
  pathname?: string;
  projectUuid: string;
  request: Request;
  /** The page's absolute URL, which the front matter states. */
  url: string;
  /** Answers for a path without a curated page, such as a derived layout's page. */
  onNotFound?: () => Promise<Response | null>;
}): Promise<Response | null> {
  const api = createServerApiClient(apiUrl, { locale });
  const requestPathname = pathname ?? new URL(request.url).pathname;
  try {
    const page = await api.pages.getByPath({ path: requestPathname, projectUuid });
    const { markdown } = await api.blocks.getPageMarkdown({ pageId: page.page.id });
    if (!markdown) return null;

    const meta = buildPageMeta(curatedPageMetaInput(camoxApp, page, locale));
    return new Response(withFrontMatter(markdown, { ...meta, url }), {
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
  } catch (error) {
    if (onNotFound && isNotFoundError(error)) return onNotFound();
    return null;
  }
}

/** What a page's title and description are built from. */
export interface PageMetaInput {
  layout:
    | Pick<Layout["_internal"], "id" | "toTitle" | "toDescription" | "toStructuredData">
    | undefined;
  /** The context the layout's `to*` options receive. */
  context: AnyLayoutContext;
}

export interface PageHeadInput extends PageMetaInput {
  /** The editor's custom image, which replaces the one `/og` renders. */
  customOgImageUrl?: string | null;
  origin: string;
  faviconUrl: string;
  /** Whether the page has a Markdown Representation, which the head then links to. */
  hasMarkdown: boolean;
  /**
   * The `@type` of a record page's record, as its node has it: the page's main entity when the
   * layout declares none.
   */
  recordType?: string;
}

/** A page's title and description, built by its layout's `toTitle` and `toDescription`. */
export function buildPageMeta(input: PageMetaInput): { title: string; description?: string } {
  const { layout, context } = input;
  const title = layout ? layout.toTitle(context) : context.page.title;
  const description = layout ? layout.toDescription(context) : context.page.description;
  return { title, ...(description && { description }) };
}

/** What a page's layout says the page is, from the page's context. */
export function declarePage(input: PageMetaInput): LayoutStructuredData | undefined {
  return input.layout?.toStructuredData(input.context);
}

/** A curated page's meta input. Its path keeps the prefix of the page's `locale`. */
export function curatedPageMetaInput(
  camoxApp: CamoxApp | undefined,
  page: PageStructure,
  locale: LocaleView = UNNAMED_DEFAULT_LOCALE,
): PageMetaInput {
  return {
    layout: page.layout ? camoxApp?.getLayoutById(page.layout.layoutId)?._internal : undefined,
    context: curatedLayoutContext(page, locale),
  };
}

/** A Markdown Representation, opened by YAML front matter stating the page's title, description and URL. */
export function withFrontMatter(
  markdown: string,
  meta: { title: string; description?: string; url: string },
): string {
  const fields = Object.entries({
    title: meta.title,
    description: meta.description,
    url: meta.url,
  }).filter((field): field is [string, string] => !!field[1]);
  // A JSON string is a valid YAML double-quoted scalar, so any text stays a single value.
  const lines = fields.map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  return `---\n${lines.join("\n")}\n---\n\n${markdown}`;
}

export type PageHead = {
  meta?: Array<Record<string, string>>;
  links?: Array<Record<string, string>>;
  /** Scripts with their text, such as the page's Structured Data. */
  scripts?: Array<{ type: string; text: string }>;
};

/** The head every page gets, whatever its layout kind. */
export function buildPageHead(input: PageHeadInput): PageHead {
  const { title, description } = buildPageMeta(input);
  const declared = declarePage(input);
  // What the page is about: what its layout declares, else a record page's record.
  const mainEntity = declared ?? (input.recordType ? { "@type": input.recordType } : undefined);

  const meta: Array<Record<string, string>> = [{ title }];
  if (description) meta.push({ name: "description", content: description });

  const { page, project } = input.context;
  const ogImageUrl = pageImageUrl({
    origin: input.origin,
    path: page.path,
    customImageUrl: input.customOgImageUrl,
  });

  meta.push(
    { property: "og:title", content: title },
    { property: "og:image", content: ogImageUrl },
    { property: "og:image:width", content: String(PAGE_IMAGE_SIZE.width) },
    { property: "og:image:height", content: String(PAGE_IMAGE_SIZE.height) },
  );
  if (description) meta.push({ property: "og:description", content: description });
  meta.push(
    {
      property: "og:type",
      content: isArticle(mainEntity ?? { "@type": "" }) ? "article" : "website",
    },
    { property: "og:site_name", content: project.name },
    { name: "twitter:card", content: "summary_large_image" },
  );

  const links: Array<Record<string, string>> = [{ rel: "icon", href: input.faviconUrl }];
  if (input.hasMarkdown)
    links.push({
      rel: "alternate",
      type: "text/markdown",
      href: `${input.origin}${getMarkdownPath(page.path)}`,
    });

  return { meta, links };
}

/** A curated page's head. Its paths keep the prefix of the page's `locale`. */
export function buildCamoxPageHead(
  camoxApp: CamoxApp,
  loaderData?: CamoxPageLoaderData,
  locale?: LocaleView,
): PageHead {
  if (!loaderData) return {};

  const { page, origin, faviconUrl } = loaderData;
  return buildPageHead({
    ...curatedPageMetaInput(camoxApp, page, locale),
    customOgImageUrl: page.page.customOgImageUrl,
    origin,
    faviconUrl,
    hasMarkdown: true,
  });
}
