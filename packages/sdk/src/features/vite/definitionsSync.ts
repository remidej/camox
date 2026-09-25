import path from "node:path";

import { type Logger, type ViteDevServer, createServer, isRunnableDevEnvironment } from "vite-plus";

import type { CamoxApp } from "@/core/createApp";
import type { Block } from "@/core/createBlock";

import { createServerApiClient } from "../../lib/api-client-server";

const SYNC_DEBOUNCE_DELAY_MS = 100;

interface SyncDefinitionsOptions {
  projectSlug: string;
  apiUrl: string;
  environmentName: string;
  autoCreate: boolean;
  authToken?: string;
  deployToken?: string;
}

/**
 * Sync block and layout definitions to the API.
 * This is the core sync logic, independent of ViteDevServer.
 */
function throwIfSyncAuthError(error: unknown): void {
  if (
    error instanceof Error &&
    error.name === "ORPCError" &&
    error.message.toLowerCase().includes("unauthorized")
  ) {
    throw new Error("[camox] Definition sync failed: invalid or missing credentials.");
  }
}

function isNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === "ORPCError" &&
    error.message.toLowerCase().includes("not found")
  );
}

function throwUnknownEnvironmentError(environmentName: string): never {
  throw new Error(
    `[camox] Environment "${environmentName}" does not exist. ` +
      `Run the dev server while authenticated to create your personal environment first.`,
  );
}

