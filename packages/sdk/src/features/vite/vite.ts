import type { Plugin, ViteDevServer } from "vite";
import { watchNewBlockFiles } from "./blockBoilerplate";
import {
  syncBlockDefinitions,
  type BlockDefinitionsSyncOptions,
} from "./blockDefinitionsSync";
import { startConvexDev, stopConvexDev } from "./convexSync";

export interface CamoxPluginOptions {
  /** Convex deploy key for non-interactive authentication (required) */
  convexDeployKey: string;
  /** Disable the generation of boilerplate code when creating a blank file in the blocks directory (default: false) */
  disableBlockBoilerplateGeneration?: boolean;
  /** Disable automatic block definitions sync on server start (default: false) */
  disableBlockDefinitionsSync?: boolean;
  /** Options for block definitions sync */
  blockDefinitionsSync?: BlockDefinitionsSyncOptions;
}

export function camox(options: CamoxPluginOptions): Plugin {
  return {
    name: "camox",
    configResolved(config) {
      const message =
        config.command === "serve"
          ? `Running Camox app (NODE_ENV: ${process.env.NODE_ENV})`
          : `Building Camox app (NODE_ENV: ${process.env.NODE_ENV})`;
      config.logger.info(message, { timestamp: true });
    },

    configureServer(server: ViteDevServer) {
      if (!options.disableBlockBoilerplateGeneration) {
        watchNewBlockFiles(server);
      }

      startConvexDev({
        server,
        deployKey: options.convexDeployKey,
      });

      if (!options.disableBlockDefinitionsSync) {
        // Sync after the server is ready to ensure modules can be loaded
        server.httpServer?.once("listening", () => {
          syncBlockDefinitions(server, options.blockDefinitionsSync);
        });
      }
    },

    buildEnd() {
      stopConvexDev();
    },
  };
}
