import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { ViteBuilder } from "vite-plus";

/**
 * Builds the client first: the Worker's build reads where each block's chunk ended up.
 * This replaces the Cloudflare plugin's order, which builds the Worker first.
 */
export async function buildClientThenWorker(builder: ViteBuilder): Promise<void> {
  const { client, ...servers } = builder.environments;
  await builder.build(client);
  const clientDir = resolve(builder.config.root, client.config.build.outDir);
  for (const server of Object.values(servers)) {
    await builder.build(server);
    moveImportedAssets(resolve(builder.config.root, server.config.build.outDir), clientDir);
  }
}

/**
 * Moves the files the Worker imports as URLs, such as stylesheets, to the client's
 * static assets, which serve them. The Cloudflare plugin's own build does the same.
 */
function moveImportedAssets(serverDir: string, clientDir: string): void {
  const manifestPath = join(serverDir, ".vite", "manifest.json");
  if (!existsSync(manifestPath)) return;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<
    string,
    { assets?: string[] }
  >;
  for (const asset of new Set(Object.values(manifest).flatMap((chunk) => chunk.assets ?? []))) {
    const from = join(serverDir, asset);
    const to = join(clientDir, asset);
    if (!existsSync(from)) continue;
    // Hashed names: a file the client already has is the same file.
    if (existsSync(to)) rmSync(from);
    else {
      mkdirSync(dirname(to), { recursive: true });
      renameSync(from, to);
    }
  }
}
