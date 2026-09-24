import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { type Plugin, type ResolvedConfig, type ViteDevServer, createServer } from "vite-plus";

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
import { generateAppFile, watchAppFile } from "./appGeneration";
import { readAuthTokenForUrl } from "./auth";
import { watchNewBlockFiles } from "./blockBoilerplate";
import { installDevAuthenticationMiddleware } from "./devAuthentication";
import { generateIconTypes } from "./iconGeneration";

const PRODUCTION_API_URL = "https://api.camox.dev";
import { syncDefinitions, syncDefinitionsToApi } from "./definitionsSync";
import { cleanupGeneratedRouteFiles } from "./routeGeneration";
import { installRuntimeNitroRoutes, loadRuntimeDevModule, resolveRuntimeDevId } from "./runtimeDev";

/** Authentication URL to use for Camox authentication (production Camox Dashboard) */
const DEFAULT_AUTHENTICATION_URL = "https://app.camox.dev";

interface CamoxNitro {
  hooks: {
    hook: (name: "compiled", callback: (nitro: CamoxNitro) => void) => void;
  };
  options: {
    noExternals?: boolean | (string | RegExp)[];
    output: {
      publicDir: string;
      serverDir: string;
    };
    routes: Record<string, string>;
    virtual: Record<string, string>;
  };
}

type CamoxVitePlugin = Plugin & {
  nitro?: {
    setup: (nitro: CamoxNitro) => void;
  };
};

type StoredAuth = NonNullable<ReturnType<typeof readAuthTokenForUrl>>;

/**
 * Drop a sidecar at `<root>/node_modules/.camox/runtime.json` so the `camox`
 * CLI can pick up the same projectSlug / apiUrl / authenticationUrl the
 * plugin actually used. The CLI treats the vite config as the source of
 * truth for those values — there is no other reliable way to recover them
 * from outside vite. The environment is *not* written here: the CLI derives
 * `dev:<email>` from auth at call time and requires `--production` for prod,
 * so a stale build sidecar can't silently route writes to production.
 */
function writeRuntimeSidecar(
  root: string,
  data: {
    projectSlug: string;
    apiUrl: string;
    authenticationUrl: string;
    disableTelemetry: boolean;
  },
): void {
  const dir = join(root, "node_modules", ".camox");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "runtime.json"), `${JSON.stringify(data, null, 2)}\n`);
}

export interface CamoxPluginOptions {
  /** Stable, human-readable slug identifying this project (e.g. "prestigious-impala-84") */
  projectSlug: string;
  /** Iconify collection available to all icon fields. */
  icons?: string;
  /** Disable telemetry collection (default: false) */
  disableTelemetry?: boolean;
  /** Internal options (intended for Camox contributors in development, not for public use) */
  _internal?: {
    /** URL of the Camox API backend, used for data fetching */
    apiUrl?: string;
    /** URL of the Camox authentication backend (default: https://app.camox.dev) */
    authenticationUrl?: string;
    /** Show Tanstack query devtools (default: false) */
    enableTanstackDevtools?: boolean;
    /** Enable experimental features, including feedback (default: false). */
    enableExperimentalFeatures?: boolean;
    /** Disable automatic code generation (route files and app file) (default: false) */
    disableCodeGen?: boolean;
    /** Mount the Camox-owned dev runtime at this base path. Use "/" for root mode. */
    runtimeBasePath?: string;
  };
}

