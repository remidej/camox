import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DEVELOPMENT_DRAFT } from "@camox/api-contract/drafts";
import { projectIdSchema } from "@camox/api-contract/ids";
import {
  type Logger,
  type Plugin,
  type ResolvedConfig,
  type UserConfig,
  type ViteDevServer,
  createServer,
} from "vite-plus";

import { type ServerApiClient, createServerApiClient } from "../../lib/api-client-server";

const pluginDir = dirname(fileURLToPath(import.meta.url));
const sdkRoot = resolve(pluginDir, "../../..");
const isSdkSource = pluginDir === resolve(sdkRoot, "src/features/vite");
const VIRTUAL_STUDIO_CSS = "virtual:camox-studio-css";
const RESOLVED_VIRTUAL_STUDIO_CSS = "\0" + VIRTUAL_STUDIO_CSS;
const VIRTUAL_OVERLAY_CSS = "virtual:camox-overlay-css";
const RESOLVED_VIRTUAL_OVERLAY_CSS = "\0" + VIRTUAL_OVERLAY_CSS;
const VIRTUAL_PAGE_CLIENT = "virtual:camox/page-client";
const RESOLVED_VIRTUAL_PAGE_CLIENT_URL = "\0virtual:camox/page-client-url";
const VIRTUAL_STUDIO_CLIENT = "virtual:camox/studio-client";
const RESOLVED_VIRTUAL_STUDIO_CLIENT_URL = "\0virtual:camox/studio-client-url";
const RESOLVED_VIRTUAL_BLOCK_CHUNKS = "\0virtual:camox/block-chunks";
import { transformArtifactRuntime } from "./artifactRuntimeMinification";
import { readAuthTokenForUrl } from "./auth";
import { watchNewBlockFiles } from "./blockBoilerplate";
import { collectBlockChunks } from "./blockChunks";
import { type BundlerOnLog, withoutExpectedCamoxLogs } from "./bundlerLogs";
import { installDevAuthenticationMiddleware } from "./devAuthentication";
import { installDevSignInLink } from "./devSignIn";
import { generateIconTypes } from "./iconGeneration";
import { generateLayoutFiles, watchLayoutFiles } from "./layoutGeneration";
import { buildClientThenWorker } from "./workerBuild";

const PRODUCTION_API_URL = "https://api.camox.ai";
import { VIRTUAL_CAMOX_APP, syncDefinitions, syncDefinitionsToApi } from "./definitionsSync";
import { publishSeededContent } from "./publishSeededContent";
import { cleanupGeneratedRouteFiles } from "./routeGeneration";
import {
  RESOLVED_VIRTUAL_DEV_HTML,
  createRuntimeRegistryPlugin,
  loadRuntimeDevModule,
  resolveRuntimeDevId,
} from "./runtimeDev";

/** Authentication URL to use for Camox authentication (production Camox Dashboard) */
const DEFAULT_AUTHENTICATION_URL = "https://app.camox.ai";

/** What Vite injects into HTML in dev, which the Worker can't ask Vite for itself. */
async function getDevHtml(server: ViteDevServer): Promise<{ head: string; body: string }> {
  const html = await server.transformIndexHtml("/", "<html><head></head><body></body></html>");
  return {
    head: /<head[^>]*>([\s\S]*)<\/head>/i.exec(html)?.[1] ?? "",
    body: /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? "",
  };
}

/** The `onLog` the app set for its client build, which Camox wraps rather than replaces. */
function findClientOnLog(config: UserConfig): BundlerOnLog | undefined {
  const clientBuild = config.environments?.client?.build;
  return (
    clientBuild?.rolldownOptions?.onLog ??
    clientBuild?.rollupOptions?.onLog ??
    config.build?.rolldownOptions?.onLog ??
    config.build?.rollupOptions?.onLog
  );
}

type StoredAuth = NonNullable<ReturnType<typeof readAuthTokenForUrl>>;

