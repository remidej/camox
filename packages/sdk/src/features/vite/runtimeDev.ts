import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Plugin } from "vite-plus";

const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const VIRTUAL_CAMOX_APP = "virtual:camox/app";
const RESOLVED_VIRTUAL_CAMOX_APP = "\0" + VIRTUAL_CAMOX_APP;
const VIRTUAL_CAMOX_DOCUMENT = "virtual:camox/document";
const RESOLVED_VIRTUAL_CAMOX_DOCUMENT = "\0" + VIRTUAL_CAMOX_DOCUMENT;
const VIRTUAL_CAMOX_SERVER = "virtual:camox/server";
const RESOLVED_VIRTUAL_CAMOX_SERVER = "\0" + VIRTUAL_CAMOX_SERVER;
const VIRTUAL_CAMOX_NITRO_HANDLER = "#camox/nitro-handler";
const VIRTUAL_PAGE_SERVER = "virtual:camox/page-server";
const RESOLVED_VIRTUAL_PAGE_SERVER = "\0" + VIRTUAL_PAGE_SERVER;
const VIRTUAL_STUDIO_SERVER = "virtual:camox/studio-server";
const RESOLVED_VIRTUAL_STUDIO_SERVER = "\0" + VIRTUAL_STUDIO_SERVER;
const VIRTUAL_PAGE_CLIENT = "virtual:camox/page-client";
const RESOLVED_VIRTUAL_PAGE_CLIENT = "\0" + VIRTUAL_PAGE_CLIENT;
const VIRTUAL_PAGE_CLIENT_URL = "virtual:camox/page-client-url";
const RESOLVED_VIRTUAL_PAGE_CLIENT_URL = "\0" + VIRTUAL_PAGE_CLIENT_URL;
const VIRTUAL_STUDIO_CLIENT = "virtual:camox/studio-client";
const RESOLVED_VIRTUAL_STUDIO_CLIENT = "\0" + VIRTUAL_STUDIO_CLIENT;
const VIRTUAL_STUDIO_CLIENT_URL = "virtual:camox/studio-client-url";
const RESOLVED_VIRTUAL_STUDIO_CLIENT_URL = "\0" + VIRTUAL_STUDIO_CLIENT_URL;
const VIRTUAL_APP_STYLESHEET_URL = "virtual:camox/app-stylesheet-url";
const RESOLVED_VIRTUAL_APP_STYLESHEET_URL = "\0" + VIRTUAL_APP_STYLESHEET_URL;
const VIRTUAL_STUDIO_CSS = "virtual:camox-studio-css";
const RESOLVED_VIRTUAL_STUDIO_CSS = "\0" + VIRTUAL_STUDIO_CSS;
const VIRTUAL_OVERLAY_CSS = "virtual:camox-overlay-css";
const RESOLVED_VIRTUAL_OVERLAY_CSS = "\0" + VIRTUAL_OVERLAY_CSS;

function normalizeImporterPath(importer?: string): string {
  if (!importer) return "";
  const [path] = importer.split("?");
  if (path.startsWith("file://")) return fileURLToPath(path);
  if (path.startsWith("/@fs/")) return path.slice("/@fs".length);
  return path;
}

function resolveSdkAlias(id: string, importer?: string): string | undefined {
  if (!id.startsWith("@/")) return;

  const normalizedImporter = normalizeImporterPath(importer).replaceAll("\\", "/");
  const normalizedSdkSrc = resolve(sdkRoot, "src").replaceAll("\\", "/");
  if (!normalizedImporter.includes(`${normalizedSdkSrc}/`)) return;

  const basePath = resolve(sdkRoot, "src", id.slice(2));
  const candidates = [basePath, `${basePath}.ts`, `${basePath}.tsx`, resolve(basePath, "index.ts")];
  return candidates.find((candidate) => existsSync(candidate));
}

function resolveCamoxSourceImport(id: string): string | undefined {
  const sourceImports: Record<string, string> = {
    "camox/createApp": resolve(sdkRoot, "src/core/createApp.ts"),
    "camox/createBlock": resolve(sdkRoot, "src/core/createBlock.tsx"),
    "camox/createLayout": resolve(sdkRoot, "src/core/createLayout.tsx"),
    "camox/document": resolve(sdkRoot, "src/core/defineDocument.ts"),
    "camox/CamoxProvider": resolve(sdkRoot, "src/features/provider/CamoxProvider.tsx"),
    "camox/CamoxPreview": resolve(sdkRoot, "src/features/preview/CamoxPreview.tsx"),
    "camox/navigation": resolve(sdkRoot, "src/features/navigation/navigation.tsx"),
    "camox/_internal/pageServer": resolve(sdkRoot, "src/features/runtime/pageServer.tsx"),
    "camox/_internal/pageClient": resolve(sdkRoot, "src/features/runtime/pageClient.tsx"),
    "camox/_internal/studioClient": resolve(sdkRoot, "src/features/runtime/studioClient.tsx"),
    "camox/_internal/studioServer": resolve(sdkRoot, "src/features/runtime/studioServer.tsx"),
    "camox/_internal/runtime": resolve(sdkRoot, "src/features/runtime/runtime.ts"),
  };
  const sourceImport = sourceImports[id];
  if (!sourceImport || !existsSync(sourceImport)) return;
  return sourceImport;
}

