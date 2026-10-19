import { DEVELOPMENT_DRAFT, LOCALE_HEADER } from "@camox/api-contract/drafts";
import { QueryClient, dehydrate } from "@tanstack/react-query";
import { createHead, renderSSRHead } from "@unhead/react/server";
import type { Link, Meta, UseHeadInput } from "unhead/types";

import type { CamoxApp } from "../../core/createApp";
import type { AnyLayoutLoaderResult } from "../../core/createLayout";
import type { CamoxDocument } from "../../core/defineDocument";
import { discoverLayoutPages, matchDerivedLayout } from "../../core/derivedRoutes";
import { asCollectionItem, recordMarkdownTemplate, recordPlainText } from "../../core/recordItem";
import {
  createRequestContext,
  type LayoutRequestContext,
  type RecordLookup,
} from "../../core/requestContext";
import { draftNamedBy } from "../../lib/draft-scope";
import {
  localizedPath,
  UNNAMED_DEFAULT_LOCALE,
  parseLocalePath,
  type LocalePath,
  type LocaleView,
} from "../../lib/locale-path";
import { PLATFORM_SCRIPT } from "../../lib/platform";
import {
  buildClearServerAuthCookieHeader,
  getServerAuthCookieHeader,
} from "../../lib/server-auth-cookie";
import { reads } from "../../lib/studio-reads";
import {
  buildCamoxPageHead,
  buildFaviconUrl,
  buildPageHead,
  buildPageMeta,
  createMarkdownResponse,
  parseMarkdownPath,
  createServerApiClient,
  createServerStudioCache,
  isNotFoundError,
  loadCamoxPageForRequest,
  prefersMarkdown,
  withFrontMatter,
  readDraftOrLive,
  readScopeLocales,
  renderedHref,
  resolveMemberProject,
  type DraftRead,
  type MemberProject,
} from "../routes/pageRuntime";
import {
  matchCanvasOnlyPath,
  matchCollectionContentPath,
  STUDIO_ASSETS_PATH,
  STUDIO_CONTENT_PATH,
} from "../studio/routes";
import { STUDIO_THEME_SCRIPT } from "../studio/studioTheme";
import { omitArtifactSources } from "./artifactSources";
import { type LivePage, listLivePages, RouteDiscoveryError } from "./livePages";
import { formatLlmsTxt } from "./llmsTxt";
import { getPageBlockTypes } from "./pageBlockTypes";
import {
  matchRuntimeOwnedRoute,
  RUNTIME_ROUTE_PATHS,
  type RuntimeOwnedRouteKind,
} from "./runtimeRoutes";
import type { StudioRenderInput } from "./studioApp";

const DEFAULT_RUNTIME_BASE_PATH = "";

export type RuntimeRouteKind =
  | RuntimeOwnedRouteKind
  | "canvas"
  | "page"
  | "studio"
  | "studio-content"
  | "studio-nested";

export interface RuntimeRouteMatch {
  kind: RuntimeRouteKind;
  pathname: string;
}

export interface LayoutIdentity {
  blockIds: string[];
  layoutId: string;
  version: string;
}

/** Which version of collection records a request reads: members read their saved drafts. */
type RecordSource = "draft" | "live";

export interface PageRenderInput extends DraftRead {
  /** Authenticate before rendering, to show the Studio around the page. */
  previewHandoff?: boolean;
  previewDocument?: string;
  routeKind?: "studio" | "studio-content" | "studio-nested";
  /**
   * A location only the Canvas shows, instead of a Page: the Canvas
   * with nothing selected, or with a block of the Block Catalog selected.
   */
  canvasOnly?: { blockId?: string };
  project?: MemberProject;
  presentation?: "public" | "studio";
  derived?: {
    layoutId: string;
    result?: AnyLayoutLoaderResult;
    layout: Awaited<
      ReturnType<ReturnType<typeof createServerApiClient>["layouts"]["get"]>
    >["layout"];
  };
  apiUrl: string;
  authenticationUrl: string;
  dehydratedState: unknown;
  head: unknown;
  href: string;
  layoutIdentity: LayoutIdentity | null;
  loaderData: unknown;
  /** The locale the render shows, named by the path's prefix. */
  locale: LocaleView;
  /** The locales of the scope the render reads: Live's, or its draft's. */
  locales: LocaleView[];
  /**
   * The full runtime path, with the locale's prefix (`/de/preise`). The locale-relative path is
   * `parseLocalePath(pathname, locales).path`.
   */
  pathname: string;
  projectSlug: string;
  runtimeBasePath: string;
}

/**
 * A request's path in its locale: the locales of the scope it reads, the locale its path's
 * prefix names, and the locale-relative path after the prefix.
 */
interface RequestLocale extends LocalePath {
  locales: LocaleView[];
}

export interface RuntimeOptions {
  apiUrl?: string;
  authenticationUrl?: string;
  /** Where the browser loads each block from, so a page can preload the blocks it renders. */
  blockPreloads?: {
    /** Each block's module path, by block id. */
    modulePaths: Record<string, string>;
    /** The built chunks each block module needs, by module path. `null` in dev. */
    chunks: Record<string, string[]> | null;
  };
  /**
   * Dev mode: every render reads the caller's development draft and ignores the URL's draft
   * (ADR 0006).
   */
  developmentDraft?: boolean;
  pageClientEntryUrl?: string;
  studioClientEntryUrl?: string;
  getCamoxApp?: () => Promise<CamoxApp>;
  getDocument?: () => Promise<CamoxDocument>;
  projectSlug?: string;
  renderPage?: (input: PageRenderInput) => Promise<string>;
  renderStudio?: (input: StudioRenderInput) => Promise<string>;
  runtimeBasePath?: string;
  stylesheetUrl?: string;
  studioStylesheetUrl?: string;
}

function normalizeRuntimeBasePath(basePath?: string): string {
  if (basePath === undefined) return DEFAULT_RUNTIME_BASE_PATH;
  if (!basePath || basePath === "/") return "";
  return basePath.startsWith("/")
    ? basePath.replace(/\/+$/, "")
    : `/${basePath.replace(/\/+$/, "")}`;
}

export function getRuntimePathname(
  url: string,
  runtimeBasePath = DEFAULT_RUNTIME_BASE_PATH,
): string | null {
  const { pathname } = new URL(url);
  const basePath = normalizeRuntimeBasePath(runtimeBasePath);
  if (!basePath) return pathname || "/";
  if (pathname === basePath) return "/";
  if (!pathname.startsWith(`${basePath}/`)) return null;

  const stripped = pathname.slice(basePath.length);
  return stripped || "/";
}