/**
 * Drop a sidecar at `<root>/node_modules/.camox/runtime.json` so the `camox`
 * CLI can pick up the same Project ID / apiUrl / authenticationUrl the
 * plugin actually used. The CLI treats the vite config as the source of
 * truth for those values — there is no other reliable way to recover them
 * from outside vite. No draft is written here: the CLI always works in the
 * developer's development draft (ADR 0010).
 */
function writeRuntimeSidecar(
  root: string,
  data: {
    projectId: string;
    apiUrl: string;
    authenticationUrl: string;
    disableTelemetry: boolean;
  },
): void {
  const dir = join(root, "node_modules", ".camox");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "runtime.json"), `${JSON.stringify(data, null, 2)}\n`);
}

/** What `_internal.afterSync` receives: an API client authenticated as the dev user. */
export interface CamoxAfterSyncContext {
  /** Sends the dev session and reads and writes the developer's development draft. */
  client: ServerApiClient;
  /** The project's Project ID, which API inputs name `projectUuid`. */
  projectUuid: string;
  logger: Logger;
}

export interface CamoxPluginOptions {
  /**
   * The project's Project ID, shown in the Camox dashboard: a lowercase UUIDv7 that never changes
   * (e.g. "01a15fff-627b-7fa1-938b-93ab659c1acc").
   */
  projectId: string;
  /** Iconify collection available to all icon fields. */
  icons?: string;
  /** Disable telemetry collection (default: false) */
  disableTelemetry?: boolean;
  /** Internal options (intended for Camox contributors in development, not for public use) */
  _internal?: {
    /** URL of the Camox API backend, used for data fetching */
    apiUrl?: string;
    /** URL of the Camox authentication backend (default: https://app.camox.ai) */
    authenticationUrl?: string;
    /** Show Tanstack query devtools (default: false) */
    enableTanstackDevtools?: boolean;
    /** Enable experimental features (default: false). */
    enableExperimentalFeatures?: boolean;
    /** Disable automatic code generation (route and layout files) (default: false) */
    disableCodeGen?: boolean;
    /** Mount the Camox-owned dev runtime at this base path. Use "/" for root mode. */
    runtimeBasePath?: string;
    /** Opt-in browser opening for this app's generated development sign-in link. */
    devSignIn?: {
      open?: boolean;
      /** Empty marker file shared across restarts of one dev invocation. */
      openOnceFile?: string;
    };
    /**
     * Dev-only: runs once per dev server start, after the initial definition sync
     * succeeds. A failure is logged as a warning and never breaks dev.
     */
    afterSync?: (context: CamoxAfterSyncContext) => void | Promise<void>;
    /**
     * Dev-only: a deploy token for seeding Live. When Live has no pages yet, the first sync
     * releases the local definitions to Live, and the development draft is published after
     * `afterSync`, so seeded content becomes Live instead of the draft's changes.
     */
    seedLiveDeployToken?: string;
  };
}

