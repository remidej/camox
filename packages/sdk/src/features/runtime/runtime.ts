import { QueryClient, dehydrate } from "@tanstack/react-query";
import { createHead, renderSSRHead } from "@unhead/react/server";
import type { Link, Meta, UseHeadInput } from "unhead/types";

import type { CamoxApp } from "../../core/createApp";
import type { CamoxDocument } from "../../core/defineDocument";
import { matchDerivedLayout } from "../../core/derivedRoutes";
import {
  buildCamoxPageHead,
  createMarkdownResponse,
  createServerApiClient,
  isNotFoundError,
  isAuthSessionError,
  seedBlockCaches,
  loadCamoxPageForRequest,
} from "../routes/pageRuntime";
import type { StudioRenderInput } from "./studioApp";

const DEFAULT_RUNTIME_BASE_PATH = "";
const RUNTIME_HEALTH_PATH = "/_camox/health";
const RUNTIME_REGISTRY_PATH = "/_camox/registry";
const SERVER_AUTH_COOKIE_NAME = "camox_auth_cookie";

export type RuntimeRouteKind =
  | "data"
  | "health"
  | "og"
  | "page"
  | "registry"
  | "sitemap"
  | "studio"
  | "studio-content"
  | "studio-nested";

export interface RuntimeRouteMatch {
  kind: RuntimeRouteKind;
  pathname: string;
}

export interface LayoutIdentity {
  blockIds: number[];
  id: number;
  layoutId: string;
  version: string;
}

export interface PageRenderInput {
  derived?: {
    layoutId: string;
    data: unknown;
    layout: Awaited<
      ReturnType<ReturnType<typeof createServerApiClient>["layouts"]["get"]>
    >["layout"];
  };
  apiUrl: string;
  authenticationUrl: string;
  dehydratedState: unknown;
  environmentName?: string;
  head: unknown;
  href: string;
  layoutIdentity: LayoutIdentity | null;
  loaderData: unknown;
  pathname: string;
  projectSlug: string;
  runtimeBasePath: string;
  source: "live" | "draft";
}

export interface RuntimeOptions {
  apiUrl?: string;
  authenticationUrl?: string;
  environmentName?: string;
  pageClientEntryUrl?: string;
  studioClientEntryUrl?: string;
  getCamoxApp?: () => Promise<CamoxApp>;
  getDocument?: () => Promise<CamoxDocument>;
  projectSlug?: string;
  renderPage?: (input: PageRenderInput) => Promise<string>;
  renderStudio?: (input: StudioRenderInput) => Promise<string>;
  runtimeBasePath?: string;
  stylesheetUrl?: string;
}

function buildClearServerAuthCookieHeader() {
  return `${SERVER_AUTH_COOKIE_NAME}=; Path=/; SameSite=Lax; Max-Age=0`;
}

function getServerAuthCookieHeader(headers: Headers): string {
  const cookieHeader = headers.get("Cookie") ?? headers.get("cookie") ?? "";
  const cookies = cookieHeader.split(";").map((part) => part.trim());
  const authCookie = cookies.find((part) => part.startsWith(`${SERVER_AUTH_COOKIE_NAME}=`));
  if (!authCookie) return "";

  const value = authCookie.slice(SERVER_AUTH_COOKIE_NAME.length + 1);
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
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
  source: Awaited<ReturnType<typeof loadCamoxPageForRequest>>["source"],
): LayoutIdentity | null {
  if (!layout) return null;

  const version =
    source === "live"
      ? String(layout.livePublishedCheckpointId ?? "none")
      : String(layout.contentUpdatedAt ?? layout.updatedAt);

  return {
    blockIds: [...layout.beforeBlockIds, ...layout.afterBlockIds],
    id: layout.id,
    layoutId: layout.layoutId,
    version,
  };
}

export function matchRuntimeRoute(pathname: string): RuntimeRouteMatch {
  if (pathname === RUNTIME_HEALTH_PATH) return { kind: "health", pathname };
  if (pathname === RUNTIME_REGISTRY_PATH) return { kind: "registry", pathname };
  if (pathname === "/_camox/data") return { kind: "data", pathname };
  if (pathname === "/camox") return { kind: "studio", pathname };
  if (pathname === "/camox/content") return { kind: "studio-content", pathname };
  if (pathname.startsWith("/camox/")) return { kind: "studio-nested", pathname };
  if (pathname === "/og") return { kind: "og", pathname };
  if (pathname === "/sitemap.xml") return { kind: "sitemap", pathname };

  return { kind: "page", pathname };
}

function withRuntimeBasePath(pathname: string, runtimeBasePath?: string): string {
  const basePath = normalizeRuntimeBasePath(runtimeBasePath);
  if (!basePath) return pathname;
  if (pathname === "/") return `${basePath}/`;
  return `${basePath}${pathname}`;
}

