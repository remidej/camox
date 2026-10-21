import path from "node:path";

import { DEVELOPMENT_DRAFT } from "@camox/api-contract/drafts";
import { type Logger, type ViteDevServer, isRunnableDevEnvironment } from "vite-plus";

import type { CamoxApp } from "@/core/createApp";
import type { Block } from "@/core/createBlock";

import { createServerApiClient } from "../../lib/api-client-server";

const SYNC_DEBOUNCE_DELAY_MS = 100;

interface SyncDefinitionsOptions {
  projectSlug: string;
  apiUrl: string;
  autoCreate: boolean;
  authToken?: string;
  deployToken?: string;
  /**
   * A deploy token that releases the local definitions to Live before the first sync, when Live
   * has no pages yet, so content seeded in dev can be published over it.
   */
  releaseToEmptyLive?: string;
}

/**
 * The client definitions sync with. A release (deploy token) syncs Live's definitions; dev mode
 * sends the developer's session and syncs their development draft, which its first sync
 * creates (ADR 0006).
 */
function createSyncClient(options: { apiUrl: string; authToken?: string; deployToken?: string }) {
  const draftId = options.deployToken ? undefined : DEVELOPMENT_DRAFT;
  return createServerApiClient(options.apiUrl, options.authToken, draftId);
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

/**
 * A sync that may not create the development draft finds nothing to write to: a release names a
 * project that doesn't exist, or dev mode has no development draft yet (ADR 0006).
 */
function throwSyncTargetNotFoundError(projectSlug: string, deployToken?: string): never {
  if (deployToken) {
    throw new Error(
      `[camox] Project "${projectSlug}" does not exist. Check the camox() projectSlug.`,
    );
  }
  throw new Error(
    `[camox] You have no development draft in project "${projectSlug}" yet. ` +
      `Run the dev server while authenticated to create it first.`,
  );
}

export async function syncDefinitionsToApi(options: {
  camoxApp: Pick<CamoxApp, "getDefinitionSet">;
  projectSlug: string;
  apiUrl: string;
  autoCreate: boolean;
  authToken?: string;
  deployToken?: string;
  logger: Logger;
}): Promise<void> {
  const { camoxApp, projectSlug, autoCreate, deployToken, logger } = options;
  const client = createSyncClient(options);

  const {
    blocks: definitions,
    layouts: layoutDefinitions,
    collections: collectionDefinitions,
    homepage: initialPage,
  } = await camoxApp.getDefinitionSet();

  let draftCreated = false;
  let deletedDefinitionTypes: string[] = [];
  try {
    const result = await client.blockDefinitions.sync({
      projectSlug,
      deployToken,
      autoCreate,
      definitions,
    });
    draftCreated = result.draftCreated;
    deletedDefinitionTypes = result.deletedDefinitionTypes;
  } catch (error) {
    throwIfSyncAuthError(error);
    if (!autoCreate && isNotFoundError(error))
      throwSyncTargetNotFoundError(projectSlug, deployToken);
    throw error;
  }

  if (draftCreated) {
    logger.info("[camox] Created your development draft", { timestamp: true });
  }

  logger.info(
    `[camox] Synced ${definitions.length} block definition${definitions.length === 1 ? "" : "s"}`,
    { timestamp: true },
  );

  if (deletedDefinitionTypes.length > 0) {
    const blockList = deletedDefinitionTypes.map((t) => `"${t}"`).join(", ");
    logger.info(
      `[camox] Removed ${deletedDefinitionTypes.length} block definition${deletedDefinitionTypes.length === 1 ? "" : "s"} no longer in code: ${blockList}. Their blocks are kept and render nothing until the definition comes back.`,
      { timestamp: true },
    );
  }

  const collectionResult = await client.collectionDefinitions.sync({
    projectSlug,
    deployToken,
    autoCreate,
    definitions: collectionDefinitions,
  });
  logger.info(`[camox] Synced ${collectionResult.count} collection definitions`, {
    timestamp: true,
  });
  for (const id of collectionResult.retired) {
    logger.warn(`[camox] Removed collection "${id}"; its records are kept and hidden`, {
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
      if (!autoCreate && isNotFoundError(error))
        throwSyncTargetNotFoundError(projectSlug, deployToken);
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
    for (const layoutId of layoutSyncResults.removedLayoutIds) {
      logger.info(
        `[camox] Removed layout "${layoutId}"; its pages are kept and listed as needing a layout`,
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

  // Initialize content for a fresh project or draft (no-ops if pages already exist)
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

export const VIRTUAL_CAMOX_APP = "virtual:camox/app";

/**
 * The dev server's Node `ssr` environment, which runs alongside the Worker's own environment:
 * the Cloudflare plugin runs the Worker in workerd, where the dev server can't import modules.
 */
function getNodeEnvironment(server: ViteDevServer) {
  const ssrEnv = server.environments.ssr;
  if (!ssrEnv || !isRunnableDevEnvironment(ssrEnv)) {
    throw new Error("[camox] The dev server has no Node ssr environment to load the app in.");
  }
  return ssrEnv;
}

/** Load a module in the dev server's Node `ssr` environment. */
async function ssrLoadModule(
  server: ViteDevServer,
  modulePath: string,
): Promise<Record<string, unknown>> {
  return getNodeEnvironment(server).runner.import(modulePath);
}

/** Whether a project's Live has no pages, as on a fresh database. */
async function liveHasNoPages(apiUrl: string, projectSlug: string): Promise<boolean> {
  const { pages } = await createServerApiClient(apiUrl).pages.listBySlug({ projectSlug });
  return pages.length === 0;
}

/**
 * Resolves once the initial sync settles: `synced` if definitions reached the API, and
 * `releasedToLive` if it first released them to an empty Live (`releaseToEmptyLive`).
 */
export async function syncDefinitions(
  server: ViteDevServer,
  options: SyncDefinitionsOptions,
): Promise<{ synced: boolean; releasedToLive: boolean }> {
  const { projectSlug, apiUrl, autoCreate, authToken, deployToken, releaseToEmptyLive } = options;
  const client = createSyncClient(options);
  const blocksDirs = [
    path.resolve(server.config.root, "src/blocks"),
    path.resolve(server.config.root, "src/camox/blocks"),
  ];
  const layoutsDirs = [
    path.resolve(server.config.root, "src/layouts"),
    path.resolve(server.config.root, "src/camox/layouts"),
  ];

  let releasedToLive = false;

  async function performInitialSync({ initial = false } = {}): Promise<void> {
    // The SSR runner caches the resolved `camoxApp`. Without invalidation,
    // re-importing returns the stale object with pre-change layout/block
    // references, so layout reconciliation would be a no-op until the dev
    // server restarts. Invalidate the app module (which propagates up from
    // its glob-imported children) to force re-evaluation.
    const nodeEnvironment = getNodeEnvironment(server);
    const appModule = nodeEnvironment.moduleGraph.getModuleById("\0" + VIRTUAL_CAMOX_APP);
    if (appModule) {
      nodeEnvironment.moduleGraph.invalidateModule(appModule);
    }

    const camoxModule = (await ssrLoadModule(server, VIRTUAL_CAMOX_APP)) as {
      camoxApp: CamoxApp;
    };

    // Release before the dev sync: the development draft then sees Live's layout blocks and
    // homepage, instead of seeding its own copies that publishing would duplicate.
    if (initial && releaseToEmptyLive && (await liveHasNoPages(apiUrl, projectSlug))) {
      server.config.logger.info("[camox] Live is empty: releasing your definitions to it", {
        timestamp: true,
      });
      await syncDefinitionsToApi({
        camoxApp: camoxModule.camoxApp,
        projectSlug,
        apiUrl,
        autoCreate: false,
        deployToken: releaseToEmptyLive,
        logger: server.config.logger,
      });
      releasedToLive = true;
    }

    await syncDefinitionsToApi({
      camoxApp: camoxModule.camoxApp,
      projectSlug,
      apiUrl,
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
  let synced = false;
  try {
    await performInitialSync({ initial: true });
    synced = true;
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
  return { synced, releasedToLive };
}