export function camox(options: CamoxPluginOptions): CamoxVitePlugin {
  const apiUrl = options._internal?.apiUrl ?? PRODUCTION_API_URL;
  const authenticationUrl = options._internal?.authenticationUrl ?? DEFAULT_AUTHENTICATION_URL;
  const enableTanstackDevtools = options._internal?.enableTanstackDevtools ?? false;
  const disableCodeGen = options._internal?.disableCodeGen ?? false;
  const runtimeBasePath = options._internal?.runtimeBasePath;

  let isBuild = false;
  let isRelease = false;
  let resolvedConfig: ResolvedConfig;
  let environmentName: string;
  let localAuth: StoredAuth | null = null;

  return {
    name: "camox",
    enforce: "pre",
    resolveId(id, importer) {
      const runtimeId = resolveRuntimeDevId(id, importer);
      if (runtimeId) return runtimeId;
      if (id === VIRTUAL_STUDIO_CSS) return RESOLVED_VIRTUAL_STUDIO_CSS;
      if (id === VIRTUAL_OVERLAY_CSS) return RESOLVED_VIRTUAL_OVERLAY_CSS;
    },
    load(id) {
      // Local CSS watchers must not share the directory cleaned by package builds.
      const stylesDir = resolve(sdkRoot, !isBuild && isSdkSource ? ".dev" : "dist");
      if (id === RESOLVED_VIRTUAL_STUDIO_CSS) {
        const cssPath = resolve(stylesDir, "studio.css");
        if (isBuild) {
          const css = readFileSync(cssPath, "utf-8");
          const dataUrl = `data:text/css;base64,${Buffer.from(css).toString("base64")}`;
          return `export default ${JSON.stringify(dataUrl)};`;
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
      return loadRuntimeDevModule(id, { runtimeBasePath });
    },
    nitro: {
      setup(nitro) {
        // The runtime imports virtual modules that must pass through the Camox plugin.
        if (nitro.options.noExternals !== true) {
          const noExternals = Array.isArray(nitro.options.noExternals)
            ? nitro.options.noExternals
            : [];
          // Bundle tslib as well: tracing only its aliased ESM entry leaves a
          // partial package whose Node exports point to missing modules/index.js.
          nitro.options.noExternals = [...noExternals, "camox", "tslib"];
        }
        installRuntimeNitroRoutes(nitro, { runtimeBasePath });
        nitro.hooks.hook("compiled", ({ options }) => {
          const serverAssets = join(options.output.serverDir, "assets");
          if (!existsSync(serverAssets)) return;
          cpSync(serverAssets, join(options.output.publicDir, "assets"), { recursive: true });
        });
      },
    },
    async config(_config, env) {
      const iconIds = await generateIconTypes(
        resolve(_config.root ?? process.cwd()),
        options.icons,
      );
      isBuild = env.command === "build";
      isRelease = isBuild && process.env.CAMOX_INTERNAL_RELEASE === "1";
      if (isRelease) {
        environmentName = "production";
      } else {
        localAuth = readAuthTokenForUrl(authenticationUrl);
        if (isBuild && !localAuth) {
          throw new Error(
            "Camox: not authenticated. Run `npx camox login` before building the site.",
          );
        }
        environmentName = localAuth ? `dev:${localAuth.email}` : "dev:unauthenticated";
      }
      return {
        build: {
          emitAssets: true,
        },
        define: {
          __CAMOX_ICON_IDS__: JSON.stringify(iconIds),
          __CAMOX_TELEMETRY_DISABLED__: JSON.stringify(!!options.disableTelemetry),
          __ENABLE_TANSTACK_DEVTOOLS__: JSON.stringify(enableTanstackDevtools),
          __CAMOX_ENABLE_EXPERIMENTAL_FEATURES__: JSON.stringify(
            options._internal?.enableExperimentalFeatures ?? false,
          ),
          __CAMOX_ENVIRONMENT_NAME__: JSON.stringify(environmentName),
          __CAMOX_API_URL__: JSON.stringify(apiUrl),
          __CAMOX_AUTHENTICATION_URL__: JSON.stringify(authenticationUrl),
          __CAMOX_PROJECT_SLUG__: JSON.stringify(options.projectSlug),
        },
        environments: {
          client: {
            build: {
              rollupOptions: {
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
          // The Studio UI loads dynamically at runtime, so Vite's scanner can't see every
          // dependency before startup. Include the runtime discoveries up front to avoid
          // re-optimization reloads and 504 "Outdated Optimize Dep" responses.
          // Entries prefixed with `camox >` are SDK dependencies that may not be
          // resolvable as bare specifiers from the user app's root under pnpm.
          include: [
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
            "camox > @camox/api-contract",
            "camox > @camox/api-contract/query-keys",
            "camox > @camox/ui > cmdk",
            "camox > @camox/ui > lucide-react",
            "camox > @camox/ui > sonner",
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
            "camox > @xstate/store-react",
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
            "camox > @tanstack/react-query-devtools/production",
            "camox > partysocket/react",
          ],
        },
      };
    },
    configResolved(config) {
      resolvedConfig = config;
      const routesDir = resolve(config.root, "src/routes");

      writeRuntimeSidecar(config.root, {
        projectSlug: options.projectSlug,
        apiUrl,
        authenticationUrl,
        disableTelemetry: !!options.disableTelemetry,
      });

      if (!disableCodeGen) {
        generateAppFile(config.root);
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
      const environmentLabel = localAuth || isRelease ? environmentName : "authentication required";
      config.logger.info(`${mode} Camox app (${environmentLabel})`, { timestamp: true });
    },

    configureServer(server: ViteDevServer) {
      const routesDir = resolve(server.config.root, "src/routes");

      installDevAuthenticationMiddleware(server, {
        apiUrl,
        authenticationUrl,
        isAuthenticated: localAuth !== null,
      });

      if (!disableCodeGen) {
        watchAppFile(server, server.config.root);
        cleanupGeneratedRouteFiles(routesDir);

        watchNewBlockFiles(server);
      }

      server.httpServer?.once("listening", () => {
        if (!localAuth) return;
        void syncDefinitions(server, {
          projectSlug: options.projectSlug,
          apiUrl,
          environmentName,
          autoCreate: true,
          authToken: localAuth?.token,
        });
      });
    },

    async closeBundle() {
      if (!isRelease) return;

      const deployToken = process.env.CAMOX_DEPLOY_TOKEN;
      if (!deployToken) {
        throw new Error("Camox: CAMOX_DEPLOY_TOKEN is required to release to production.");
      }

      const camoxAppPath = "./src/camox/app.ts";

      const tempServer = await createServer({
        configFile: false,
        root: resolvedConfig.root,
        // Use a separate optimizer cache for this short-lived server so it
        // cannot invalidate the app server's node_modules/.vite/deps cache.
        cacheDir: resolve(resolvedConfig.root, "node_modules", ".vite-camox-temp"),
        resolve: resolvedConfig.resolve,
        define: resolvedConfig.define,
        server: { middlewareMode: true },
        logLevel: "silent",
      });

      try {
        const camoxModule = (await tempServer.ssrLoadModule(camoxAppPath)) as {
          camoxApp?: import("@/core/createApp").CamoxApp;
        };

        if (!camoxModule.camoxApp) {
          throw new Error(`No camoxApp export found in ${camoxAppPath}`);
        }

        await syncDefinitionsToApi({
          camoxApp: camoxModule.camoxApp,
          projectSlug: options.projectSlug,
          apiUrl,
          environmentName,
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
