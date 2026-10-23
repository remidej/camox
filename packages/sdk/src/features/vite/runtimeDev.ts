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
const VIRTUAL_RENDERER_CLIENT = "virtual:camox/renderer-client";
const RESOLVED_VIRTUAL_RENDERER_CLIENT = "\0" + VIRTUAL_RENDERER_CLIENT;
const VIRTUAL_RENDERER_CLIENT_URL = "virtual:camox/renderer-client-url";
const RESOLVED_VIRTUAL_RENDERER_CLIENT_URL = "\0" + VIRTUAL_RENDERER_CLIENT_URL;
const VIRTUAL_BLOCK_CHUNKS = "virtual:camox/block-chunks";
const RESOLVED_VIRTUAL_BLOCK_CHUNKS = "\0" + VIRTUAL_BLOCK_CHUNKS;
const VIRTUAL_APP_STYLESHEET_URL = "virtual:camox/app-stylesheet-url";
const RESOLVED_VIRTUAL_APP_STYLESHEET_URL = "\0" + VIRTUAL_APP_STYLESHEET_URL;
const VIRTUAL_STUDIO_CSS = "virtual:camox-studio-css";
const RESOLVED_VIRTUAL_STUDIO_CSS = "\0" + VIRTUAL_STUDIO_CSS;
const VIRTUAL_OVERLAY_CSS = "virtual:camox-overlay-css";
const RESOLVED_VIRTUAL_OVERLAY_CSS = "\0" + VIRTUAL_OVERLAY_CSS;
export const VIRTUAL_DEV_HTML = "virtual:camox/dev-html";
export const RESOLVED_VIRTUAL_DEV_HTML = "\0" + VIRTUAL_DEV_HTML;

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
    "camox/_internal/rendererClient": resolve(sdkRoot, "src/features/runtime/rendererClient.tsx"),
    "camox/_internal/studioServer": resolve(sdkRoot, "src/features/runtime/studioServer.tsx"),
    "camox/_internal/runtime": resolve(sdkRoot, "src/features/runtime/runtime.ts"),
    "camox/worker": resolve(sdkRoot, "src/features/runtime/worker.ts"),
  };
  const sourceImport = sourceImports[id];
  if (!sourceImport || !existsSync(sourceImport)) return;
  return sourceImport;
}

/**
 * The server loads every block. The browser loads blocks on demand, one module each, so
 * visitors only download the blocks of the pages they see.
 */
