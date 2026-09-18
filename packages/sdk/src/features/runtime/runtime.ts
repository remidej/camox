import { QueryClient, dehydrate } from "@tanstack/react-query";
import { createHead, renderSSRHead } from "@unhead/react/server";
import type { Link, Meta, UseHeadInput } from "unhead/types";

import type { CamoxApp } from "../../core/createApp";
import type { CamoxDocument } from "../../core/defineDocument";
import { matchDerivedLayout } from "../../core/derivedRoutes";
import { getPageDestinations } from "../../core/pageDestinations";
import { PLATFORM_SCRIPT } from "../../lib/platform";
import {
  buildClearServerAuthCookieHeader,
  getServerAuthCookieHeader,
} from "../../lib/server-auth-cookie";
import {
  buildCamoxPageHead,
  createMarkdownResponse,
  createServerApiClient,
  isNotFoundError,
  isAuthSessionError,
  seedBlockCaches,
  loadCamoxPageForRequest,
} from "../routes/pageRuntime";
import { STUDIO_THEME_SCRIPT } from "../studio/studioTheme";
import type { StudioRenderInput } from "./studioApp";

const DEFAULT_RUNTIME_BASE_PATH = "";
const RUNTIME_HEALTH_PATH = "/_camox/health";
const RUNTIME_REGISTRY_PATH = "/_camox/registry";

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
  previewDocument?: string;
  routeKind?: "studio" | "studio-content" | "studio-nested";
  project?: Awaited<ReturnType<ReturnType<typeof createServerApiClient>["projects"]["getBySlug"]>>;
  presentation?: "public" | "studio";
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
  const app = await options.getCamoxApp?.();
  const destinations = getPageDestinations(pages, app?.getLayouts() ?? []);
  const updatedAtById = new Map(pages.map((page) => [page.id, page.updatedAt]));
  const entries = destinations
    .map((page) => {
      const updatedAt = page.kind === "curated" ? updatedAtById.get(page.pageId) : undefined;
      const lastmod =
        updatedAt == null
          ? ""
          : `\n    <lastmod>${escapeXml(new Date(updatedAt).toISOString())}</lastmod>`;
      return `  <url>
    <loc>${escapeXml(`${origin}${withRuntimeBasePath(page.fullPath, options.runtimeBasePath)}`)}</loc>${lastmod}
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

function renderHead(
  document: CamoxDocument,
  pageHead: UseHeadInput,
  stylesheetUrl?: string,
  studioStylesheetUrl?: string,
) {
  const head = createHead();
  head.push(createDefaultHeadInput(stylesheetUrl));
  head.push(document);
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

function renderStudioThemeScript(enabled: boolean) {
  return enabled
    ? `<script data-camox-studio>${STUDIO_THEME_SCRIPT}${PLATFORM_SCRIPT}</script>`
    : "";
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

  const singleton = await createDerivedResponse(options, pathname, request, false, true);
  if (singleton) return singleton;

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
    const headers = new Headers({ "Content-Type": "text/html; charset=utf-8", Vary: "Cookie" });
    if (getServerAuthCookieHeader(request.headers))
      headers.set("Cache-Control", "private, no-store");
    if (result.shouldClearAuthCookie) {
      headers.append("Set-Cookie", buildClearServerAuthCookieHeader());
    }

    const camoxApp = await options.getCamoxApp?.();
    const document = (await options.getDocument?.()) ?? {};
    const head = camoxApp ? buildCamoxPageHead(camoxApp, result.data) : {};
    const dehydratedState = dehydrate(queryClient);
    const project =
      result.source === "draft"
        ? await createServerApiClient(options.apiUrl, options.environmentName, {
            authCookieHeader: getServerAuthCookieHeader(request.headers),
          }).projects.getBySlug({ slug: options.projectSlug })
        : undefined;
    const pageRenderInput = {
      project,
      presentation: result.source === "draft" ? "studio" : "public",
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
    // Public documents only need site head/attributes for possible client-side
    // studio activation; avoid rendering or serializing their page content twice.
    await preparePreviewDocument(
      pageRenderInput,
      options,
      document,
      result.source === "live" ? "" : undefined,
    );
    const appHtml = await options.renderPage(pageRenderInput);
    const renderedHead = renderHead(
      result.source === "draft" ? {} : document,
      createPageHeadInput(head),
      result.source === "draft" ? undefined : options.stylesheetUrl,
      result.source === "draft" ? options.studioStylesheetUrl : undefined,
    );

    return new Response(
      `<!doctype html>
<html${renderedHead.htmlAttrs}>
<head>
${renderStudioThemeScript(result.source === "draft")}
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
  dataOnly = false,
  singletonOnly = false,
): Promise<Response | null> {
  const app = await options.getCamoxApp?.();
  const match = app && matchDerivedLayout(app.getLayouts(), pathname);
  if (!match || (!dataOnly && !options.renderPage)) return null;
  if (singletonOnly && match.layout._internal.kind !== "singleton") return null;
  try {
    const data = await match.layout._internal.loader?.({ params: match.params });
    // JSON is the transport contract for request-loaded layout data.
    const serializedData = data === undefined ? undefined : JSON.parse(JSON.stringify(data));
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
    const project =
      source === "draft"
        ? await createServerApiClient(options.apiUrl!, options.environmentName, {
            authCookieHeader,
          }).projects.getBySlug({ slug: options.projectSlug! })
        : undefined;
    const input: PageRenderInput = {
      project,
      presentation: source === "draft" ? "studio" : "public",
      apiUrl: options.apiUrl!,
      authenticationUrl: options.authenticationUrl!,
      projectSlug: options.projectSlug!,
      environmentName: options.environmentName,
      dehydratedState: dehydrate(queryClient),
      head: { meta: [{ title: match.layout._internal.title }] },
      href: request.url,
      layoutIdentity: getLayoutIdentity(shared.layout, source),
      loaderData: null,
      pathname,
      runtimeBasePath: normalizeRuntimeBasePath(options.runtimeBasePath),
      source,
      derived: { layoutId: match.layout._internal.id, data: serializedData, layout: shared.layout },
    };
    const document = (await options.getDocument?.()) ?? {};
    await preparePreviewDocument(
      input,
      options,
      document,
      source === "live" && !dataOnly ? "" : undefined,
    );
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
      source === "draft" ? {} : document,
      { title: match.layout._internal.title },
      source === "draft" ? undefined : options.stylesheetUrl,
      source === "draft" ? options.studioStylesheetUrl : undefined,
    );
    return new Response(
      `<!doctype html><html${head.htmlAttrs}><head>${renderStudioThemeScript(source === "draft")}${head.headTags}<script id="__CAMOX_DATA__" type="application/json">${serializeJsonForHtml(input)}</script></head><body${head.bodyAttrs}>${head.bodyTagsOpen}<div id="root">${html}</div>${head.bodyTags}${renderClientEntryScript(options.pageClientEntryUrl)}</body></html>`,
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          Vary: "Cookie",
          ...(authCookieHeader ? { "Cache-Control": "private, no-store" } : {}),
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
  dataOnly = false,
}: {
  match: RuntimeRouteMatch;
  options: RuntimeOptions;
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
  // A successful protected project lookup validates both session and project access.
  // Cookie presence alone is not proof of authentication.
  const authCookieHeader = getServerAuthCookieHeader(request.headers);
  let project: PageRenderInput["project"];
  let presentation: "public" | "studio" = "public";
  let clearAuthCookie = false;
  if (authCookieHeader) {
    try {
      project = await createServerApiClient(options.apiUrl, options.environmentName, {
        authCookieHeader,
      }).projects.getBySlug({ slug: options.projectSlug });
      presentation = "studio";
    } catch (error) {
      if (!isAuthSessionError(error)) throw error;
      clearAuthCookie = true;
    }
  }
  const studioRenderInput = {
    project,
    source: "live",
    head: { meta: [{ title: "Camox Studio" }] },
    layoutIdentity: null,
    loaderData: null,
    presentation,
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

  const singleton = await createDerivedResponse(options, pathname, request, true, true);
  if (singleton) return singleton;

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
    const headers = new Headers({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
    });
    if (result.shouldClearAuthCookie) {
      headers.append("Set-Cookie", buildClearServerAuthCookieHeader());
    }

    const camoxApp = await options.getCamoxApp?.();
    const head = camoxApp ? buildCamoxPageHead(camoxApp, result.data) : null;
    const dehydratedState = dehydrate(queryClient);
    const project =
      result.source === "draft"
        ? await createServerApiClient(options.apiUrl, options.environmentName, {
            authCookieHeader: getServerAuthCookieHeader(request.headers),
          }).projects.getBySlug({ slug: options.projectSlug })
        : undefined;
    const input: PageRenderInput = {
      apiUrl: options.apiUrl,
      authenticationUrl: options.authenticationUrl ?? "",
      environmentName: options.environmentName,
      projectSlug: options.projectSlug,
      runtimeBasePath: normalizeRuntimeBasePath(options.runtimeBasePath),
      href: request.url,
      presentation: result.source === "draft" ? "studio" : "public",
      source: result.source,
      pathname,
      layoutIdentity: getLayoutIdentity(result.data.page.layout, result.source),
      project,
      loaderData: result.data,
      head,
      dehydratedState,
    };
    await preparePreviewDocument(input, options, (await options.getDocument?.()) ?? {});
    return Response.json(input, { headers });
  } catch (error) {
    if (isNotFoundError(error)) {
      const derived = await createDerivedResponse(options, pathname, request, true);
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

  if (match.kind === "data") {
    const url = new URL(request.url);
    const targetPathname = normalizePagePath(url.searchParams.get("path"));
    const targetMatch = matchRuntimeRoute(targetPathname);
    if (targetMatch.kind.startsWith("studio")) {
      return createStudioHtmlResponse({ match: targetMatch, options, request, dataOnly: true });
    }
    if (targetMatch.kind !== "page") return new Response("Not found", { status: 404 });
    return createPageDataResponse({ options, pathname: targetPathname, request });
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
