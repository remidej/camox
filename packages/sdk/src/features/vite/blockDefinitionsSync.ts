import path from "node:path";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type { ViteDevServer } from "vite";
import { ConvexClient } from "convex/browser";
import { api } from "camox/_generated/api";
import type { CamoxApp } from "@/core/createApp";
import type { Block } from "@/core/createBlock";
import type { Id } from "camox/_generated/dataModel";

const SYNC_DEBOUNCE_DELAY_MS = 100;
const WRITE_LOCK_DURATION_MS = 500;

export interface BlockDefinitionsSyncOptions {
  /** Path to the module that exports the camoxApp (relative to project root) */
  camoxAppPath?: string;
}

function getBlockIdFromFilePath(filePath: string): string {
  const fileName = path.basename(filePath, path.extname(filePath));
  return fileName;
}

function getBlockFilePath(blocksDir: string, blockId: string): string {
  return path.join(blocksDir, `${blockId}.tsx`);
}

export async function syncBlockDefinitions(
  server: ViteDevServer,
  options: BlockDefinitionsSyncOptions = {},
): Promise<void> {
  const camoxAppPath = options.camoxAppPath ?? "./src/camox.ts";
  const blocksDir = path.resolve(server.config.root, "src/blocks");

  const convexUrl = process.env.VITE_CONVEX_URL;
  if (!convexUrl) {
    server.config.logger.warn(
      "[camox] VITE_CONVEX_URL not set, skipping block definitions sync",
      { timestamp: true },
    );
    return;
  }

  const client = new ConvexClient(convexUrl);

  // Track files being written to prevent sync loops
  const filesBeingWritten = new Set<string>();

  // Track known definitions for detecting changes from Convex
  const knownDefinitions = new Map<
    string,
    { updatedAt: number; code?: string }
  >();
  let isInitialConvexSync = true;

  async function getProjectId(): Promise<Id<"projects"> | null> {
    const project = await client.query(api.projects.getFirstProject, {});
    if (!project) {
      server.config.logger.warn(
        "[camox] No project found, skipping block definitions sync",
        { timestamp: true },
      );
      return null;
    }
    return project._id;
  }

  async function performInitialSync(): Promise<void> {
    const camoxModule = (await server.ssrLoadModule(camoxAppPath)) as {
      camoxApp?: CamoxApp;
    };

    if (!camoxModule.camoxApp) {
      server.config.logger.warn(
        `[camox] No camoxApp export found in ${camoxAppPath}`,
        { timestamp: true },
      );
      return;
    }

    const projectId = await getProjectId();
    if (!projectId) return;

    // Get definitions with code from files
    const blocks = camoxModule.camoxApp.getBlocks();
    const definitions = blocks.map((block: Block) => {
      const filePath = getBlockFilePath(blocksDir, block.id);
      const code = existsSync(filePath)
        ? readFileSync(filePath, "utf-8")
        : undefined;
      return {
        blockId: block.id,
        title: block.title,
        description: block.description,
        contentSchema: block.contentSchema,
        settingsSchema: block.settingsSchema,
        code,
      };
    });

    await client.mutation(api.blockDefinitions.syncBlockDefinitions, {
      projectId,
      definitions,
    });

    server.config.logger.info(
      `[camox] Synced ${definitions.length} block definition${definitions.length === 1 ? "" : "s"}`,
      { timestamp: true },
    );
  }

  async function upsertBlock(filePath: string): Promise<void> {
    const relativePath = "./" + path.relative(server.config.root, filePath);

    // Invalidate module cache for this specific file
    const moduleNode = server.moduleGraph.getModuleById(relativePath);
    if (moduleNode) {
      server.moduleGraph.invalidateModule(moduleNode);
    }

    const blockModule = (await server.ssrLoadModule(relativePath)) as {
      block?: Block;
    };

    if (!blockModule.block) {
      server.config.logger.warn(
        `[camox] No block export found in ${relativePath}`,
        { timestamp: true },
      );
      return;
    }

    const block = blockModule.block;
    const projectId = await getProjectId();
    if (!projectId) return;

    // Read the file content to store as code
    const code = readFileSync(filePath, "utf-8");

    const result = await client.mutation(
      api.blockDefinitions.upsertBlockDefinition,
      {
        projectId,
        blockId: block.id,
        title: block.title,
        description: block.description,
        contentSchema: block.contentSchema,
        settingsSchema: block.settingsSchema,
        code,
      },
    );

    server.config.logger.info(
      `[camox] ${result.action === "created" ? "Created" : "Updated"} block "${block.id}"`,
      { timestamp: true },
    );
  }

  async function deleteBlock(filePath: string): Promise<void> {
    const blockId = getBlockIdFromFilePath(filePath);
    const projectId = await getProjectId();
    if (!projectId) return;

    const result = await client.mutation(
      api.blockDefinitions.deleteBlockDefinition,
      {
        projectId,
        blockId,
      },
    );

    if (result.deleted) {
      server.config.logger.info(`[camox] Deleted block "${blockId}"`, {
        timestamp: true,
      });
    }
  }

  function writeBlockFile(blockId: string, code: string): void {
    const filePath = getBlockFilePath(blocksDir, blockId);

    // Lock the file to prevent sync loop
    filesBeingWritten.add(filePath);

    writeFileSync(filePath, code);

    server.config.logger.info(
      `[camox] Wrote block file from Convex: ${blockId}.tsx`,
      { timestamp: true },
    );

    // Release lock after delay
    setTimeout(() => {
      filesBeingWritten.delete(filePath);
    }, WRITE_LOCK_DURATION_MS);
  }

  function handleConvexUpdate(
    definitions: Array<{
      blockId: string;
      updatedAt: number;
      code?: string;
    }>,
  ): void {
    // On first callback, just populate known definitions
    if (isInitialConvexSync) {
      for (const def of definitions) {
        knownDefinitions.set(def.blockId, {
          updatedAt: def.updatedAt,
          code: def.code,
        });
      }
      isInitialConvexSync = false;
      return;
    }

    for (const def of definitions) {
      const known = knownDefinitions.get(def.blockId);
      const isNew = !known;
      const isUpdated = known && def.updatedAt > known.updatedAt;

      // Skip if no changes
      if (!isNew && !isUpdated) continue;

      // Skip if no code to write
      if (!def.code) {
        knownDefinitions.set(def.blockId, {
          updatedAt: def.updatedAt,
          code: def.code,
        });
        continue;
      }

      const filePath = getBlockFilePath(blocksDir, def.blockId);

      // Check if file exists and compare timestamps
      if (existsSync(filePath)) {
        const fileMtime = statSync(filePath).mtimeMs;
        // If file is newer than Convex update, skip (file wins)
        if (fileMtime > def.updatedAt) {
          knownDefinitions.set(def.blockId, {
            updatedAt: def.updatedAt,
            code: def.code,
          });
          continue;
        }
      }

      // Write the code to file
      writeBlockFile(def.blockId, def.code);

      // Update known definitions
      knownDefinitions.set(def.blockId, {
        updatedAt: def.updatedAt,
        code: def.code,
      });
    }
  }

  // Initial sync from files to Convex
  try {
    await performInitialSync();
  } catch (error) {
    server.config.logger.error(
      `[camox] Failed to sync block definitions: ${error}`,
      { timestamp: true },
    );
  }

  // Subscribe to Convex changes for 2-way sync
  const projectId = await getProjectId();
  if (projectId) {
    client.onUpdate(
      api.blockDefinitions.getBlockDefinitions,
      { projectId },
      handleConvexUpdate,
    );
  }

  // Watch for changes in block files
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function isBlockFile(filePath: string): boolean {
    return filePath.startsWith(blocksDir) && /\.tsx?$/.test(filePath);
  }

  const handleBlockFileUpsert = (filePath: string) => {
    if (!isBlockFile(filePath)) return;

    // Skip if this file is being written by Convex sync (prevents loop)
    if (filesBeingWritten.has(filePath)) {
      return;
    }

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
          server.config.logger.error(
            `[camox] Failed to sync block: ${error}`,
            { timestamp: true },
          );
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
        server.config.logger.error(
          `[camox] Failed to delete block: ${error}`,
          { timestamp: true },
        );
      }
    }, SYNC_DEBOUNCE_DELAY_MS);
  };

  server.watcher.on("change", handleBlockFileUpsert);
  server.watcher.on("add", handleBlockFileUpsert);
  server.watcher.on("unlink", handleBlockFileDelete);

  // Clean up on server close
  server.httpServer?.on("close", () => {
    client.close();
  });
}