/**
 * The draft the request's URL names, if any, or in dev mode the development draft. Sitemaps and
 * Markdown ignore it: they read Live.
 */
function getRequestDraftId(request: Request, options: RuntimeOptions): string | undefined {
  if (options.developmentDraft) return DEVELOPMENT_DRAFT;
  return draftNamedBy(request.url) ?? undefined;
}

/**
 * Whether a response may show what only this visitor sees: a session, or a draft named in the
 * URL. Shared caches must never keep it.
 */
function isPrivateRender(request: Request, options: RuntimeOptions): boolean {
  return (
    !!getServerAuthCookieHeader(request.headers) ||
    getRequestDraftId(request, options) !== undefined
  );
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function normalizePagePath(path: string | null): string {
  if (!path) return "/";
  return path.startsWith("/") ? path : `/${path}`;
}

function getLayoutIdentity(
  layout: Awaited<ReturnType<typeof loadCamoxPageForRequest>>["data"]["page"]["layout"],
): LayoutIdentity | null {
  if (!layout) return null;

  return {
    blockIds: [...layout.beforeBlockIds, ...layout.afterBlockIds],
    layoutId: layout.layoutId,
    version: String(layout.contentUpdatedAt ?? layout.updatedAt),
  };
}

export function matchRuntimeRoute(pathname: string): RuntimeRouteMatch {
  const ownedRoute = matchRuntimeOwnedRoute(pathname);
  if (ownedRoute) return { kind: ownedRoute, pathname };
  if (pathname === "/camox") return { kind: "studio", pathname };
  if (matchCanvasOnlyPath(pathname)) return { kind: "canvas", pathname };
  if (
    pathname === STUDIO_CONTENT_PATH ||
    pathname === `${STUDIO_CONTENT_PATH}/` ||
    pathname === STUDIO_ASSETS_PATH ||
    matchCollectionContentPath(pathname)
  )
    return { kind: "studio-content", pathname };
  if (pathname.startsWith("/camox/")) return { kind: "studio-nested", pathname };

  return { kind: "page", pathname };
}

function withRuntimeBasePath(pathname: string, runtimeBasePath?: string): string {
  const basePath = normalizeRuntimeBasePath(runtimeBasePath);
  if (!basePath) return pathname;
  if (pathname === "/") return `${basePath}/`;
  return `${basePath}${pathname}`;
}

/** The website's Live pages, the project's name and the app, which indexes of it are built from. */
interface LiveWebsite {
  app: CamoxApp | undefined;
  projectName: string;
  pages: LivePage[];
}

/**
 * Answers with an index of the website's Live pages, or a 500 saying why they can't be listed.
 * Sitemaps and llms.txt read Live whoever asks: crawlers only ever see published content.
 */
async function respondWithLiveWebsite(
  options: RuntimeOptions,
  name: string,
  respond: (website: LiveWebsite) => Response | Promise<Response>,
): Promise<Response> {
  const { apiUrl, projectSlug } = options;
  if (!apiUrl || !projectSlug) {
    return Response.json({ message: `Camox ${name} is not configured.` }, { status: 500 });
  }
  const api = createServerApiClient(apiUrl);
  const { projectName, pages } = await api.pages.listBySlug({ projectSlug });
  const app = await options.getCamoxApp?.();
  let livePages: LivePage[];
  try {
    livePages = await listLivePages({ pages, app, records: createRecordLookup(options, "live") });
  } catch (error) {
    if (!(error instanceof RouteDiscoveryError)) throw error;
    // An index silently missing pages is worse than one that visibly fails.
    console.error(`[camox] Route discovery failed while building the ${name}.`, error.cause);
    return Response.json({ message: `Camox ${name} failed: ${error.message}` }, { status: 500 });
  }
  return respond({ app, projectName, pages: livePages });
}

/** A path's absolute URL, with the runtime base path. */
function absoluteUrl(request: Request, options: RuntimeOptions) {
  const { origin } = new URL(request.url);
  return (path: string) => `${origin}${withRuntimeBasePath(path, options.runtimeBasePath)}`;
}

/** `body` with an ETag derived from it, or a 304 when the request's `If-None-Match` names it. */
async function withEtag(
  request: Request,
  body: string,
  headers: Record<string, string>,
): Promise<Response> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const etag = `"${[...new Uint8Array(digest)]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}"`;
  const taggedHeaders = { ...headers, ETag: etag };
  const matches = (request.headers.get("If-None-Match") ?? "")
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .some((tag) => tag === etag || tag === "*");
  if (matches) return new Response(null, { status: 304, headers: taggedHeaders });
  return new Response(body, { headers: taggedHeaders });
}

