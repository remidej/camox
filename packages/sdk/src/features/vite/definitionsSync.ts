import { DEVELOPMENT_DRAFT } from "@camox/api-contract/drafts";
import { type Logger, type ViteDevServer, isRunnableDevEnvironment } from "vite-plus";

import type { CamoxApp, DefinitionSet } from "@/core/createApp";

import { createServerApiClient } from "../../lib/api-client-server";

const SYNC_DEBOUNCE_DELAY_MS = 100;

interface SyncDefinitionsOptions {
  projectUuid: string;
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
function throwSyncTargetNotFoundError(projectUuid: string, deployToken?: string): never {
  if (deployToken) {
    throw new Error(
      `[camox] No project has the Project ID "${projectUuid}". Check the camox() projectId.`,
    );
  }
  throw new Error(
    `[camox] You have no development draft in the project with Project ID "${projectUuid}" yet. ` +
      `Run the dev server while authenticated to create it first.`,
  );
}

/** `count` of `noun`, pluralized: "1 block", "2 blocks". */
function counted(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Names quoted and listed: `"hero", "footer"`. */
function quoted(names: readonly string[]) {
  return names.map((name) => `"${name}"`).join(", ");
}

/**
 * Send a Definition Set to the API: Live's for a release, the development draft's in dev mode.
 * It goes in one `definitions.sync` call, which either fully applies it or changes nothing.
 */
export async function syncDefinitionsToApi(options: {
  definitionSet: DefinitionSet;
  projectUuid: string;
  apiUrl: string;
  autoCreate: boolean;
  authToken?: string;
  deployToken?: string;
  logger: Logger;
}): Promise<void> {
  const { definitionSet, projectUuid, autoCreate, deployToken, logger } = options;
  const client = createSyncClient(options);

  let result;
  try {
    result = await client.definitions.sync({ projectUuid, deployToken, autoCreate, definitionSet });
  } catch (error) {
    throwIfSyncAuthError(error);
    if (!autoCreate && isNotFoundError(error))
      throwSyncTargetNotFoundError(projectUuid, deployToken);
    throw error;
  }
  if (result.draftCreated) {
    logger.info("[camox] Created your development draft", { timestamp: true });
  }

  const definitionCount =
    result.blocks.count + result.collections.count + (result.layouts?.count ?? 0);
  logger.info(`[camox] Synced ${counted(definitionCount, "Camox definition")}`, {
    timestamp: true,
  });

  const { deletedDefinitionTypes } = result.blocks;
  if (deletedDefinitionTypes.length > 0) {
    logger.info(
      `[camox] Removed ${counted(deletedDefinitionTypes.length, "block definition")} no longer in code: ${quoted(deletedDefinitionTypes)}. Their blocks are kept and render nothing until the definition comes back.`,
      { timestamp: true },
    );
  }

  for (const id of result.collections.retired) {
    logger.warn(`[camox] Removed collection "${id}"; its records are kept and hidden`, {
      timestamp: true,
    });
  }

  const layoutSyncResults = result.layouts;
  if (layoutSyncResults) {
    for (const layout of layoutSyncResults.layouts) {
      const { layoutId, createdBlockTypes, removedBlockTypes, skippedOrphanTypes } = layout;
      if (layout.wasExisting && createdBlockTypes.length > 0) {
        logger.info(
          `[camox] Added ${counted(createdBlockTypes.length, "block")} to existing layout "${layoutId}": ${quoted(createdBlockTypes)}`,
          { timestamp: true },
        );
      }
      if (removedBlockTypes.length > 0) {
        logger.info(
          `[camox] Removed ${counted(removedBlockTypes.length, "layoutOnly block")} from layout "${layoutId}": ${quoted(removedBlockTypes)}`,
          { timestamp: true },
        );
      }
      if (skippedOrphanTypes.length > 0) {
        logger.info(
          `[camox] Layout "${layoutId}" has ${counted(skippedOrphanTypes.length, "block")} still in DB but removed from code: ${quoted(skippedOrphanTypes)} (kept because not layoutOnly)`,
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
    const unused = layoutSyncResults.deletedDefinitionTypes;
    if (unused.length > 0) {
      logger.info(
        `[camox] Removed ${counted(unused.length, "layoutOnly block definition")} (no layout uses ${unused.length === 1 ? "it" : "them"} anymore): ${quoted(unused)}`,
        { timestamp: true },
      );
    }
  }

  // The homepage is only created for a fresh project or draft.
  const { homepage } = definitionSet;
  if (homepage && result.homepage?.created) {
    if (homepage.hasInitialBlocks) {
      logger.info(
        `[camox] Initialized content: homepage with ${counted(result.homepage.blockCount, "block")}`,
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
export async function loadDefinitionSet(server: ViteDevServer): Promise<DefinitionSet> {
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
async function liveHasNoPages(apiUrl: string, projectUuid: string): Promise<boolean> {
  const { pages } = await createServerApiClient(apiUrl).pages.listBySlug({ projectUuid });
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
  const { projectUuid, apiUrl, autoCreate, authToken, deployToken, releaseToEmptyLive } = options;
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
    if (initial && releaseToEmptyLive && (await liveHasNoPages(apiUrl, projectUuid))) {
      logger.info("[camox] Live is empty: releasing your definitions to it", { timestamp: true });
      await syncDefinitionsToApi({
        definitionSet,
        projectUuid,
        apiUrl,
        autoCreate: false,
        deployToken: releaseToEmptyLive,
        logger,
      });
      releasedToLive = true;
    }

    await syncDefinitionsToApi({
      definitionSet,
      projectUuid,
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
    logger.error(`[camox] Failed to sync Camox definitions: ${String(error)}`, {
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
          logger.error(`[camox] Failed to sync Camox definitions: ${String(error)}`, {
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
