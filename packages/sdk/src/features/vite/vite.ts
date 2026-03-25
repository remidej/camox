import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Plugin, ViteDevServer } from "vite";

const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const VIRTUAL_STUDIO_CSS = "virtual:camox-studio-css";
const RESOLVED_VIRTUAL_STUDIO_CSS = "\0" + VIRTUAL_STUDIO_CSS;

import { generateAppFile, watchAppFile } from "./appGeneration";
import { watchNewBlockFiles } from "./blockBoilerplate";
import {
  LOCAL_CONVEX_URL,
  LOCAL_CONVEX_SITE_URL,
  startConvexDev,
  stopConvexDev,
} from "./convexSync";
import { syncDefinitions, type DefinitionsSyncOptions } from "./definitionsSync";
import { generateRouteFiles, watchRouteFiles } from "./routeGeneration";
import { generateSkillFiles, watchSkillFiles } from "./skillGeneration";

/** Default management backend URL (production Camox web app) */
const DEFAULT_MANAGEMENT_URL = "https://camox.ai";

export interface CamoxPluginOptions {
  /** Stable, human-readable slug identifying this project (e.g. "prestigious-impala-84") */
  projectSlug: string;
  /** Disable the generation of boilerplate code when creating a blank file in the blocks directory (default: false) */
  disableBlockBoilerplateGeneration?: boolean;
  /** Disable automatic definitions sync on server start (default: false) */
  disableDefinitionsSync?: boolean;
  /** Options for definitions sync */
  definitionsSync?: DefinitionsSyncOptions;
  /** URL of the Camox management web app, used for authentication redirects */
  managementUrl?: string;
  /** Disable PostHog analytics collection (default: false) */
  disableAnalytics?: boolean;
}

export function camox(options: CamoxPluginOptions): Plugin {
  const convexUrl = LOCAL_CONVEX_URL;
  const managementUrl = options.managementUrl ?? DEFAULT_MANAGEMENT_URL;
  let isBuild = false;

  return {
    name: "camox",
    resolveId(id) {
      if (id === VIRTUAL_STUDIO_CSS) return RESOLVED_VIRTUAL_STUDIO_CSS;
    },
    load(id) {
      if (id !== RESOLVED_VIRTUAL_STUDIO_CSS) return;
      const cssPath = resolve(sdkRoot, "dist/studio.css");
      if (isBuild) {
        const css = readFileSync(cssPath, "utf-8");
        const ref = this.emitFile({ type: "asset", name: "studio.css", source: css });
        return `export default import.meta.ROLLUP_FILE_URL_${ref};`;
      }
      // Dev: serve the file directly via Vite's /@fs/ prefix
      return `export default "/@fs/${cssPath}";`;
    },
    config(_config, env) {
      isBuild = env.command === "build";
      return {
        define: {
          ...(env.command === "serve" && {
            "import.meta.env.VITE_CONVEX_URL": JSON.stringify(convexUrl),
            "import.meta.env.VITE_CONVEX_SITE_URL": JSON.stringify(LOCAL_CONVEX_SITE_URL),
          }),
          __CAMOX_ANALYTICS_DISABLED__: JSON.stringify(!!options.disableAnalytics),
        },
      };
    },
    configResolved(config) {
      const routesDir = resolve(config.root, "src/routes");
      generateAppFile(config.root);
      generateRouteFiles(routesDir, convexUrl, managementUrl);
      generateSkillFiles(config.root);

      const message =
        config.command === "serve"
          ? `Running Camox app (NODE_ENV: ${process.env.NODE_ENV})`
          : `Building Camox app (NODE_ENV: ${process.env.NODE_ENV})`;
      config.logger.info(message, { timestamp: true });
    },

    configureServer(server: ViteDevServer) {
      const routesDir = resolve(server.config.root, "src/routes");
      watchAppFile(server, server.config.root);
      watchRouteFiles(server, routesDir, convexUrl, managementUrl);
      watchSkillFiles(server, server.config.root);

      if (!options.disableBlockBoilerplateGeneration) {
        watchNewBlockFiles(server);
      }

      // Start local Convex backend, then sync definitions once it's ready
      server.httpServer?.once("listening", async () => {
        await startConvexDev(server);

        // TODO: Set environment variables on the local deployment via
        // POST http://127.0.0.1:3210/update_environment_variables
        // so users don't have to manually run `npx convex env set` before the push succeeds.

        if (!options.disableDefinitionsSync) {
          syncDefinitions(server, {
            ...options.definitionsSync,
            projectSlug: options.projectSlug,
            convexUrl,
          });
        }
      });
    },

    buildEnd() {
      stopConvexDev();
    },
  };
}