async function createSitemapResponse(request: Request, options: RuntimeOptions): Promise<Response> {
  if (!options.apiUrl || !options.projectSlug) {
    return Response.json({ message: "Camox sitemap is not configured." }, { status: 500 });
  }

  const api = createServerApiClient(options.apiUrl, options.environmentName);
  const origin = new URL(request.url).origin;
  const pages = await api.pages.listBySlug({ projectSlug: options.projectSlug });
  const entries = pages
    .map(
      (page) => `  <url>
    <loc>${escapeXml(`${origin}${withRuntimeBasePath(page.fullPath, options.runtimeBasePath)}`)}</loc>
    <lastmod>${escapeXml(new Date(page.updatedAt).toISOString())}</lastmod>
  </url>`,
    )
    .join("\n");

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } },
  );
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
    if (entry.rel !== "icon" || !entry.href) continue;
    pageLinks.push({ rel: "icon", href: entry.href, "data-camox-page-head": "true" });
  }

  return {
    ...(title && { title }),
    meta: pageMeta,
    link: pageLinks,
  };
}

function renderHead(document: CamoxDocument, pageHead: UseHeadInput, stylesheetUrl?: string) {
  const head = createHead();
  head.push(createDefaultHeadInput(stylesheetUrl));
  head.push(document);
  head.push(pageHead);
  return renderSSRHead(head);
}