function generateVirtualCamoxApp(): string {
  return `import { createApp } from "camox/createApp";

const rootBlockModules = import.meta.glob("/src/blocks/*.{ts,tsx}", { eager: true });
const legacyBlockModules = import.meta.glob("/src/camox/blocks/*.{ts,tsx}", { eager: true });
const rootLayoutModules = import.meta.glob("/src/layouts/*.{ts,tsx}", { eager: true });
const legacyLayoutModules = import.meta.glob("/src/camox/layouts/*.{ts,tsx}", { eager: true });

const blocks = [...Object.values(rootBlockModules), ...Object.values(legacyBlockModules)]
  .map((mod) => mod.block)
  .filter(Boolean);
const layouts = [...Object.values(rootLayoutModules), ...Object.values(legacyLayoutModules)]
  .map((mod) => mod.Layout ?? mod.layout)
  .filter(Boolean);

export const camoxApp = createApp({ blocks, layouts });
`;
}

function generateVirtualCamoxDocument(): string {
  return `const documentModules = import.meta.glob("/src/document.{ts,tsx}", { eager: true });
const documents = Object.values(documentModules)
  .map((mod) => mod.default)
  .filter(Boolean);

export const camoxDocument = documents[0] ?? {};
`;
}

function generateVirtualPageServer(): string {
  return `import { renderPageWithApp } from "camox/_internal/pageServer";
import { camoxApp } from "virtual:camox/app";

export async function renderPage(input) {
  return renderPageWithApp({ ...input, camoxApp });
}
`;
}

function generateVirtualStudioServer(): string {
  return `import { renderStudioWithApp } from "camox/_internal/studioServer";
import { camoxApp } from "virtual:camox/app";

export async function renderStudio(input) {
  return renderStudioWithApp({ ...input, camoxApp });
}
`;
}

function generateVirtualPageClient(): string {
  return `import { hydratePageWithApp } from "camox/_internal/pageClient";
import { camoxApp } from "virtual:camox/app";

hydratePageWithApp(camoxApp);
`;
}

function generateVirtualStudioClient(): string {
  return `import { hydrateStudioWithApp } from "camox/_internal/studioClient";
import { camoxApp } from "virtual:camox/app";

hydrateStudioWithApp(camoxApp);
`;
}

function wrapViteDevId(id: string): string {
  return `/@id/${id.replace("\0", "__x00__")}`;
}

function generateVirtualPageClientUrl(): string {
  return `export default ${JSON.stringify(wrapViteDevId(RESOLVED_VIRTUAL_PAGE_CLIENT))};`;
}

function generateVirtualStudioClientUrl(): string {
  return `export default ${JSON.stringify(wrapViteDevId(RESOLVED_VIRTUAL_STUDIO_CLIENT))};`;
}

function generateVirtualAppStylesheetUrl(): string {
  return `import stylesheetUrl from "/src/styles.css?url";

export default stylesheetUrl;
`;
}

function generateVirtualCamoxServer(runtimeBasePath?: string): string {
  return `import { handleCamoxRequest as handleRuntimeRequest } from "camox/_internal/runtime";
import { camoxApp } from "virtual:camox/app";
import { camoxDocument } from "virtual:camox/document";
import appStylesheetUrl from "virtual:camox/app-stylesheet-url";
import studioStylesheetUrl from "virtual:camox-studio-css";
import pageClientEntryUrl from "virtual:camox/page-client-url";
import studioClientEntryUrl from "virtual:camox/studio-client-url";
import { renderPage } from "virtual:camox/page-server";
import { renderStudio } from "virtual:camox/studio-server";

export async function handleCamoxRequest(request) {
  return handleRuntimeRequest(request, {
    apiUrl: __CAMOX_API_URL__,
    authenticationUrl: __CAMOX_AUTHENTICATION_URL__,
    pageClientEntryUrl,
    studioClientEntryUrl,
    environmentName: __CAMOX_ENVIRONMENT_NAME__,
    getCamoxApp: async () => camoxApp,
    getDocument: async () => camoxDocument,
    projectSlug: __CAMOX_PROJECT_SLUG__,
    renderPage,
    renderStudio,
    runtimeBasePath: ${JSON.stringify(runtimeBasePath)},
    stylesheetUrl: appStylesheetUrl,
    studioStylesheetUrl,
  });
}
`;
}