// The Studio UI loads dynamically at runtime, so Vite's scanner can't see every
// dependency before startup. Include the runtime discoveries up front to avoid
// re-optimization reloads and 504 "Outdated Optimize Dep" responses.
// Entries prefixed with `camox >` are SDK dependencies that may not be
// resolvable as bare specifiers from the user app's root under pnpm.
export const CAMOX_OPTIMIZED_DEPS = [
  // React entries reached through `virtual:tanstack-start-client-entry`, which Vite's
  // scanner can't crawl — without these they're discovered at runtime, triggering a
  // re-optimize and 504 "Outdated Optimize Dep" errors on the in-flight requests.
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "camox > @base-ui/react/accordion",
  "camox > @base-ui/react/alert-dialog",
  "camox > @base-ui/react/avatar",
  "camox > @base-ui/react/button",
  "camox > @base-ui/react/checkbox",
  "camox > @base-ui/react/combobox",
  "camox > @base-ui/react/dialog",
  "camox > @base-ui/react/input",
  "camox > @base-ui/react/menu",
  "camox > @base-ui/react/merge-props",
  "camox > @base-ui/react/popover",
  "camox > @base-ui/react/select",
  "camox > @base-ui/react/separator",
  "camox > @base-ui/react/switch",
  "camox > @base-ui/react/tabs",
  "camox > @base-ui/react/toggle",
  "camox > @base-ui/react/tooltip",
  "camox > @base-ui/react/use-render",
  "camox > @camox/ui > class-variance-authority",
  "camox > @camox/ui > clsx",
  "camox > @camox/ui > cmdk",
  "camox > @camox/ui > lucide-react",
  "camox > @camox/ui > @shadcn/react/message-scroller",
  "camox > @camox/ui > sonner",
  "camox > @camox/ui > tailwind-merge",
  "camox > @dnd-kit/core",
  "camox > @dnd-kit/modifiers",
  "camox > @dnd-kit/sortable",
  "camox > @dnd-kit/utilities",
  "camox > @lexical/react/LexicalComposer",
  "camox > @lexical/react/LexicalComposerContext",
  "camox > @lexical/react/LexicalContentEditable",
  "camox > @lexical/react/LexicalHistoryPlugin",
  "camox > @lexical/react/LexicalLinkPlugin",
  "camox > @lexical/react/LexicalOnChangePlugin",
  "camox > @lexical/react/LexicalRichTextPlugin",
  "camox > @lexical/link",
  "camox > @lexical/utils",
  "camox > @orpc/client",
  "camox > @orpc/client/fetch",
  "camox > @orpc/tanstack-query",
  "camox > @shikijs/core",
  "camox > @shikijs/engine-javascript",
  "camox > @shikijs/langs/markdown",
  "camox > @shikijs/themes/github-dark-high-contrast",
  "camox > @shikijs/themes/github-light",
  "camox > @sinclair/typebox",
  "camox > @takumi-rs/image-response",
  "camox > @tanstack/react-form",
  "camox > @tanstack/react-query",
  "camox > @tanstack/react-router",
  "camox > @tanstack/react-virtual",
  "camox > @unhead/react/client",
  "camox > @unhead/react/server",
  "camox > @unhead/schema-org",
  "camox > @xstate/store",
  "camox > @xstate/store-react",
  "camox > better-auth/client/plugins",
  "camox > better-auth/react",
  "camox > better-auth > @better-auth/core/env",
  "camox > better-auth > @better-auth/core/error",
  "camox > better-auth > @better-auth/core/utils/error-codes",
  "camox > better-auth > @better-auth/core/utils/string",
  "camox > better-auth > @better-fetch/fetch",
  "camox > better-auth > defu",
  "camox > better-auth > nanostores",
  "camox > fractional-indexing",
  "camox > lexical",
  "camox > lucide-react",
  "camox > marked",
  "camox > @tanstack/react-query-devtools/production",
  "camox > partysocket/react",
  "camox > zod",
];

/**
 * The Worker runs in workerd, so its dependencies are pre-bundled too. Discovering them one
 * request at a time would reload the Worker for each, so start from the browser's list.
 */
export const CAMOX_WORKER_OPTIMIZED_DEPS = [
  ...CAMOX_OPTIMIZED_DEPS,
  "react-dom/server",
  "react/compiler-runtime",
  "camox > @unhead/react/server",
];

/**
 * The Project ID a config names, refused on startup when it is missing or malformed, or when the
 * config still names its project by its Project Slug.
 */
function projectIdOf(options: CamoxPluginOptions): string {
  if ("projectSlug" in options) {
    throw new Error(
      "Camox: `projectSlug` was replaced by `projectId`. Replace it in your camox() config with " +
        "the Project ID shown in the Camox dashboard, on your project's page.",
    );
  }
  if (!projectIdSchema.safeParse(options.projectId).success) {
    throw new Error(
      `Camox: ${JSON.stringify(options.projectId)} is not a Project ID. Copy your project's ` +
        "Project ID, a lowercase UUIDv7, from the Camox dashboard into your camox() config.",
    );
  }
  return options.projectId;
}