export async function syncDefinitionsToApi(options: {
  camoxApp: CamoxApp;
  projectSlug: string;
  apiUrl: string;
  environmentName: string;
  autoCreate: boolean;
  authToken?: string;
  deployToken?: string;
  logger: Logger;
}): Promise<void> {
  const {
    camoxApp,
    projectSlug,
    apiUrl,
    environmentName,
    autoCreate,
    authToken,
    deployToken,
    logger,
  } = options;
  const client = createServerApiClient(apiUrl, environmentName, authToken);

  const blocks = camoxApp.getBlocks();
  const layoutDefinitions = camoxApp.getSerializableLayoutDefinitions();

  const typesUsedInLayouts = new Set<string>();
  for (const layout of layoutDefinitions) {
    for (const blockDef of layout.blocks) {
      typesUsedInLayouts.add(blockDef.type);
    }
  }

  // layoutOnly blocks are only meaningful when a layout references them —
  // sync their definitions only in that case. Otherwise the DB accumulates
  // dead rows for blocks the UI can never instantiate.
  const definitions = blocks
    .filter(
      (block: Block) => !block._internal.layoutOnly || typesUsedInLayouts.has(block._internal.id),
    )
    .map((block: Block) => ({
      blockId: block._internal.id,
      title: block._internal.title,
      description: block._internal.description,
      contentSchema: block._internal.contentSchema,
      settingsSchema: block._internal.settingsSchema,
      defaultContent: block._internal.getInitialContent(),
      defaultSettings: block._internal.getInitialSettings(),
      layoutOnly: block._internal.layoutOnly || undefined,
      synced: block._internal.synced,
    }));

  let environmentCreated = false;
  let deletedDefinitionTypes: string[] = [];
  let blockedDefinitionDeletions: Array<{ blockId: string; blockCount: number }> = [];
  try {
    const result = await client.blockDefinitions.sync({
      projectSlug,
      deployToken,
      autoCreate,
      definitions,
    });
    environmentCreated = result.environmentCreated;
    deletedDefinitionTypes = result.deletedDefinitionTypes;
    blockedDefinitionDeletions = result.blockedDefinitionDeletions;
  } catch (error) {
    throwIfSyncAuthError(error);
    if (!autoCreate && isNotFoundError(error)) throwUnknownEnvironmentError(environmentName);
    throw error;
  }

  if (environmentCreated) {
    logger.info(`[camox] Created empty environment "${environmentName}"`, { timestamp: true });
  }

  logger.info(
    `[camox] Synced ${definitions.length} block definition${definitions.length === 1 ? "" : "s"}`,
    { timestamp: true },
  );

  if (deletedDefinitionTypes.length > 0) {
    const blockList = deletedDefinitionTypes.map((t) => `"${t}"`).join(", ");
    logger.info(
      `[camox] Removed ${deletedDefinitionTypes.length} orphaned block definition${deletedDefinitionTypes.length === 1 ? "" : "s"} (no longer in code): ${blockList}`,
      { timestamp: true },
    );
  }
  for (const blocked of blockedDefinitionDeletions) {
    logger.warn(
      `[camox] Cannot delete block definition "${blocked.blockId}": still used by ${blocked.blockCount} block${blocked.blockCount === 1 ? "" : "s"}. Delete those blocks first.`,
      { timestamp: true },
    );
  }

  const collectionResult = await client.collectionDefinitions.sync({
    projectSlug,
    deployToken,
    autoCreate,
    definitions: camoxApp.getSerializableCollectionDefinitions(),
  });
  logger.info(`[camox] Synced ${collectionResult.count} collection definitions`, {
    timestamp: true,
  });
  for (const id of collectionResult.retired) {
    logger.warn(`[camox] Retired collection "${id}"; records and history are preserved`, {
      timestamp: true,
    });
  }

  // Sync layouts
  if (layoutDefinitions.length > 0) {
    let layoutSyncResults;
    try {
      layoutSyncResults = await client.layouts.sync({
        projectSlug,
        deployToken,
        autoCreate,
        layouts: layoutDefinitions,
      });
    } catch (error) {
      throwIfSyncAuthError(error);
      if (!autoCreate && isNotFoundError(error)) throwUnknownEnvironmentError(environmentName);
      throw error;
    }
    logger.info(
      `[camox] Synced ${layoutDefinitions.length} layout${layoutDefinitions.length === 1 ? "" : "s"} to Camox API`,
      { timestamp: true },
    );
    for (const result of layoutSyncResults.layouts) {
      if (result.wasExisting && result.createdBlockTypes.length > 0) {
        const blockList = result.createdBlockTypes.map((t) => `"${t}"`).join(", ");
        logger.info(
          `[camox] Added ${result.createdBlockTypes.length} block${result.createdBlockTypes.length === 1 ? "" : "s"} to existing layout "${result.layout.layoutId}": ${blockList}`,
          { timestamp: true },
        );
      }
      if (result.removedBlockTypes.length > 0) {
        const blockList = result.removedBlockTypes.map((t) => `"${t}"`).join(", ");
        logger.info(
          `[camox] Removed ${result.removedBlockTypes.length} layoutOnly block${result.removedBlockTypes.length === 1 ? "" : "s"} from layout "${result.layout.layoutId}": ${blockList}`,
          { timestamp: true },
        );
      }
      if (result.skippedOrphanTypes.length > 0) {
        const blockList = result.skippedOrphanTypes.map((t) => `"${t}"`).join(", ");
        logger.info(
          `[camox] Layout "${result.layout.layoutId}" has ${result.skippedOrphanTypes.length} block${result.skippedOrphanTypes.length === 1 ? "" : "s"} still in DB but removed from code: ${blockList} (kept because not layoutOnly)`,
          { timestamp: true },
        );
      }
    }
    for (const layoutId of layoutSyncResults.deletedLayoutIds) {
      logger.info(`[camox] Deleted layout "${layoutId}"`, { timestamp: true });
    }
    for (const blocked of layoutSyncResults.blockedLayoutDeletions) {
      logger.warn(
        `[camox] Cannot delete layout "${blocked.layoutId}": still used by ${blocked.pageCount} page${blocked.pageCount === 1 ? "" : "s"}. Reassign or delete those pages first.`,
        { timestamp: true },
      );
    }
    if (layoutSyncResults.deletedDefinitionTypes.length > 0) {
      const blockList = layoutSyncResults.deletedDefinitionTypes.map((t) => `"${t}"`).join(", ");
      logger.info(
        `[camox] Removed ${layoutSyncResults.deletedDefinitionTypes.length} layoutOnly block definition${layoutSyncResults.deletedDefinitionTypes.length === 1 ? "" : "s"} (no layout uses ${layoutSyncResults.deletedDefinitionTypes.length === 1 ? "it" : "them"} anymore): ${blockList}`,
        { timestamp: true },
      );
    }
  }

  // Initialize content for fresh environments (no-ops if pages already exist)
  const initialPage = camoxApp.getInitialPageBundles();
  if (initialPage) {
    try {
      const result = await client.projects.initializeContent({
        projectSlug,
        deployToken,
        layoutId: initialPage.layoutId,
        blocks: initialPage.blocks,
      });
      if (result.created) {
        if (initialPage.hasInitialBlocks) {
          logger.info(
            `[camox] Initialized content: homepage with ${result.blockCount} block${result.blockCount === 1 ? "" : "s"}`,
            { timestamp: true },
          );
        } else {
          logger.info("[camox] Created empty homepage (using first layout)", { timestamp: true });
          logger.info(
            "[camox] Tip: add blocks.initial to your layout to pre-populate pages with content",
            { timestamp: true },
          );
        }
      }
    } catch (error) {
      throwIfSyncAuthError(error);
      throw error;
    }
  }
}