function generateVirtualCamoxNitroHandler(runtimeBasePath?: string): string {
  return `import { defineHandler } from "nitro";
import { handleCamoxRequest } from "virtual:camox/server";

const runtimeBasePath = ${JSON.stringify(normalizeRuntimeBasePath(runtimeBasePath))};

function isDocumentRequest(request) {
  const accept = request.headers.get("Accept") ?? request.headers.get("accept") ?? "";
  return accept.includes("text/html") || accept.includes("*/*");
}

function getRuntimePathname(pathname) {
  if (!runtimeBasePath) return pathname;
  if (pathname === runtimeBasePath) return "/";
  if (!pathname.startsWith(runtimeBasePath + "/")) return null;
  return pathname.slice(runtimeBasePath.length) || "/";
}

function shouldHandleRequest(request) {
  const url = new URL(request.url);
  const pathname = getRuntimePathname(url.pathname);
  if (!pathname) return false;
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (
    pathname === "/_camox/data" ||
    pathname === "/_camox/health" ||
    pathname === "/_camox/registry"
  ) {
    return true;
  }
  if (pathname === "/og" || pathname === "/sitemap.xml") return true;
  if (pathname === "/camox" || pathname.startsWith("/camox/")) return true;
  if (/\\.[a-z0-9]+$/i.test(pathname)) return false;
  if (pathname.startsWith("/@") || pathname.startsWith("/src/")) return false;
  if (pathname.startsWith("/__vite")) return false;
  if (pathname.startsWith("/node_modules/")) return false;
  return isDocumentRequest(request);
}

async function transformHtmlResponse(response) {
  const contentType = response.headers.get("Content-Type") ?? response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return response;
  if (!globalThis.__transform_html__) return response;

  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  headers.delete("content-length");

  return new Response(await globalThis.__transform_html__(await response.text()), {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

export default defineHandler(async (event) => {
  if (!shouldHandleRequest(event.req)) {
    return new Response("Not found", { status: 404 });
  }

  const response = await handleCamoxRequest(event.req);
  if (response) return transformHtmlResponse(response);
  return new Response("Not found", { status: 404 });
});
`;
}

export function resolveRuntimeDevId(id: string, importer?: string): string | undefined {
  const camoxSourceImport = resolveCamoxSourceImport(id);
  if (camoxSourceImport) return camoxSourceImport;

  const sdkAlias = resolveSdkAlias(id, importer);
  if (sdkAlias) return sdkAlias;

  if (id === VIRTUAL_CAMOX_APP) return RESOLVED_VIRTUAL_CAMOX_APP;
  if (id === VIRTUAL_CAMOX_DOCUMENT) return RESOLVED_VIRTUAL_CAMOX_DOCUMENT;
  if (id === VIRTUAL_CAMOX_SERVER) return RESOLVED_VIRTUAL_CAMOX_SERVER;
  if (id === VIRTUAL_PAGE_SERVER) return RESOLVED_VIRTUAL_PAGE_SERVER;
  if (id === VIRTUAL_STUDIO_SERVER) return RESOLVED_VIRTUAL_STUDIO_SERVER;
  if (id === VIRTUAL_PAGE_CLIENT) return RESOLVED_VIRTUAL_PAGE_CLIENT;
  if (id === VIRTUAL_PAGE_CLIENT_URL) return RESOLVED_VIRTUAL_PAGE_CLIENT_URL;
  if (id === VIRTUAL_STUDIO_CLIENT) return RESOLVED_VIRTUAL_STUDIO_CLIENT;
  if (id === VIRTUAL_STUDIO_CLIENT_URL) return RESOLVED_VIRTUAL_STUDIO_CLIENT_URL;
  if (id === VIRTUAL_APP_STYLESHEET_URL) return RESOLVED_VIRTUAL_APP_STYLESHEET_URL;
  if (id === VIRTUAL_STUDIO_CSS) return RESOLVED_VIRTUAL_STUDIO_CSS;
  if (id === VIRTUAL_OVERLAY_CSS) return RESOLVED_VIRTUAL_OVERLAY_CSS;
}