function createLlmsTxtResponse(request: Request, options: RuntimeOptions): Promise<Response> {
  return respondWithLiveWebsite(options, "llms.txt", (website) =>
    withEtag(
      request,
      formatLlmsTxt({
        projectName: website.projectName,
        pages: website.pages,
        layouts: (website.app?.getLayouts() ?? []).map(({ _internal }) => _internal),
        url: absoluteUrl(request, options),
      }),
      {
        "Content-Type": "text/plain; charset=utf-8",
        // Short, so a publish shows up within minutes; revalidating is cheap with the ETag.
        "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      },
    ),
  );
}

/** Tells LLM tools fetching a page's HTML where the website's llms.txt is. */
function llmsTxtLinkHeader(options: RuntimeOptions): string {
  return `<${withRuntimeBasePath(RUNTIME_ROUTE_PATHS["llms-txt"], options.runtimeBasePath)}>; rel="llms-txt"`;
}

function createSitemapResponse(request: Request, options: RuntimeOptions): Promise<Response> {
  return respondWithLiveWebsite(options, "sitemap", (website) => {
    const url = absoluteUrl(request, options);
    const entries = website.pages
      .map(({ fullPath, updatedAt }) => {
        const lastmod =
          updatedAt == null
            ? ""
            : `\n    <lastmod>${escapeXml(new Date(updatedAt).toISOString())}</lastmod>`;
        return `  <url>
    <loc>${escapeXml(url(fullPath))}</loc>${lastmod}
  </url>`;
      })
      .join("\n");

    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>`,
      { headers: { "Content-Type": "application/xml; charset=utf-8" } },
    );
  });
}

/** The request's member project, if its session is valid. Without an API, nobody is a member. */
async function resolveRequestMember(
  request: Request,
  options: RuntimeOptions,
): Promise<{ project?: MemberProject; clearAuthCookie: boolean }> {
  if (!options.apiUrl || !options.projectSlug) return { clearAuthCookie: false };
  return resolveMemberProject({
    apiUrl: options.apiUrl,
    authCookieHeader: getServerAuthCookieHeader(request.headers),
    projectSlug: options.projectSlug,
  });
}

/**
 * The first discovered page of a derived layout, which the Canvas previews by default. With
 * `recordId`, the page rendering that record, which the Studio follows when its slug changes.
 * Records are found by their values in the locale `LOCALE_HEADER` names, the default locale
 * without it, and the path is that locale's, without its prefix: route patterns aren't localized.
 */
async function createRoutesResponse(request: Request, options: RuntimeOptions): Promise<Response> {
  const camoxApp = await options.getCamoxApp?.();
  if (!camoxApp) {
    return Response.json({ message: "Camox app registry is not available." }, { status: 500 });
  }
  const { searchParams } = new URL(request.url);
  const layoutId = searchParams.get("layoutId") ?? "";
  const recordId = searchParams.get("recordId");
  const layout = camoxApp.getLayoutById(layoutId);
  if (layout?._internal.kind !== "derived") return new Response("Not found", { status: 404 });
  const { project, clearAuthCookie } = await resolveRequestMember(request, options);
  const headers = {
    "Cache-Control": "private, no-store",
    Vary: `Cookie, ${LOCALE_HEADER}`,
    ...(clearAuthCookie ? { "Set-Cookie": buildClearServerAuthCookieHeader() } : {}),
  };
  // Only a non-default locale is named; the API refuses a tag the scope doesn't have.
  const tag = request.headers.get(LOCALE_HEADER);
  try {
    const pages = await discoverLayoutPages(
      layout,
      createLayoutRequestContext(options, project ? "draft" : "live", {
        authCookieHeader: getServerAuthCookieHeader(request.headers),
        locale: tag ? { tag, isDefault: false } : undefined,
      }),
    );
    const page = recordId ? pages.find((entry) => entry.recordId === recordId) : pages[0];
    return Response.json({ path: page?.path ?? null }, { headers });
  } catch (error) {
    console.error(`[camox] Route discovery failed for layout "${layoutId}".`, error);
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ message }, { status: 500, headers });
  }
}

async function createOgResponse(request: Request, options: RuntimeOptions): Promise<Response> {
  const camoxApp = await options.getCamoxApp?.();
  if (!camoxApp) {
    return Response.json({ message: "Camox app registry is not available." }, { status: 500 });
  }

  const url = new URL(request.url);
  const layoutId = url.searchParams.get("layoutId") || "";
  const title = url.searchParams.get("title") || "";
  const description = url.searchParams.get("description") || "";
  const projectName = url.searchParams.get("projectName") || "";

  const layout = camoxApp.getLayoutById(layoutId);
  if (!layout?._internal.buildOgImage) {
    return new Response("Not found", { status: 404 });
  }

  return layout._internal.buildOgImage({ title, description, projectName });
}

function createDefaultHeadInput(stylesheetUrl?: string): UseHeadInput {
  return {
    htmlAttrs: { lang: "en" },
    meta: [
      { charset: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
    ],
    link: stylesheetUrl ? [{ rel: "stylesheet", href: stylesheetUrl }] : [],
  };
}

export function createPageHeadInput(head: {
  meta?: Array<Record<string, string>>;
  links?: Array<Record<string, string>>;
}): UseHeadInput {
  const meta = head.meta ?? [];
  const links = head.links ?? [];
  const title = meta.find((entry) => entry.title)?.title;

  const pageMeta: Meta[] = [];
  for (const entry of meta) {
    if (entry.title) continue;
    if (entry.name && entry.content) {
      pageMeta.push({ name: entry.name, content: entry.content, "data-camox-page-head": "true" });
      continue;
    }
    if (entry.property && entry.content) {
      pageMeta.push({
        property: entry.property,
        content: entry.content,
        "data-camox-page-head": "true",
      });
    }
  }

  const pageLinks: Link[] = [];
  for (const entry of links) {
    if (!entry.href) continue;
    if (entry.rel === "icon") {
      pageLinks.push({ rel: "icon", href: entry.href, "data-camox-page-head": "true" });
      continue;
    }
    if (entry.rel === "alternate" && entry.type) {
      pageLinks.push({
        rel: "alternate",
        type: entry.type,
        href: entry.href,
        "data-camox-page-head": "true",
      });
    }
  }

  return {
    ...(title && { title }),
    meta: pageMeta,
    link: pageLinks,
  };
}

function renderHead(
  document: CamoxDocument,
  pageHead: UseHeadInput,
  stylesheetUrl?: string,
  studioStylesheetUrl?: string,
  /** The site's rendered locale, whose tag overrides the Document's `lang`. */
  locale?: LocaleView,
) {
  const head = createHead();
  head.push(createDefaultHeadInput(stylesheetUrl));
  head.push(document);
  if (locale) head.push({ htmlAttrs: { lang: locale.tag } });
  if (studioStylesheetUrl)
    head.push({
      link: [{ rel: "stylesheet", href: studioStylesheetUrl, "data-camox-studio": "true" }],
    });
  head.push(pageHead);
  return renderSSRHead(head);
}

function serializeJsonForHtml(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

/**
 * The browser loads a page's blocks before hydrating it. Preloading them alongside the entry
 * script avoids a request waterfall.
 */
function renderBlockPreloads(options: RuntimeOptions, dehydratedState: unknown): string {
  const preloads = options.blockPreloads;
  if (!preloads) return "";
  const urls = new Set<string>();
  for (const type of getPageBlockTypes(dehydratedState)) {
    const modulePath = preloads.modulePaths[type];
    if (!modulePath) continue;
    if (!preloads.chunks) urls.add(modulePath);
    for (const chunk of preloads.chunks?.[modulePath] ?? []) urls.add(`/${chunk}`);
  }
  return [...urls].map((url) => `<link rel="modulepreload" href="${escapeXml(url)}">`).join("");
}

function renderClientEntryScript(src?: string): string {
  if (!src) return "";
  return `<script type="module" src="${escapeXml(src)}"></script>`;
}

async function preparePreviewDocument(
  input: PageRenderInput,
  options: RuntimeOptions,
  document: CamoxDocument,
  content?: string,
) {
  const siteHead = renderHead(
    document,
    createPageHeadInput((input.head ?? {}) as Parameters<typeof createPageHeadInput>[0]),
    options.stylesheetUrl,
    undefined,
    input.locale,
  );
  const href = new URL(withRuntimeBasePath(input.pathname, options.runtimeBasePath), input.href)
    .href;
  const siteHtml =
    content ??
    (options.renderPage
      ? await options.renderPage({
          ...input,
          href,
          presentation: "public",
          previewDocument: undefined,
        })
      : "");
  input.previewDocument = `<!doctype html><html${siteHead.htmlAttrs}><head><base href="${escapeXml(href)}">${siteHead.headTags}</head><body${siteHead.bodyAttrs}>${siteHead.bodyTagsOpen}<div id="root" data-camox-preview-root>${siteHtml}</div>${siteHead.bodyTags}</body></html>`;
}

/**
 * The render input a page's HTML embeds for hydration. Visitors load public pages, whose HTML
 * already holds each rendered artifact source in its frame, so their copy leaves those out.
 */
function hydrationInputFor(input: PageRenderInput, html: string): PageRenderInput {
  if (input.presentation === "studio") return input;
  return { ...input, dehydratedState: omitArtifactSources(input.dehydratedState, html) };
}

function renderStudioThemeScript(enabled: boolean) {
  return enabled
    ? `<script data-camox-studio>${STUDIO_THEME_SCRIPT}${PLATFORM_SCRIPT}</script>`
    : "";
}

/** Whether a request is a preview link's token handoff, which signs in before reading anything. */
function isPreviewHandoff(request: Request, options: RuntimeOptions): boolean {
  const { searchParams } = new URL(request.url);
  return (
    searchParams.has("camox-preview") &&
    searchParams.has("ott") &&
    !!options.apiUrl &&
    !!options.authenticationUrl &&
    !!options.projectSlug &&
    !!options.renderPage
  );
}

/**
 * The sign-in page a preview link opens on. No page, project or locale lookup yet: the browser
 * authenticates first, then loads the page again.
 */
async function createPreviewHandoffResponse({
  options,
  pathname,
  request,
}: {
  options: RuntimeOptions;
  pathname: string;
  request: Request;
}): Promise<Response> {
  // The sign-in page shows no content: the default locale, of a tag unknown yet, stands in.
  const locale = UNNAMED_DEFAULT_LOCALE;
  const input: PageRenderInput = {
    previewHandoff: true,
    presentation: "public",
    apiUrl: options.apiUrl!,
    authenticationUrl: options.authenticationUrl!,
    projectSlug: options.projectSlug!,
    href: request.url,
    pathname,
    runtimeBasePath: normalizeRuntimeBasePath(options.runtimeBasePath),
    locale,
    locales: [locale],
    head: {},
    loaderData: null,
    layoutIdentity: null,
    dehydratedState: dehydrate(new QueryClient()),
  };
  const html = await options.renderPage!(input);
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>Camox draft preview</title><script id="__CAMOX_DATA__" type="application/json">${serializeJsonForHtml(input)}</script></head><body><div id="root">${html}</div>${renderClientEntryScript(options.pageClientEntryUrl)}</body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}

async function createPageHtmlResponse({
  options,
  pathname,
  located,
  request,
}: {
  options: RuntimeOptions;
  /** The full runtime path, with the locale's prefix. */
  pathname: string;
  located: RequestLocale;
  request: Request;
}): Promise<Response> {
  if (
    !options.apiUrl ||
    !options.authenticationUrl ||
    !options.projectSlug ||
    !options.renderPage
  ) {
    return createPageDataResponse({ options, pathname, located, request });
  }

  const singleton = await createDerivedResponse(options, pathname, located, request, {
    singletonOnly: true,
  });
  if (singleton) return singleton;

  const queryClient = new QueryClient();
  try {
    const result = await loadCamoxPageForRequest({
      apiUrl: options.apiUrl,
      authCookieHeader: getServerAuthCookieHeader(request.headers),
      draftId: getRequestDraftId(request, options),
      locale: located.locale,
      origin: new URL(request.url).origin,
      pathname: located.path,
      projectSlug: options.projectSlug,
      queryClient,
    });
    const headers = new Headers({
      "Content-Type": "text/html; charset=utf-8",
      Vary: "Cookie",
      Link: llmsTxtLinkHeader(options),
    });
    if (isPrivateRender(request, options)) headers.set("Cache-Control", "private, no-store");
    if (result.shouldClearAuthCookie) {
      headers.append("Set-Cookie", buildClearServerAuthCookieHeader());
    }

    const camoxApp = await options.getCamoxApp?.();
    const document = (await options.getDocument?.()) ?? {};
    const head = camoxApp ? buildCamoxPageHead(camoxApp, result.data, located.locale) : {};
    const dehydratedState = dehydrate(queryClient);
    const { project } = result;
    const studio = project !== undefined;
    const pageRenderInput = {
      project,
      presentation: studio ? "studio" : "public",
      apiUrl: options.apiUrl,
      authenticationUrl: options.authenticationUrl,
      dehydratedState,
      draftId: result.draftId,
      refusedDraft: result.refusedDraft,
      head,
      href: renderedHref(request.url, result),
      layoutIdentity: getLayoutIdentity(result.data.page.layout),
      loaderData: result.data,
      pathname,
      projectSlug: options.projectSlug,
      runtimeBasePath: normalizeRuntimeBasePath(options.runtimeBasePath),
      locale: located.locale,
      locales: located.locales,
    } satisfies PageRenderInput;
    // Public documents only need site head/attributes for possible client-side
    // studio activation; avoid rendering or serializing their page content twice.
    await preparePreviewDocument(pageRenderInput, options, document, studio ? undefined : "");
    const appHtml = await options.renderPage(pageRenderInput);
    const renderedHead = renderHead(
      studio ? {} : document,
      createPageHeadInput(head),
      studio ? undefined : options.stylesheetUrl,
      studio ? options.studioStylesheetUrl : undefined,
      studio ? undefined : located.locale,
    );

    return new Response(
      `<!doctype html>
<html${renderedHead.htmlAttrs}>
<head>
${renderStudioThemeScript(studio)}
${renderedHead.headTags}
${renderBlockPreloads(options, dehydratedState)}
<script id="__CAMOX_DATA__" type="application/json">${serializeJsonForHtml(hydrationInputFor(pageRenderInput, appHtml))}</script>
</head>
<body${renderedHead.bodyAttrs}>
${renderedHead.bodyTagsOpen}
<div id="root">${appHtml}</div>
${renderedHead.bodyTags}
${renderClientEntryScript(options.pageClientEntryUrl)}
</body>
</html>`,
      { headers },
    );
  } catch (error) {
    if (isNotFoundError(error)) {
      const derived = await createDerivedResponse(options, pathname, located, request);
      if (derived) return derived;
      return new Response("No Camox page on this path", { status: 404 });
    }
    throw error;
  }
}

type DerivedMatch = NonNullable<ReturnType<typeof matchDerivedLayout>>;

/**
 * The context `loader` and `routes` get. Its record lookup reads each record's current content;
 * only draft reads carry the editor's session, and `draftId` names the draft they read.
 */
function createLayoutRequestContext(
  options: RuntimeOptions,
  source: RecordSource,
  reading?: RecordReading,
): LayoutRequestContext {
  return createRequestContext({ records: createRecordLookup(options, source, reading) });
}

/** Who reads records, in which draft and in which locale. */
interface RecordReading {
  /** The editor's session, which only draft reads carry. */
  authCookieHeader?: string;
  /** The draft read. Without it, Live. */
  draftId?: string;
  /** The locale read. Without it, the default locale. */
  locale?: LocaleView;
}

/**
 * Reads the records `loader` and `routes` ask for, in `locale` or the default locale; none
 * without an API.
 */
function createRecordLookup(
  options: RuntimeOptions,
  source: RecordSource,
  { authCookieHeader, draftId, locale }: RecordReading = {},
): RecordLookup | undefined {
  const { apiUrl, projectSlug } = options;
  if (!apiUrl || !projectSlug) return undefined;
  const api = createServerApiClient(apiUrl, {
    authCookieHeader: source === "draft" ? authCookieHeader : undefined,
    draftId,
    locale,
  });
  return {
    findByField: (input) => api.collectionDefinitions.findRecordsByField({ ...input, projectSlug }),
    listPageValues: (input) =>
      api.collectionDefinitions.listRecordPageValues({ ...input, projectSlug }),
  };
}

const RECORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An envelope names its record; it doesn't authorize anything, the API does. */
function isValidCollectionItem(app: CamoxApp | undefined, result: Record<string, unknown>) {
  const data = result.data as { id?: unknown; content?: unknown } | null;
  return (
    typeof result.collectionId === "string" &&
    !!app?.getCollectionById(result.collectionId) &&
    typeof data?.id === "string" &&
    RECORD_ID.test(data.id) &&
    typeof data.content === "object" &&
    data.content !== null
  );
}

/** Runs a code-owned page's loader. The envelope survives SSR, navigation and hydration. */
async function loadLayoutResult(
  app: CamoxApp | undefined,
  match: DerivedMatch,
  context: LayoutRequestContext,
): Promise<AnyLayoutLoaderResult | undefined> {
  const { loader, id } = match.layout._internal;
  if (!loader) return undefined;
  const result = await loader({ params: match.params, context });
  // Preserve the envelope across SSR, navigation and hydration. Only useData unwraps it.
  const serializedResult = result === undefined ? undefined : JSON.parse(JSON.stringify(result));
  const record = asCollectionItem(serializedResult);
  const valid = record
    ? isValidCollectionItem(app, record)
    : serializedResult?.kind === "data" && Object.hasOwn(serializedResult, "data");
  if (!valid)
    throw new Error(
      `Layout "${id}" loader must return { kind: "data", data } with JSON-serializable data, or a collection-item envelope naming a registered collection and a record id`,
    );
  return serializedResult;
}

/**
 * The Markdown of a singleton or derived page: front matter, its before blocks, the layout's
 * toMarkdown output, then its after blocks. Without toMarkdown, the page is HTML only.
 */
async function createLayoutMarkdownResponse(
  options: RuntimeOptions,
  match: DerivedMatch,
  locale: LocaleView,
  /** The page's full path, with its locale's prefix, and its absolute URL, which the front matter states. */
  page: { pathname: string; url: string },
): Promise<Response | null> {
  const { toMarkdown, id } = match.layout._internal;
  const { apiUrl, projectSlug } = options;
  if (!toMarkdown || !apiUrl || !projectSlug) return null;
  const api = createServerApiClient(apiUrl, { locale });
  const app = await options.getCamoxApp?.();
  /** The layout's own Markdown, between its before and after blocks, and what built it. */
  const layoutMarkdown = async () => {
    // Markdown is a public output: it reads published records whoever asks.
    const result = await loadLayoutResult(
      app,
      match,
      createLayoutRequestContext(options, "live", { locale }),
    );
    const record = asCollectionItem(result);
    const collection = record && app?.getCollectionById(record.collectionId);
    if (!record || !collection)
      return { body: toMarkdown({ data: result?.data, params: match.params }), data: result?.data };
    const { data } = record;
    // A record page's fields render like a reference list's records: the API fills them.
    const template = recordMarkdownTemplate(collection, (item) =>
      toMarkdown({ data, params: match.params, item }),
    );
    const body = await api.collectionDefinitions.recordMarkdown({
      projectSlug,
      collectionId: record.collectionId,
      id: data.id,
      toMarkdown: template,
    });
    return { body: [body], data, item: recordPlainText(collection, data.content) };
  };
  let rendered: Awaited<ReturnType<typeof layoutMarkdown>>;
  try {
    rendered = await layoutMarkdown();
  } catch (error) {
    if (isNotFoundError(error)) return new Response("Page not found", { status: 404 });
    throw error;
  }
  const slots = await api.blocks.getLayoutMarkdown({ projectSlug, layoutId: id }).catch((error) => {
    // A layout that was never synced has no blocks yet.
    if (isNotFoundError(error)) return { before: "", after: "", projectName: "" };
    throw error;
  });
  // The same title and description as the page's head.
  const meta = buildPageMeta({
    layout: match.layout._internal,
    pageMetaTitle: match.layout._internal.title,
    pageMetaDescription: undefined,
    data: rendered.data,
    item: rendered.item,
    params: match.params,
    projectName: slots.projectName,
    pageFullPath: page.pathname,
  });
  const markdown = [slots.before, ...rendered.body, slots.after].filter(Boolean).join("\n\n");
  return new Response(withFrontMatter(markdown, { ...meta, url: page.url }), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}

interface DerivedResponseOptions {
  /** Respond with the page's JSON data (`/_camox/data`) rather than its HTML. */
  dataOnly?: boolean;
  /** Match singleton layouts only, which take precedence over curated pages. */
  singletonOnly?: boolean;
}

async function createDerivedResponse(
  options: RuntimeOptions,
  /** The full runtime path, with the locale's prefix. */
  pathname: string,
  located: RequestLocale,
  request: Request,
  { dataOnly = false, singletonOnly = false }: DerivedResponseOptions = {},
): Promise<Response | null> {
  const app = await options.getCamoxApp?.();
  // Route patterns name locale-relative paths: their segments aren't localized.
  const match = app && matchDerivedLayout(app.getLayouts(), located.path);
  if (!match || (!dataOnly && !options.renderPage)) return null;
  if (singletonOnly && match.layout._internal.kind !== "singleton") return null;
  try {
    const queryClient = new QueryClient();
    const { project, clearAuthCookie } = await resolveRequestMember(request, options);
    const studio = project !== undefined;
    // Only a member's session reads record drafts, in the loader and in linked records.
    const authCookieHeader = studio ? getServerAuthCookieHeader(request.headers) : undefined;
    const requestedDraft = getRequestDraftId(request, options);
    const readLayout = () =>
      readDraftOrLive(requestedDraft, studio, (draftId) =>
        createServerApiClient(options.apiUrl!, {
          authCookieHeader,
          draftId,
          locale: located.locale,
        }).layouts.get({ projectSlug: options.projectSlug!, layoutId: match.layout._internal.id }),
      );
    const runLoader = (draftId?: string) =>
      loadLayoutResult(
        app,
        match,
        createLayoutRequestContext(options, studio ? "draft" : "live", {
          authCookieHeader,
          draftId,
          locale: located.locale,
        }),
      );
    // In a draft, the layout read settles which draft the page shows, so the loader then reads
    // records from that draft, or from Live when the draft was refused.
    const [serializedResult, { value: shared, ...read }] =
      studio && requestedDraft
        ? await readLayout().then(async (read) => [await runLoader(read.draftId), read] as const)
        : await Promise.all([runLoader(), readLayout()]);
    // The studio shows the layout and its loader's result as read here, in the draft read.
    const studioCache = createServerStudioCache(queryClient, {
      apiUrl: options.apiUrl!,
      authCookieHeader,
      locale: located.locale,
    });
    const projectSlug = options.projectSlug!;
    const shownIn = { in: read.draftId ?? null };
    studioCache.land(
      reads.layoutStructure({ projectSlug, layoutId: match.layout._internal.id }),
      shared,
      shownIn,
    );
    studioCache.set(
      reads.derivedPageData({
        projectSlug,
        runtimeBasePath: normalizeRuntimeBasePath(options.runtimeBasePath),
        pathname,
      }),
      serializedResult ?? null,
      shownIn,
    );
    // Code-owned pages have no editor metadata: the layout's title stands in for it.
    const record = asCollectionItem(serializedResult);
    const recordCollection = record && app.getCollectionById(record.collectionId);
    const pageHead = buildPageHead({
      layout: match.layout._internal,
      pageMetaTitle: match.layout._internal.title,
      pageMetaDescription: undefined,
      data: serializedResult?.data,
      // A record page's meta callbacks also get its fields as plain text.
      item:
        record && recordCollection
          ? recordPlainText(recordCollection, record.data.content)
          : undefined,
      params: match.params,
      projectName: shared.projectName,
      pageFullPath: pathname,
      origin: new URL(request.url).origin,
      faviconUrl: buildFaviconUrl(options.apiUrl!, shared.project),
      hasMarkdown: match.layout._internal.toMarkdown !== undefined,
    });
    const input: PageRenderInput = {
      project,
      presentation: studio ? "studio" : "public",
      apiUrl: options.apiUrl!,
      authenticationUrl: options.authenticationUrl!,
      projectSlug: options.projectSlug!,
      dehydratedState: dehydrate(queryClient),
      draftId: read.draftId,
      refusedDraft: read.refusedDraft,
      head: pageHead,
      href: renderedHref(request.url, read),
      layoutIdentity: getLayoutIdentity(shared.layout),
      loaderData: null,
      pathname,
      runtimeBasePath: normalizeRuntimeBasePath(options.runtimeBasePath),
      locale: located.locale,
      locales: located.locales,
      derived: {
        layoutId: match.layout._internal.id,
        result: serializedResult,
        layout: shared.layout,
      },
    };
    const document = (await options.getDocument?.()) ?? {};
    await preparePreviewDocument(input, options, document, !studio && !dataOnly ? "" : undefined);
    if (dataOnly)
      return Response.json(input, {
        headers: {
          "Cache-Control": "private, no-store",
          Vary: "Cookie",
          ...(clearAuthCookie ? { "Set-Cookie": buildClearServerAuthCookieHeader() } : {}),
        },
      });
    const html = await options.renderPage!(input);
    const head = renderHead(
      studio ? {} : document,
      createPageHeadInput(pageHead),
      studio ? undefined : options.stylesheetUrl,
      studio ? options.studioStylesheetUrl : undefined,
      studio ? undefined : located.locale,
    );
    return new Response(
      `<!doctype html><html${head.htmlAttrs}><head>${renderStudioThemeScript(studio)}${head.headTags}${renderBlockPreloads(options, input.dehydratedState)}<script id="__CAMOX_DATA__" type="application/json">${serializeJsonForHtml(hydrationInputFor(input, html))}</script></head><body${head.bodyAttrs}>${head.bodyTagsOpen}<div id="root">${html}</div>${head.bodyTags}${renderClientEntryScript(options.pageClientEntryUrl)}</body></html>`,
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          Vary: "Cookie",
          Link: llmsTxtLinkHeader(options),
          ...(isPrivateRender(request, options) ? { "Cache-Control": "private, no-store" } : {}),
          ...(clearAuthCookie ? { "Set-Cookie": buildClearServerAuthCookieHeader() } : {}),
        },
      },
    );
  } catch (error) {
    if (isNotFoundError(error)) return new Response("Page not found", { status: 404 });
    throw error;
  }
}

async function createStudioHtmlResponse({
  match,
  options,
  pathname,
  located,
  request,
  dataOnly = false,
}: {
  /** The studio route the locale-relative path names. */
  match: RuntimeRouteMatch & { kind: StudioRouteKind };
  options: RuntimeOptions;
  /** The full runtime path, with the locale's prefix. */
  pathname: string;
  located: RequestLocale;
  request: Request;
  dataOnly?: boolean;
}): Promise<Response> {
  if (
    !options.apiUrl ||
    !options.authenticationUrl ||
    !options.projectSlug ||
    (!dataOnly && !options.renderStudio)
  ) {
    return Response.json(
      { message: "Camox Studio renderer is not configured.", ...match },
      { status: 500 },
    );
  }

  const queryClient = new QueryClient();
  const { project, clearAuthCookie } = await resolveRequestMember(request, options);
  const presentation = project ? "studio" : "public";
  const studioRenderInput = {
    project,
    head: { meta: [{ title: "Camox Studio" }] },
    layoutIdentity: null,
    loaderData: null,
    presentation,
    apiUrl: options.apiUrl,
    authenticationUrl: options.authenticationUrl,
    dehydratedState: dehydrate(queryClient),
    href: new URL(request.url).href,
    pathname,
    projectSlug: options.projectSlug,
    routeKind: match.kind,
    runtimeBasePath: normalizeRuntimeBasePath(options.runtimeBasePath),
    locale: located.locale,
    locales: located.locales,
  } satisfies StudioRenderInput;
  if (dataOnly)
    return Response.json(studioRenderInput, {
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
        ...(clearAuthCookie ? { "Set-Cookie": buildClearServerAuthCookieHeader() } : {}),
      },
    });
  const appHtml = await options.renderStudio!(studioRenderInput);
  const renderedHead = renderHead(
    {},
    { title: "Camox Studio" },
    undefined,
    presentation === "studio" ? options.studioStylesheetUrl : undefined,
  );

  return new Response(
    `<!doctype html>
<html${renderedHead.htmlAttrs}>
<head>
${renderStudioThemeScript(presentation === "studio")}
${renderedHead.headTags}
<script id="__CAMOX_DATA__" type="application/json">${serializeJsonForHtml(studioRenderInput)}</script>
</head>
<body${renderedHead.bodyAttrs}>
${renderedHead.bodyTagsOpen}
<div id="root">${appHtml}</div>
${renderedHead.bodyTags}
${renderClientEntryScript(options.studioClientEntryUrl)}
</body>
</html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
        ...(clearAuthCookie ? { "Set-Cookie": buildClearServerAuthCookieHeader() } : {}),
      },
    },
  );
}