function serializeJsonForHtml(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function renderClientEntryScript(src?: string): string {
  if (!src) return "";
  return `<script type="module" src="${escapeXml(src)}"></script>`;
}

async function createPageHtmlResponse({
  options,
  pathname,
  request,
}: {
  options: RuntimeOptions;
  pathname: string;
  request: Request;
}): Promise<Response> {
  if (
    !options.apiUrl ||
    !options.authenticationUrl ||
    !options.projectSlug ||
    !options.renderPage
  ) {
    return createPageDataResponse({ options, pathname, request });
  }

  const queryClient = new QueryClient();
  try {
    const result = await loadCamoxPageForRequest({
      apiUrl: options.apiUrl,
      authCookieHeader: getServerAuthCookieHeader(request.headers),
      environmentName: options.environmentName,
      origin: new URL(request.url).origin,
      pathname,
      projectSlug: options.projectSlug,
      queryClient,
    });
    const headers = new Headers({ "Content-Type": "text/html; charset=utf-8" });
    if (result.shouldClearAuthCookie) {
      headers.append("Set-Cookie", buildClearServerAuthCookieHeader());
    }

    const camoxApp = await options.getCamoxApp?.();
    const document = (await options.getDocument?.()) ?? {};
    const head = camoxApp ? buildCamoxPageHead(camoxApp, result.data) : {};
    const dehydratedState = dehydrate(queryClient);
    const pageRenderInput = {
      apiUrl: options.apiUrl,
      authenticationUrl: options.authenticationUrl,
      dehydratedState,
      environmentName: options.environmentName,
      head,
      href: new URL(request.url).href,
      layoutIdentity: getLayoutIdentity(result.data.page.layout, result.source),
      loaderData: result.data,
      pathname,
      projectSlug: options.projectSlug,
      runtimeBasePath: normalizeRuntimeBasePath(options.runtimeBasePath),
      source: result.source,
    } satisfies PageRenderInput;
    const appHtml = await options.renderPage(pageRenderInput);
    const renderedHead = renderHead(document, createPageHeadInput(head), options.stylesheetUrl);

    return new Response(
      `<!doctype html>
<html${renderedHead.htmlAttrs}>
<head>
${renderedHead.headTags}
<script id="__CAMOX_DATA__" type="application/json">${serializeJsonForHtml(pageRenderInput)}</script>
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
      const derived = await createDerivedResponse(options, pathname, request);
      if (derived) return derived;
      return new Response("No Camox page on this path", { status: 404 });
    }
    throw error;
  }
}

async function createDerivedResponse(
  options: RuntimeOptions,
  pathname: string,
  request: Request,
): Promise<Response | null> {
  const app = await options.getCamoxApp?.();
  const match = app && matchDerivedLayout(app.getLayouts(), pathname);
  if (!match || !options.renderPage) return null;
  try {
    const data = await match.layout._internal.loader!({ params: match.params });
    // JSON is the transport contract for request-loaded layout data.
    const serializedData = JSON.parse(JSON.stringify(data));
    const queryClient = new QueryClient();
    const authCookieHeader = getServerAuthCookieHeader(request.headers);
    let source: "live" | "draft" = authCookieHeader ? "draft" : "live";
    let clearAuthCookie = false;
    const loadLayout = (source: "live" | "draft") =>
      createServerApiClient(options.apiUrl!, options.environmentName, {
        authCookieHeader: source === "draft" ? authCookieHeader : undefined,
      }).layouts.get({
        projectSlug: options.projectSlug!,
        layoutId: match.layout._internal.id,
        source,
      });
    const shared = await loadLayout(source).catch(async (error) => {
      if (source !== "draft" || !isAuthSessionError(error)) throw error;
      source = "live";
      clearAuthCookie = true;
      return loadLayout("live");
    });
    seedBlockCaches(queryClient, shared, source);
    const input: PageRenderInput = {
      apiUrl: options.apiUrl!,
      authenticationUrl: options.authenticationUrl!,
      projectSlug: options.projectSlug!,
      environmentName: options.environmentName,
      dehydratedState: dehydrate(queryClient),
      head: {},
      href: request.url,
      layoutIdentity: getLayoutIdentity(shared.layout, source),
      loaderData: null,
      pathname,
      runtimeBasePath: normalizeRuntimeBasePath(options.runtimeBasePath),
      source,
      derived: { layoutId: match.layout._internal.id, data: serializedData, layout: shared.layout },
    };
    const html = await options.renderPage(input);
    const head = renderHead(
      (await options.getDocument?.()) ?? {},
      { title: match.layout._internal.title },
      options.stylesheetUrl,
    );
    return new Response(
      `<!doctype html><html${head.htmlAttrs}><head>${head.headTags}<script id="__CAMOX_DATA__" type="application/json">${serializeJsonForHtml(input)}</script></head><body${head.bodyAttrs}>${head.bodyTagsOpen}<div id="root">${html}</div>${head.bodyTags}${renderClientEntryScript(options.pageClientEntryUrl)}</body></html>`,
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
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
  request,
}: {
  match: RuntimeRouteMatch;
  options: RuntimeOptions;
  request: Request;
}): Promise<Response> {
  if (
    !options.apiUrl ||
    !options.authenticationUrl ||
    !options.projectSlug ||
    !options.renderStudio
  ) {
    return Response.json(
      { message: "Camox Studio renderer is not configured.", ...match },
      { status: 500 },
    );
  }

  const queryClient = new QueryClient();
  const document = (await options.getDocument?.()) ?? {};
  const studioRenderInput = {
    apiUrl: options.apiUrl,
    authenticationUrl: options.authenticationUrl,
    dehydratedState: dehydrate(queryClient),
    environmentName: options.environmentName,
    href: new URL(request.url).href,
    pathname: match.pathname,
    projectSlug: options.projectSlug,
    routeKind: match.kind as "studio" | "studio-content" | "studio-nested",
    runtimeBasePath: normalizeRuntimeBasePath(options.runtimeBasePath),
  } satisfies StudioRenderInput;
  const appHtml = await options.renderStudio(studioRenderInput);
  const renderedHead = renderHead(document, {}, options.stylesheetUrl);

  return new Response(
    `<!doctype html>
<html${renderedHead.htmlAttrs}>
<head>
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
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

async function createPageDataResponse({
  options,
  pathname,
  request,
}: {
  options: RuntimeOptions;
  pathname: string;
  request: Request;
}): Promise<Response> {
  if (!options.apiUrl || !options.projectSlug) {
    return Response.json({ message: "Camox page loader is not configured." }, { status: 500 });
  }

  const queryClient = new QueryClient();
  try {
    const result = await loadCamoxPageForRequest({
      apiUrl: options.apiUrl,
      authCookieHeader: getServerAuthCookieHeader(request.headers),
      environmentName: options.environmentName,
      origin: new URL(request.url).origin,
      pathname,
      projectSlug: options.projectSlug,
      queryClient,
    });
    const headers = new Headers({ "Content-Type": "application/json; charset=utf-8" });
    if (result.shouldClearAuthCookie) {
      headers.append("Set-Cookie", buildClearServerAuthCookieHeader());
    }

    const camoxApp = await options.getCamoxApp?.();
    const head = camoxApp ? buildCamoxPageHead(camoxApp, result.data) : null;
    const dehydratedState = dehydrate(queryClient);
    const { page, layout, projectName, project } = result.data.page;
    return new Response(
      `${JSON.stringify(
        {
          kind: "page",
          pathname,
          page: {
            id: page.id,
            fullPath: page.fullPath,
            metaTitle: page.metaTitle,
            metaDescription: page.metaDescription,
          },
          layout: layout ? { id: layout.id, layoutId: layout.layoutId } : null,
          layoutIdentity: getLayoutIdentity(result.data.page.layout, result.source),
          project: { id: project.id, name: projectName },
          loaderData: {
            faviconUrl: result.data.faviconUrl,
            origin: result.data.origin,
          },
          head,
          dehydratedState,
        },
        null,
        2,
      )}\n`,
      { headers },
    );
  } catch (error) {
    if (isNotFoundError(error)) {
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

  if (match.kind === "data") {
    const url = new URL(request.url);
    return createPageDataResponse({
      options,
      pathname: normalizePagePath(url.searchParams.get("path")),
      request,
    });
  }

  if (
    match.kind === "studio" ||
    match.kind === "studio-content" ||
    match.kind === "studio-nested"
  ) {
    return createStudioHtmlResponse({ match, options, request });
  }

  if (match.kind === "page") {
    if (options.apiUrl && options.projectSlug) {
      const markdownResponse = await createMarkdownResponse({
        apiUrl: options.apiUrl,
        environmentName: options.environmentName,
        pathname: match.pathname,
        projectSlug: options.projectSlug,
        request,
      });
      if (markdownResponse) return markdownResponse;
    }

    return createPageHtmlResponse({ options, pathname: match.pathname, request });
  }

  return Response.json(
    {
      message: "Camox runtime route matched.",
      ...match,
    },
    { status: 501 },
  );
}