export function loadRuntimeDevModule(
  id: string,
  options: { runtimeBasePath?: string } = {},
): string | undefined {
  if (id === RESOLVED_VIRTUAL_CAMOX_APP) return generateVirtualCamoxApp();
  if (id === RESOLVED_VIRTUAL_CAMOX_DOCUMENT) return generateVirtualCamoxDocument();
  if (id === RESOLVED_VIRTUAL_CAMOX_SERVER)
    return generateVirtualCamoxServer(options.runtimeBasePath);
  if (id === VIRTUAL_CAMOX_NITRO_HANDLER)
    return generateVirtualCamoxNitroHandler(options.runtimeBasePath);
  if (id === RESOLVED_VIRTUAL_PAGE_SERVER) return generateVirtualPageServer();
  if (id === RESOLVED_VIRTUAL_STUDIO_SERVER) return generateVirtualStudioServer();
  if (id === RESOLVED_VIRTUAL_PAGE_CLIENT) return generateVirtualPageClient();
  if (id === RESOLVED_VIRTUAL_PAGE_CLIENT_URL) return generateVirtualPageClientUrl();
  if (id === RESOLVED_VIRTUAL_STUDIO_CLIENT) return generateVirtualStudioClient();
  if (id === RESOLVED_VIRTUAL_STUDIO_CLIENT_URL) return generateVirtualStudioClientUrl();
  if (id === RESOLVED_VIRTUAL_APP_STYLESHEET_URL) return generateVirtualAppStylesheetUrl();
  if (id === RESOLVED_VIRTUAL_STUDIO_CSS) {
    return `export default "/@fs/${resolve(sdkRoot, "dist/studio.css")}";`;
  }
  if (id === RESOLVED_VIRTUAL_OVERLAY_CSS) {
    return `export default ${JSON.stringify(readFileSync(resolve(sdkRoot, "dist/studio-overlays.css"), "utf-8"))};`;
  }
}

export function createRuntimeRegistryPlugin(options: { runtimeBasePath?: string } = {}): Plugin {
  return {
    name: "camox-runtime-registry",
    enforce: "pre",
    resolveId: resolveRuntimeDevId,
    load(id) {
      return loadRuntimeDevModule(id, options);
    },
  };
}

function normalizeRuntimeBasePath(basePath?: string): string {
  if (basePath === undefined) return "";
  if (!basePath || basePath === "/") return "";
  return basePath.startsWith("/")
    ? basePath.replace(/\/+$/, "")
    : `/${basePath.replace(/\/+$/, "")}`;
}

function isDocumentRequest(request: Request): boolean {
  const accept = request.headers.get("Accept") ?? request.headers.get("accept") ?? "";
  return accept.includes("text/html") || accept.includes("*/*");
}

export function shouldHandleRuntimeRequest(request: Request, runtimeBasePath?: string) {
  const url = new URL(request.url);
  const basePath = normalizeRuntimeBasePath(runtimeBasePath);
  if (basePath) return url.pathname === basePath || url.pathname.startsWith(`${basePath}/`);

  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (
    url.pathname === "/_camox/data" ||
    url.pathname === "/_camox/health" ||
    url.pathname === "/_camox/registry"
  ) {
    return true;
  }
  if (url.pathname === "/og" || url.pathname === "/sitemap.xml") return true;
  if (url.pathname === "/camox" || url.pathname.startsWith("/camox/")) return true;
  if (/\.[a-z0-9]+$/i.test(url.pathname)) return false;
  if (url.pathname.startsWith("/@") || url.pathname.startsWith("/src/")) return false;
  if (url.pathname.startsWith("/__vite")) return false;
  if (url.pathname.startsWith("/node_modules/")) return false;
  if (!isDocumentRequest(request)) return false;

  return true;
}

export function installRuntimeNitroRoutes(
  nitro: { options: { routes: Record<string, string>; virtual: Record<string, string> } },
  options: { runtimeBasePath?: string },
) {
  const routes =
    options.runtimeBasePath && options.runtimeBasePath !== "/"
      ? [options.runtimeBasePath, `${options.runtimeBasePath}/**`]
      : [
          "/",
          "/_camox/data",
          "/_camox/health",
          "/_camox/registry",
          "/og",
          "/sitemap.xml",
          "/camox",
          "/camox/**",
          "/**",
        ];

  for (const route of routes) nitro.options.routes[route] = VIRTUAL_CAMOX_NITRO_HANDLER;
  nitro.options.virtual[VIRTUAL_CAMOX_NITRO_HANDLER] = generateVirtualCamoxNitroHandler(
    options.runtimeBasePath,
  );
}