function getBlockIdFromFilePath(filePath: string): string {
  const fileName = path.basename(filePath, path.extname(filePath));
  return fileName;
}

const CAMOX_APP_PATH = "./src/camox/app.ts";

/**
 * Load a module using SSR. Uses the server's SSR environment runner if available,
 * otherwise falls back to a temporary Vite server (needed when Nitro or other
 * frameworks configure the SSR environment as non-runnable).
 */
async function ssrLoadModule(
  server: ViteDevServer,
  modulePath: string,
): Promise<Record<string, unknown>> {
  const ssrEnv = server.environments.ssr;
  if (ssrEnv && isRunnableDevEnvironment(ssrEnv)) {
    return ssrEnv.runner.import(modulePath);
  }

  const tempServer = await createServer({
    configFile: false,
    root: server.config.root,
    // Keep the temporary SSR loader from sharing Vite's dep optimizer cache
    // with the active app server. Otherwise its empty client optimizer can
    // replace node_modules/.vite/deps during dev-server startup.
    cacheDir: path.join(server.config.root, "node_modules", ".vite-camox-temp"),
    resolve: server.config.resolve,
    server: { middlewareMode: true },
    logLevel: "silent",
  });

  try {
    return await tempServer.ssrLoadModule(modulePath);
  } finally {
    await tempServer.close();
  }
}