function generateVirtualCamoxApp(ssr: boolean): string {
  const blocks = ssr
    ? `const rootBlockModules = import.meta.glob("/src/blocks/*.{ts,tsx}", { eager: true });
const legacyBlockModules = import.meta.glob("/src/camox/blocks/*.{ts,tsx}", { eager: true });
const blockEntries = Object.entries({ ...rootBlockModules, ...legacyBlockModules }).filter(
  ([, mod]) => mod.block,
);
const blocks = blockEntries.map(([, mod]) => mod.block);
const lazyBlocks = {};

/** Each block's module, which the browser loads, so pages can preload it. */
export const blockModulePaths = Object.fromEntries(
  blockEntries.map(([path, mod]) => [mod.block._internal.id, path]),
);`
    : `const blockLoaders = {
  ...import.meta.glob("/src/blocks/*.{ts,tsx}", { import: "block" }),
  ...import.meta.glob("/src/camox/blocks/*.{ts,tsx}", { import: "block" }),
};
const blocks = [];
// Keyed by file name, which is the block's id by convention.
const lazyBlocks = Object.fromEntries(
  Object.entries(blockLoaders).map(([path, load]) => [
    path.slice(path.lastIndexOf("/") + 1).replace(/\\.tsx?$/, ""),
    load,
  ]),
);`;
  return `import { createApp } from "camox/createApp";
import { camoxDocument } from "virtual:camox/document";

const rootCollectionModules = import.meta.glob("/src/collections/*.{ts,tsx}", { eager: true });
const legacyCollectionModules = import.meta.glob("/src/camox/collections/*.{ts,tsx}", { eager: true });
const rootLayoutModules = import.meta.glob("/src/layouts/*.{ts,tsx}", { eager: true });
const legacyLayoutModules = import.meta.glob("/src/camox/layouts/*.{ts,tsx}", { eager: true });

${blocks}
const layouts = [...Object.values(rootLayoutModules), ...Object.values(legacyLayoutModules)]
  .map((mod) => mod.Layout ?? mod.layout)
  .filter(Boolean);
const collections = [
  ...Object.values(rootCollectionModules),
  ...Object.values(legacyCollectionModules),
]
  .map((mod) => mod.collection)
  .filter(Boolean);

export const camoxApp = createApp({
  blocks,
  lazyBlocks,
  layouts,
  collections,
  document: camoxDocument,
});
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

function generateVirtualRendererClient(): string {
  return `import { startRendererWithApp } from "camox/_internal/rendererClient";
import { camoxApp } from "virtual:camox/app";

startRendererWithApp(camoxApp);
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

function generateVirtualRendererClientUrl(): string {
  return `export default ${JSON.stringify(wrapViteDevId(RESOLVED_VIRTUAL_RENDERER_CLIENT))};`;
}

function generateVirtualAppStylesheetUrl(): string {
  return `import stylesheetUrl from "/src/styles.css?url";

export default stylesheetUrl;
`;
}

function generateVirtualCamoxServer(runtimeBasePath?: string): string {
  return `import {
  handleCamoxRequest as handleRuntimeRequest,
  isPublicRequest as isPublicRuntimeRequest,
} from "camox/_internal/runtime";
import { blockModulePaths, camoxApp } from "virtual:camox/app";
import blockChunks from "virtual:camox/block-chunks";
import { camoxDocument } from "virtual:camox/document";
import appStylesheetUrl from "virtual:camox/app-stylesheet-url";
import studioStylesheetUrl from "virtual:camox-studio-css";
import pageClientEntryUrl from "virtual:camox/page-client-url";
import studioClientEntryUrl from "virtual:camox/studio-client-url";
import rendererClientEntryUrl from "virtual:camox/renderer-client-url";
import { renderPage } from "virtual:camox/page-server";
import { renderStudio } from "virtual:camox/studio-server";
import devHtml from "virtual:camox/dev-html";

export { devHtml };
export const runtimeBasePath = ${JSON.stringify(normalizeRuntimeBasePath(runtimeBasePath))};

const options = {
  apiUrl: __CAMOX_API_URL__,
  authenticationUrl: __CAMOX_AUTHENTICATION_URL__,
  blockPreloads: { modulePaths: blockModulePaths, chunks: blockChunks },
  pageClientEntryUrl,
  studioClientEntryUrl,
  rendererClientEntryUrl,
  developmentDraft: __CAMOX_DEVELOPMENT_DRAFT__,
  getCamoxApp: async () => camoxApp,
  getDocument: async () => camoxDocument,
  projectUuid: __CAMOX_PROJECT_ID__,
  renderPage,
  renderStudio,
  runtimeBasePath: ${JSON.stringify(runtimeBasePath)},
  stylesheetUrl: appStylesheetUrl,
  studioStylesheetUrl,
};

export const publicCacheSource = {
  apiUrl: __CAMOX_API_URL__,
  projectUuid: __CAMOX_PROJECT_ID__,
  build: __CAMOX_BUILD_ID__,
};

export async function handleCamoxRequest(request) {
  return handleRuntimeRequest(request, options);
}

export function isPublicRequest(request) {
  return isPublicRuntimeRequest(request, options);
}
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
  if (id === VIRTUAL_RENDERER_CLIENT) return RESOLVED_VIRTUAL_RENDERER_CLIENT;
  if (id === VIRTUAL_RENDERER_CLIENT_URL) return RESOLVED_VIRTUAL_RENDERER_CLIENT_URL;
  if (id === VIRTUAL_APP_STYLESHEET_URL) return RESOLVED_VIRTUAL_APP_STYLESHEET_URL;
  if (id === VIRTUAL_BLOCK_CHUNKS) return RESOLVED_VIRTUAL_BLOCK_CHUNKS;
  if (id === VIRTUAL_STUDIO_CSS) return RESOLVED_VIRTUAL_STUDIO_CSS;
  if (id === VIRTUAL_OVERLAY_CSS) return RESOLVED_VIRTUAL_OVERLAY_CSS;
  if (id === VIRTUAL_DEV_HTML) return RESOLVED_VIRTUAL_DEV_HTML;
}

export function loadRuntimeDevModule(
  id: string,
  options: { runtimeBasePath?: string; ssr?: boolean } = {},
): string | undefined {
  if (id === RESOLVED_VIRTUAL_CAMOX_APP) return generateVirtualCamoxApp(options.ssr !== false);
  // Dev serves each block at its module path, so there are no chunks to map it to.
  if (id === RESOLVED_VIRTUAL_BLOCK_CHUNKS) return "export default null;";
  if (id === RESOLVED_VIRTUAL_CAMOX_DOCUMENT) return generateVirtualCamoxDocument();
  if (id === RESOLVED_VIRTUAL_CAMOX_SERVER)
    return generateVirtualCamoxServer(options.runtimeBasePath);
  if (id === RESOLVED_VIRTUAL_PAGE_SERVER) return generateVirtualPageServer();
  if (id === RESOLVED_VIRTUAL_STUDIO_SERVER) return generateVirtualStudioServer();
  if (id === RESOLVED_VIRTUAL_PAGE_CLIENT) return generateVirtualPageClient();
  if (id === RESOLVED_VIRTUAL_PAGE_CLIENT_URL) return generateVirtualPageClientUrl();
  if (id === RESOLVED_VIRTUAL_STUDIO_CLIENT) return generateVirtualStudioClient();
  if (id === RESOLVED_VIRTUAL_STUDIO_CLIENT_URL) return generateVirtualStudioClientUrl();
  if (id === RESOLVED_VIRTUAL_RENDERER_CLIENT) return generateVirtualRendererClient();
  if (id === RESOLVED_VIRTUAL_RENDERER_CLIENT_URL) return generateVirtualRendererClientUrl();
  if (id === RESOLVED_VIRTUAL_APP_STYLESHEET_URL) return generateVirtualAppStylesheetUrl();
  if (id === RESOLVED_VIRTUAL_STUDIO_CSS) {
    const cssPath = resolve(sdkRoot, "dist/studio.css");
    const cssUrl = `/@fs/${cssPath.replaceAll("\\", "/").replace(/^\/+/, "")}`;
    return `export default ${JSON.stringify(cssUrl)};`;
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
    load(id, loadOptions) {
      return loadRuntimeDevModule(id, { ...options, ssr: loadOptions?.ssr });
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
