import { DEVELOPMENT_DRAFT } from "@camox/api-contract/drafts";
import { type Logger, type ViteDevServer, isRunnableDevEnvironment } from "vite-plus";

import type { CamoxApp, DefinitionSet } from "@/core/createApp";

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

/**
 * Send a Definition Set to the API: Live's for a release, the development draft's in dev mode.
 * The only step that knows the API's sync endpoints.
 */
export async function syncDefinitionsToApi(options: {
  definitionSet: DefinitionSet;
  projectSlug: string;
  apiUrl: string;
  autoCreate: boolean;
  authToken?: string;
  deployToken?: string;
  logger: Logger;
}): Promise<void> {
  const { definitionSet, projectSlug, autoCreate, deployToken, logger } = options;
  const client = createSyncClient(options);

  const {
    blocks: definitions,
    layouts: layoutDefinitions,
    collections: collectionDefinitions,
    homepage: initialPage,
  } = definitionSet;

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

export const VIRTUAL_CAMOX_APP = "virtual:camox/app";
const RESOLVED_VIRTUAL_CAMOX_APP = "\0" + VIRTUAL_CAMOX_APP;

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

/**
 * The app's current Definition Set, evaluated afresh in the dev server's Node `ssr` environment.
 */
async function loadDefinitionSet(server: ViteDevServer): Promise<DefinitionSet> {
  const nodeEnvironment = getNodeEnvironment(server);
  // The runner caches evaluated modules, so re-importing would return the app built from the
  // modules as they were. Clear them so the app and everything it imports evaluate again, the
  // way Vite's own full reload of the runner does.
  const appModule = nodeEnvironment.moduleGraph.getModuleById(RESOLVED_VIRTUAL_CAMOX_APP);
  if (appModule) nodeEnvironment.moduleGraph.invalidateModule(appModule);
  nodeEnvironment.runner.evaluatedModules.clear();
  const { camoxApp } = (await nodeEnvironment.runner.import(VIRTUAL_CAMOX_APP)) as {
    camoxApp: CamoxApp;
  };
  return camoxApp.getDefinitionSet();
}

/**
 * A Definition Set as a string that is equal for equal sets: object keys are sorted, and only
 * what reaches the API (JSON) counts.
 */
function serializeDefinitionSet(definitionSet: DefinitionSet): string {
  return JSON.stringify(definitionSet, (_key, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, (value as Record<string, unknown>)[key]]),
        )
      : value,
  );
}

/** Whether the app, as the `ssr` environment last loaded it, imports `file`, even indirectly. */
function isAppDependency(server: ViteDevServer, file: string): boolean {
  const { moduleGraph } = getNodeEnvironment(server);
  const pending = [...(moduleGraph.getModulesByFile(file) ?? [])];
  const seen = new Set(pending);
  for (let module = pending.pop(); module; module = pending.pop()) {
    if (module.id === RESOLVED_VIRTUAL_CAMOX_APP) return true;
    for (const importer of module.importers) {
      if (seen.has(importer)) continue;
      seen.add(importer);
      pending.push(importer);
    }
  }
  return false;
}

/** Whether a file is a script module, which the app's globs may pick up when it appears. */
function isScriptFile(file: string): boolean {
  return /\.[cm]?[jt]sx?$/.test(file) && !file.endsWith(".d.ts");
}

/** Whether a project's Live has no pages, as on a fresh database. */
async function liveHasNoPages(apiUrl: string, projectSlug: string): Promise<boolean> {
  const { pages } = await createServerApiClient(apiUrl).pages.listBySlug({ projectSlug });
  return pages.length === 0;
}

/**
 * Sync the app's whole Definition Set to the development draft now, then again whenever a module
 * the app depends on changes (debounced), skipping a sync when the set equals the last one sent
 * (ADR 0006). Resolves once the initial sync settles: `synced` if definitions reached the API,
 * and `releasedToLive` if it first released them to an empty Live (`releaseToEmptyLive`).
 */
export async function syncDefinitions(
  server: ViteDevServer,
  options: SyncDefinitionsOptions,
): Promise<{ synced: boolean; releasedToLive: boolean }> {
  const { projectSlug, apiUrl, autoCreate, authToken, deployToken, releaseToEmptyLive } = options;
  const logger = server.config.logger;

  /** What the development draft last received, so an unchanged set isn't sent again. */
  let lastSynced: string | undefined;
  let releasedToLive = false;

  async function sync({ initial = false } = {}): Promise<void> {
    const definitionSet = await loadDefinitionSet(server);
    const serialized = serializeDefinitionSet(definitionSet);
    if (serialized === lastSynced) return;

    // Release before the dev sync: the development draft then sees Live's layout blocks and
    // homepage, instead of seeding its own copies that publishing would duplicate.
    if (initial && releaseToEmptyLive && (await liveHasNoPages(apiUrl, projectSlug))) {
      logger.info("[camox] Live is empty: releasing your definitions to it", { timestamp: true });
      await syncDefinitionsToApi({
        definitionSet,
        projectSlug,
        apiUrl,
        autoCreate: false,
        deployToken: releaseToEmptyLive,
        logger,
      });
      releasedToLive = true;
    }

    await syncDefinitionsToApi({
      definitionSet,
      projectSlug,
      apiUrl,
      autoCreate,
      authToken,
      deployToken,
      logger,
    });
    lastSynced = serialized;
  }

  let synced = false;
  try {
    await sync({ initial: true });
    synced = true;
  } catch (error) {
    logger.error(`[camox] Failed to sync block definitions: ${String(error)}`, {
      timestamp: true,
    });
  }

  // One sync at a time: a change during a sync waits for it, then syncs the newest set.
  let running: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scheduleSync = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      running = running.then(() =>
        sync().catch((error: unknown) => {
          logger.error(`[camox] Failed to sync definitions: ${String(error)}`, {
            timestamp: true,
          });
        }),
      );
    }, SYNC_DEBOUNCE_DELAY_MS);
  };

  server.watcher.on("change", (file) => {
    if (isAppDependency(server, file)) scheduleSync();
  });
  // A new or removed module may match one of the app's globs; an unrelated one leaves the set
  // equal, so it sends nothing.
  server.watcher.on("add", (file) => {
    if (isScriptFile(file)) scheduleSync();
  });
  server.watcher.on("unlink", (file) => {
    if (isScriptFile(file) || isAppDependency(server, file)) scheduleSync();
  });

  return { synced, releasedToLive };
}