export async function syncDefinitions(
  server: ViteDevServer,
  options: SyncDefinitionsOptions,
): Promise<void> {
  const { projectSlug, apiUrl, environmentName, autoCreate, authToken, deployToken } = options;
  const blocksDirs = [
    path.resolve(server.config.root, "src/blocks"),
    path.resolve(server.config.root, "src/camox/blocks"),
  ];
  const layoutsDirs = [
    path.resolve(server.config.root, "src/layouts"),
    path.resolve(server.config.root, "src/camox/layouts"),
  ];
  const client = createServerApiClient(apiUrl, environmentName, authToken);

  async function performInitialSync(): Promise<void> {
    // The SSR runner caches the resolved `camoxApp`. Without invalidation,
    // re-importing returns the stale object with pre-change layout/block
    // references, so layout reconciliation would be a no-op until the dev
    // server restarts. Invalidate the app module (which propagates up from
    // its glob-imported children) to force re-evaluation.
    const appModule = server.moduleGraph.getModuleById(
      path.resolve(server.config.root, CAMOX_APP_PATH),
    );
    if (appModule) {
      server.moduleGraph.invalidateModule(appModule);
    }

    const camoxModule = (await ssrLoadModule(server, CAMOX_APP_PATH)) as {
      camoxApp?: CamoxApp;
    };

    if (!camoxModule.camoxApp) {
      server.config.logger.warn(`[camox] No camoxApp export found in ${CAMOX_APP_PATH}`, {
        timestamp: true,
      });
      return;
    }

    await syncDefinitionsToApi({
      camoxApp: camoxModule.camoxApp,
      projectSlug,
      apiUrl,
      environmentName,
      autoCreate,
      authToken,
      deployToken,
      logger: server.config.logger,
    });
  }

  async function upsertBlock(filePath: string): Promise<void> {
    const relativePath = "./" + path.relative(server.config.root, filePath);

    // Invalidate module cache for this specific file
    const moduleNode = server.moduleGraph.getModuleById(relativePath);
    if (moduleNode) {
      server.moduleGraph.invalidateModule(moduleNode);
    }

    const blockModule = (await ssrLoadModule(server, relativePath)) as {
      block?: Block;
    };

    if (!blockModule.block) {
      server.config.logger.warn(`[camox] No block export found in ${relativePath}`, {
        timestamp: true,
      });
      return;
    }

    const block = blockModule.block;

    if (block._internal.layoutOnly) {
      // layoutOnly blocks only sync when a layout uses them
      return;
    }

    let result;
    try {
      result = await client.blockDefinitions.upsert({
        projectSlug,
        deployToken,
        blockId: block._internal.id,
        title: block._internal.title,
        description: block._internal.description,
        contentSchema: block._internal.contentSchema,
        settingsSchema: block._internal.settingsSchema,
        defaultContent: block._internal.getInitialContent(),
        defaultSettings: block._internal.getInitialSettings(),
        layoutOnly: block._internal.layoutOnly || undefined,
        synced: block._internal.synced,
      });
    } catch (error) {
      throwIfSyncAuthError(error);
      throw error;
    }

    server.config.logger.info(
      `[camox] ${result.action === "created" ? "Created" : "Updated"} block definition "${block._internal.id}"`,
      { timestamp: true },
    );
  }

  async function deleteBlock(filePath: string): Promise<void> {
    const blockId = getBlockIdFromFilePath(filePath);

    let result;
    try {
      result = await client.blockDefinitions.delete({
        projectSlug,
        deployToken,
        blockId,
      });
    } catch (error) {
      throwIfSyncAuthError(error);
      throw error;
    }

    if (result.deleted) {
      server.config.logger.info(`[camox] Deleted block definition "${blockId}"`, {
        timestamp: true,
      });
    }
  }

  // Initial sync from files to API
  try {
    await performInitialSync();
  } catch (error) {
    server.config.logger.error(`[camox] Failed to sync block definitions: ${String(error)}`, {
      timestamp: true,
    });
  }

  // Watch for changes in block files
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function isBlockFile(filePath: string): boolean {
    return (
      blocksDirs.some((blocksDir) => filePath.startsWith(blocksDir)) && /\.tsx?$/.test(filePath)
    );
  }

  function isLayoutFile(filePath: string): boolean {
    return (
      layoutsDirs.some((layoutsDir) => filePath.startsWith(layoutsDir)) && /\.tsx?$/.test(filePath)
    );
  }

  const handleBlockFileUpsert = (filePath: string) => {
    if (!isBlockFile(filePath)) return;

    const existingTimer = debounceTimers.get(filePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    debounceTimers.set(
      filePath,
      setTimeout(async () => {
        debounceTimers.delete(filePath);
        try {
          await upsertBlock(filePath);
        } catch (error) {
          server.config.logger.error(`[camox] Failed to sync block: ${String(error)}`, {
            timestamp: true,
          });
        }
      }, SYNC_DEBOUNCE_DELAY_MS),
    );
  };

  const handleBlockFileDelete = (filePath: string) => {
    if (!isBlockFile(filePath)) return;

    // Clear any pending upsert for this file
    const existingTimer = debounceTimers.get(filePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
      debounceTimers.delete(filePath);
    }

    setTimeout(async () => {
      try {
        await deleteBlock(filePath);
      } catch (error) {
        server.config.logger.error(`[camox] Failed to delete block: ${String(error)}`, {
          timestamp: true,
        });
      }
    }, SYNC_DEBOUNCE_DELAY_MS);
  };

  let layoutSyncTimer: ReturnType<typeof setTimeout> | null = null;
  const handleLayoutFileChange = (filePath: string) => {
    const isCollection = ["src/collections", "src/camox/collections"].some(
      (dir) =>
        filePath.startsWith(path.resolve(server.config.root, dir) + path.sep) &&
        /\.tsx?$/.test(filePath),
    );
    if (!isLayoutFile(filePath) && !isCollection) return;

    const moduleNode = server.moduleGraph.getModuleById(filePath);
    if (moduleNode) {
      server.moduleGraph.invalidateModule(moduleNode);
    }

    if (layoutSyncTimer) clearTimeout(layoutSyncTimer);
    layoutSyncTimer = setTimeout(async () => {
      layoutSyncTimer = null;
      try {
        await performInitialSync();
      } catch (error) {
        server.config.logger.error(`[camox] Failed to sync layouts: ${String(error)}`, {
          timestamp: true,
        });
      }
    }, SYNC_DEBOUNCE_DELAY_MS);
  };

  server.watcher.on("change", handleBlockFileUpsert);
  server.watcher.on("change", handleLayoutFileChange);
  server.watcher.on("add", handleBlockFileUpsert);
  server.watcher.on("add", handleLayoutFileChange);
  server.watcher.on("unlink", handleBlockFileDelete);
  server.watcher.on("unlink", handleLayoutFileChange);
}