/**
 * The Canvas with nothing selected, or a block of the Block Catalog, renders the
 * page app, like a Page, so selecting it keeps the Canvas mounted. A block path
 * without a page-content block of that id redirects home.
 */
async function createCanvasOnlyResponse({
  options,
  pathname,
  located,
  request,
  dataOnly = false,
}: {
  options: RuntimeOptions;
  /** The full runtime path, with the locale's prefix. */
  pathname: string;
  located: RequestLocale;
  request: Request;
  dataOnly?: boolean;
}): Promise<Response> {
  const { blockId } = matchCanvasOnlyPath(located.path)!;
  const app = blockId ? await options.getCamoxApp?.() : undefined;
  const block = blockId ? app?.getBlockById(blockId) : undefined;
  if (blockId && (!block || block._internal.layoutOnly)) {
    if (dataOnly)
      return Response.json(
        { kind: "canvas", message: "No block of the Block Catalog on this path", pathname },
        { status: 404 },
      );
    return Response.redirect(
      new URL(
        withRuntimeBasePath(localizedPath("/", located.locale), options.runtimeBasePath),
        request.url,
      ),
      302,
    );
  }
  if (
    !options.apiUrl ||
    !options.authenticationUrl ||
    !options.projectSlug ||
    (!dataOnly && !options.renderPage)
  ) {
    return Response.json(
      { message: "Camox page renderer is not configured.", kind: "canvas", pathname },
      { status: 500 },
    );
  }

  const { project, clearAuthCookie } = await resolveRequestMember(request, options);
  const studio = project !== undefined;
  const title = block?._internal.title ?? "Canvas";
  const input: PageRenderInput = {
    project,
    presentation: studio ? "studio" : "public",
    apiUrl: options.apiUrl,
    authenticationUrl: options.authenticationUrl,
    projectSlug: options.projectSlug,
    runtimeBasePath: normalizeRuntimeBasePath(options.runtimeBasePath),
    locale: located.locale,
    locales: located.locales,
    href: request.url,
    pathname,
    head: { meta: [{ title }] },
    layoutIdentity: null,
    loaderData: null,
    dehydratedState: dehydrate(new QueryClient()),
    canvasOnly: blockId ? { blockId } : {},
    // Nothing here reads the draft, but it is the one the Page left was in: client
    // navigation remounts the studio, hiding the Canvas, when the draft changes.
    draftId: studio ? getRequestDraftId(request, options) : undefined,
  };
  // Block frames build their documents from the site head; there is no page content.
  const document = (await options.getDocument?.()) ?? {};
  await preparePreviewDocument(input, options, document, "");
  const headers = {
    "Cache-Control": "private, no-store",
    Vary: "Cookie",
    ...(clearAuthCookie ? { "Set-Cookie": buildClearServerAuthCookieHeader() } : {}),
  };
  if (dataOnly) return Response.json(input, { headers });
  const html = await options.renderPage!(input);
  const head = renderHead(
    {},
    { title },
    undefined,
    studio ? options.studioStylesheetUrl : undefined,
  );
  return new Response(
    `<!doctype html><html${head.htmlAttrs}><head>${renderStudioThemeScript(studio)}${head.headTags}<script id="__CAMOX_DATA__" type="application/json">${serializeJsonForHtml(input)}</script></head><body${head.bodyAttrs}>${head.bodyTagsOpen}<div id="root">${html}</div>${head.bodyTags}${renderClientEntryScript(options.pageClientEntryUrl)}</body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", ...headers } },
  );
}

async function createPageDataResponse({
  options,
  pathname,
  located,
  request,
}: {
  options: RuntimeOptions;
  /** The full runtime path, with the locale's prefix. */
  pathname: string;
  located: RequestLocale;
  request: Request;
}): Promise<Response> {
  if (!options.apiUrl || !options.projectSlug) {
    return Response.json({ message: "Camox page loader is not configured." }, { status: 500 });
  }

  const singleton = await createDerivedResponse(options, pathname, located, request, {
    dataOnly: true,
    singletonOnly: true,
  });
  if (singleton) return singleton;

  const queryClient = new QueryClient();
  try {
    const result = await loadCamoxPageForRequest({
      apiUrl: options.apiUrl,
      authCookieHeader: getServerAuthCookieHeader(request.headers),
      draftId: getRequestDraftId(request, options),
      locale: located.locale,
      origin: new URL(request.url).origin,
      pathname: located.path,
      projectSlug: options.projectSlug,
      queryClient,
    });
    const headers = new Headers({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
    });
    if (result.shouldClearAuthCookie) {
      headers.append("Set-Cookie", buildClearServerAuthCookieHeader());
    }

    const camoxApp = await options.getCamoxApp?.();
    const head = camoxApp ? buildCamoxPageHead(camoxApp, result.data, located.locale) : null;
    const dehydratedState = dehydrate(queryClient);
    const input: PageRenderInput = {
      apiUrl: options.apiUrl,
      authenticationUrl: options.authenticationUrl ?? "",
      projectSlug: options.projectSlug,
      runtimeBasePath: normalizeRuntimeBasePath(options.runtimeBasePath),
      locale: located.locale,
      locales: located.locales,
      href: renderedHref(request.url, result),
      draftId: result.draftId,
      refusedDraft: result.refusedDraft,
      presentation: result.project ? "studio" : "public",
      pathname,
      layoutIdentity: getLayoutIdentity(result.data.page.layout),
      project: result.project,
      loaderData: result.data,
      head,
      dehydratedState,
    };
    await preparePreviewDocument(input, options, (await options.getDocument?.()) ?? {});
    return Response.json(input, { headers });
  } catch (error) {
    if (isNotFoundError(error)) {
      const derived = await createDerivedResponse(options, pathname, located, request, {
        dataOnly: true,
      });
      if (derived) return derived;
      return Response.json(
        { kind: "page", message: "No Camox page on this path", pathname },
        { status: 404 },
      );
    }
    throw error;
  }
}

export async function handleCamoxRequest(
  request: Request,
  options: RuntimeOptions = {},
): Promise<Response | null> {
  const pathname = getRuntimePathname(request.url, options.runtimeBasePath);
  if (!pathname) return null;

  const match = matchRuntimeRoute(pathname);
  if (match.kind === "health") {
    return new Response("ok\n", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (match.kind === "registry") {
    const camoxApp = await options.getCamoxApp?.();
    if (!camoxApp) {
      return Response.json({ message: "Camox app registry is not available." }, { status: 500 });
    }

    return Response.json({
      blocks: camoxApp.getBlocks().map((block) => block._internal.id),
      layouts: camoxApp.getLayouts().map((layout) => layout._internal.id),
    });
  }

  if (match.kind === "og") {
    return createOgResponse(request, options);
  }

  if (match.kind === "sitemap") {
    return createSitemapResponse(request, options);
  }

  if (match.kind === "llms-txt") {
    return createLlmsTxtResponse(request, options);
  }

  if (match.kind === "routes") {
    return createRoutesResponse(request, options);
  }

  if (match.kind === "data") {
    const targetPathname = normalizePagePath(new URL(request.url).searchParams.get("path"));
    if (matchRuntimeOwnedRoute(targetPathname)) return new Response("Not found", { status: 404 });
    return respondInLocale(options, request, targetPathname, { dataOnly: true });
  }

  // The rest of the runtime's paths sit under the locale's prefix.
  if (isPreviewHandoff(request, options) && match.kind === "page") {
    return createPreviewHandoffResponse({ options, pathname, request });
  }

  // Agents reach the Markdown Representation by asking for it, or at the page's `.md` URL.
  const { apiUrl, projectSlug } = options;
  const markdownPathname = parseMarkdownPath(pathname);
  if (
    apiUrl &&
    projectSlug &&
    (markdownPathname || prefersMarkdown(request.headers.get("Accept") ?? ""))
  ) {
    // Markdown is a public output: it reads Live, whoever asks.
    const located = await locateRequest(request, options, markdownPathname ?? pathname, {
      live: true,
    });
    if (markdownPathname || matchLocalizedRoute(located.path)?.kind === "page") {
      const markdownResponse = await createPageMarkdownResponse(
        { ...options, apiUrl, projectSlug },
        located,
        { pathname: markdownPathname ?? pathname, request },
      );
      if (markdownResponse) return markdownResponse;
      if (markdownPathname) return new Response("Page not found", { status: 404 });
    }
  }

  return respondInLocale(options, request, pathname);
}

/**
 * Answers a path under its locale's prefix: the Canvas, a studio route or a page, in that locale.
 * With `dataOnly`, as the JSON client navigation loads.
 */
async function respondInLocale(
  options: RuntimeOptions,
  request: Request,
  /** The full runtime path, with the locale's prefix. */
  pathname: string,
  { dataOnly = false }: { dataOnly?: boolean } = {},
): Promise<Response> {
  const located = await locateRequest(request, options, pathname);
  const localized = matchLocalizedRoute(located.path);
  if (!localized) return new Response("Not found", { status: 404 });
  const target = { options, pathname, located, request };
  if (localized.kind === "canvas") return createCanvasOnlyResponse({ ...target, dataOnly });
  if (isStudioRoute(localized))
    return createStudioHtmlResponse({ ...target, match: localized, dataOnly });
  return dataOnly ? createPageDataResponse(target) : createPageHtmlResponse(target);
}

/**
 * A page's Markdown Representation in its locale, with the same precedence as its HTML:
 * singleton, curated page, then derived layout. Null when the page has none.
 */
async function createPageMarkdownResponse(
  options: RuntimeOptions & { apiUrl: string; projectSlug: string },
  { locale, path }: RequestLocale,
  /** The page's full path, with its locale's prefix, and the request asking for it. */
  { pathname, request }: { pathname: string; request: Request },
): Promise<Response | null> {
  // The front matter links the page itself, not its Markdown.
  const page = { pathname, url: absoluteUrl(request, options)(pathname) };
  const app = await options.getCamoxApp?.();
  const layoutMatch = app && matchDerivedLayout(app.getLayouts(), path);
  if (layoutMatch?.layout._internal.kind === "singleton")
    return createLayoutMarkdownResponse(options, layoutMatch, locale, page);
  return createMarkdownResponse({
    apiUrl: options.apiUrl,
    camoxApp: app,
    locale,
    pathname: path,
    projectSlug: options.projectSlug,
    request,
    url: page.url,
    onNotFound: async () =>
      layoutMatch ? createLayoutMarkdownResponse(options, layoutMatch, locale, page) : null,
  });
}

type StudioRouteKind = "studio" | "studio-content" | "studio-nested";

/** Whether a route is one of the studio's own, rather than a page or the Canvas. */
function isStudioRoute(
  match: RuntimeRouteMatch,
): match is RuntimeRouteMatch & { kind: StudioRouteKind } {
  return (
    match.kind === "studio" || match.kind === "studio-content" || match.kind === "studio-nested"
  );
}

/**
 * The studio or page route a locale-relative path names, or null for a runtime-owned route
 * under a locale's prefix (`/de/sitemap.xml`), which names nothing.
 */
function matchLocalizedRoute(path: string) {
  const match = matchRuntimeRoute(path);
  return match.kind === "page" || match.kind === "canvas" || isStudioRoute(match) ? match : null;
}

/**
 * The locale a request's path names, among the locales of the scope it reads: the URL's draft's
 * for a session naming one, else Live's. `live` reads Live's whatever the request names. Without
 * an API there are none to read: every path is the default locale's, which then says it can't
 * render.
 */
async function locateRequest(
  request: Request,
  options: RuntimeOptions,
  pathname: string,
  { live = false }: { live?: boolean } = {},
): Promise<RequestLocale> {
  const { apiUrl, projectSlug } = options;
  const locales =
    apiUrl && projectSlug
      ? await readScopeLocales({
          apiUrl,
          projectSlug,
          ...(!live && {
            authCookieHeader: getServerAuthCookieHeader(request.headers),
            draftId: getRequestDraftId(request, options),
          }),
        })
      : [UNNAMED_DEFAULT_LOCALE];
  return { ...parseLocalePath(pathname, locales), locales };
}