export function camox(options: CamoxPluginOptions): Plugin {
  const projectUuid = projectIdOf(options);
  const apiUrl = options._internal?.apiUrl ?? PRODUCTION_API_URL;
  const authenticationUrl = options._internal?.authenticationUrl ?? DEFAULT_AUTHENTICATION_URL;
  const enableTanstackDevtools = options._internal?.enableTanstackDevtools ?? false;
  const disableCodeGen = options._internal?.disableCodeGen ?? false;
  const runtimeBasePath = options._internal?.runtimeBasePath;

  let isBuild = false;
  let isRelease = false;
  /** A release's build, without syncing to Live: what the upgrade job checks a project with. */
  let isDryRun = false;
  let resolvedConfig: ResolvedConfig;
  let localAuth: StoredAuth | null = null;
  let blockChunks: Record<string, string[]> = {};
  let devServer: ViteDevServer | undefined;

  return {
    name: "camox",
    enforce: "pre",
    resolveId(id, importer) {
      const runtimeId = resolveRuntimeDevId(id, importer);
      if (runtimeId) return runtimeId;
      if (id === VIRTUAL_STUDIO_CSS) return RESOLVED_VIRTUAL_STUDIO_CSS;
      if (id === VIRTUAL_OVERLAY_CSS) return RESOLVED_VIRTUAL_OVERLAY_CSS;
    },
    async load(id, loadOptions) {
      // Local CSS watchers must not share the directory cleaned by package builds.
      const stylesDir = resolve(sdkRoot, !isBuild && isSdkSource ? ".dev" : "dist");
      if (id === RESOLVED_VIRTUAL_STUDIO_CSS) {
        const cssPath = resolve(stylesDir, "studio.css");
        if (isBuild) {
          // A fixed public path, not an asset URL: the server build must render the
          // same href, and inlining the CSS would ship it to every visitor's JS.
          const css = readFileSync(cssPath, "utf-8");
          const hash = createHash("sha256").update(css).digest("hex").slice(0, 8);
          const fileName = `assets/camox-studio-${hash}.css`;
          this.emitFile({ type: "asset", fileName, source: css });
          return `export default ${JSON.stringify(`/${fileName}`)};`;
        }
        // Dev: serve the file directly via Vite's /@fs/ prefix
        const cssUrl = `/@fs/${cssPath.replaceAll("\\", "/").replace(/^\/+/, "")}`;
        return `export default ${JSON.stringify(cssUrl)};`;
      }
      if (id === RESOLVED_VIRTUAL_OVERLAY_CSS) {
        const cssPath = resolve(stylesDir, "studio-overlays.css");
        const css = readFileSync(cssPath, "utf-8");
        return `export default ${JSON.stringify(css)};`;
      }
      if (id === RESOLVED_VIRTUAL_PAGE_CLIENT_URL && isBuild) {
        return 'export default "/_chunks/camox-page-client.mjs";';
      }
      if (id === RESOLVED_VIRTUAL_STUDIO_CLIENT_URL && isBuild) {
        return 'export default "/_chunks/camox-studio-client.mjs";';
      }
      // The client builds first, so the server build can read where each block ended up.
      if (id === RESOLVED_VIRTUAL_BLOCK_CHUNKS && isBuild) {
        return `export default ${JSON.stringify(blockChunks)};`;
      }
      if (id === RESOLVED_VIRTUAL_DEV_HTML) {
        if (!devServer) return "export default null;";
        return `export default ${JSON.stringify(await getDevHtml(devServer))};`;
      }
      return loadRuntimeDevModule(id, { runtimeBasePath, ssr: loadOptions?.ssr });
    },
    // Apps that compile the SDK from source minify the artifact runtime as its build does.
    transform(code, id) {
      return transformArtifactRuntime(code, id);
    },
    generateBundle(_outputOptions, bundle) {
      if (this.environment.name !== "client") return;
      blockChunks = collectBlockChunks(bundle, resolvedConfig.root);
    },
    async config(_config, env) {
      const iconIds = await generateIconTypes(
        resolve(_config.root ?? process.cwd()),
        options.icons,
      );
      isBuild = env.command === "build";
      // `camox release` sets "1", and `camox release --dry-run` sets "dry-run".
      const release = process.env.CAMOX_INTERNAL_RELEASE;
      isRelease = isBuild && (release === "1" || release === "dry-run");
      isDryRun = isRelease && release === "dry-run";
      if (!isRelease) {
        localAuth = readAuthTokenForUrl(authenticationUrl);
        if (isBuild && !localAuth) {
          throw new Error(
            "Camox: not authenticated. Run `npx camox login` before building the site.",
          );
        }
      }
      return {
        build: {
          emitAssets: true,
        },
        // An app's own build order wins.
        ...(_config.builder?.buildApp ? {} : { builder: { buildApp: buildClientThenWorker } }),
        define: {
          __CAMOX_ICON_IDS__: JSON.stringify(iconIds),
          __CAMOX_TELEMETRY_DISABLED__: JSON.stringify(!!options.disableTelemetry),
          __ENABLE_TANSTACK_DEVTOOLS__: JSON.stringify(enableTanstackDevtools),
          __CAMOX_ENABLE_EXPERIMENTAL_FEATURES__: JSON.stringify(
            options._internal?.enableExperimentalFeatures ?? false,
          ),
          // Anything but a release works in the developer's development draft (ADR 0006).
          __CAMOX_DEVELOPMENT_DRAFT__: JSON.stringify(!isRelease),
          __CAMOX_API_URL__: JSON.stringify(apiUrl),
          __CAMOX_AUTHENTICATION_URL__: JSON.stringify(authenticationUrl),
          __CAMOX_PROJECT_ID__: JSON.stringify(projectUuid),
        },
        environments: {
          client: {
            build: {
              rollupOptions: {
                onLog: withoutExpectedCamoxLogs(findClientOnLog(_config)),
                input: {
                  "camox-page-client": VIRTUAL_PAGE_CLIENT,
                  "camox-studio-client": VIRTUAL_STUDIO_CLIENT,
                },
                output: {
                  assetFileNames: "assets/[name]-[hash][extname]",
                  chunkFileNames: "_chunks/[name]-[hash].mjs",
                  entryFileNames: "_chunks/[name].mjs",
                },
              },
            },
          },
        },
        resolve: {
          // `react-remove-scroll` (transitive dep of @base-ui/react and radix dialog)
          // imports tslib for `__assign`, `__rest`, etc. Tslib's `exports.default` is
          // its UMD factory (`./tslib.js`), which rolldown's CJS-side resolver picks
          // when bundling for SSR — but the factory writes onto `module.exports`
          // directly with no `default` property. Rolldown's `__toESM` interop then
          // produces an undefined `.default`, and destructuring `__extends` off it
          // throws at SSR startup. Force-resolve `tslib` to its clean ESM build.
          alias: [{ find: /^tslib$/, replacement: "tslib/tslib.es6.mjs" }],
        },
        optimizeDeps: {
          include: CAMOX_OPTIMIZED_DEPS,
          // This linked workspace package changes as the Studio/API contract evolves.
          // Pre-bundling it freezes exports until Vite is restarted, crashing the editor
          // when new queries are added during development.
          exclude: ["@camox/api-contract", "@camox/api-contract/query-keys"],
        },
      };
    },
    configEnvironment(name, config) {
      if (name === "client") return;
      const build = config.build;
      return {
        optimizeDeps: {
          // The app's own dependencies, found in its source.
          entries: ["src/**/*.{ts,tsx}"],
          include: CAMOX_WORKER_OPTIMIZED_DEPS,
          // Camox's modules import its virtual modules, which only the dev server resolves.
          exclude: ["camox"],
        },
        build: {
          rollupOptions: {
            onLog: withoutExpectedCamoxLogs(
              build?.rolldownOptions?.onLog ?? build?.rollupOptions?.onLog,
            ),
          },
        },
      };
    },
    configResolved(config) {
      resolvedConfig = config;
      if (!config.plugins.some((plugin) => plugin.name.startsWith("vite-plugin-cloudflare"))) {
        throw new Error(
          "Camox: Camox apps run on Cloudflare Workers. Add `cloudflare()` from " +
            "`@cloudflare/vite-plugin` to your Vite plugins, and point `main` in " +
            "`wrangler.jsonc` at `camox/worker`.",
        );
      }
      const routesDir = resolve(config.root, "src/routes");

      writeRuntimeSidecar(config.root, {
        projectId: projectUuid,
        apiUrl,
        authenticationUrl,
        disableTelemetry: !!options.disableTelemetry,
      });

      if (!disableCodeGen) {
        generateLayoutFiles(config.root);
        cleanupGeneratedRouteFiles(routesDir);
      }

      if (disableCodeGen) {
        config.logger.warn(
          "⚠️  Code generation is disabled (_internal.disableCodeGen). " +
            "This option is only meant for momentary debugging — " +
            "do not deploy or commit your app with it enabled.",
          { timestamp: true },
        );
      }

      const mode = config.command === "serve" ? "Running" : "Building";
      let target = "your development draft";
      if (isDryRun) target = "Live, dry run";
      else if (isRelease) target = "Live";
      else if (!localAuth) target = "authentication required";
      config.logger.info(`${mode} Camox app (${target})`, { timestamp: true });
    },

    configureServer(server: ViteDevServer) {
      devServer = server;
      const routesDir = resolve(server.config.root, "src/routes");

      installDevAuthenticationMiddleware(server, {
        apiUrl,
        authenticationUrl,
        isAuthenticated: localAuth !== null,
      });

      if (localAuth?.email) {
        installDevSignInLink(server, {
          projectUuid,
          apiUrl,
          authToken: localAuth.token,
          open: options._internal?.devSignIn?.open,
          openOnceFile: options._internal?.devSignIn?.openOnceFile,
        });
      }

      if (!disableCodeGen) {
        watchLayoutFiles(server, server.config.root);
        cleanupGeneratedRouteFiles(routesDir);

        watchNewBlockFiles(server);
      }

      server.httpServer?.once("listening", () => {
        if (!localAuth) return;
        const authToken = localAuth.token;
        void syncDefinitions(server, {
          projectUuid,
          apiUrl,
          autoCreate: true,
          authToken,
          releaseToEmptyLive: options._internal?.seedLiveDeployToken,
        }).then(async ({ synced, releasedToLive }) => {
          if (!synced) return;
          const context = {
            client: createServerApiClient(apiUrl, authToken, DEVELOPMENT_DRAFT),
            projectUuid,
            logger: server.config.logger,
          };
          const afterSync = options._internal?.afterSync;
          if (afterSync) {
            try {
              await afterSync(context);
            } catch (error) {
              context.logger.warn(`[camox] afterSync failed: ${String(error)}`, {
                timestamp: true,
              });
            }
          }
          if (releasedToLive) await publishSeededContent(context);
        });
      });
    },

    async closeBundle() {
      if (!isRelease || isDryRun) return;

      const deployToken = process.env.CAMOX_DEPLOY_TOKEN;
      if (!deployToken) {
        throw new Error("Camox: CAMOX_DEPLOY_TOKEN is required to release to production.");
      }

      const tempServer = await createServer({
        configFile: false,
        root: resolvedConfig.root,
        // Use a separate optimizer cache for this short-lived server so it
        // cannot invalidate the app server's node_modules/.vite/deps cache.
        cacheDir: resolve(resolvedConfig.root, "node_modules", ".vite-camox-temp"),
        resolve: resolvedConfig.resolve,
        define: resolvedConfig.define,
        // Created without the app's config file, so it needs Camox's registry to resolve the
        // virtual app module.
        plugins: [createRuntimeRegistryPlugin({ runtimeBasePath })],
        server: { middlewareMode: true },
        logLevel: "silent",
      });

      try {
        const camoxModule = (await tempServer.ssrLoadModule(VIRTUAL_CAMOX_APP)) as {
          camoxApp: import("@/core/createApp").CamoxApp;
        };

        await syncDefinitionsToApi({
          definitionSet: await camoxModule.camoxApp.getDefinitionSet(),
          projectUuid,
          apiUrl,
          autoCreate: false,
          deployToken,
          logger: resolvedConfig.logger,
        });
      } finally {
        await tempServer.close();
      }
    },
  };
}
