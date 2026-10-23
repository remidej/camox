import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cloudflare } from "@cloudflare/vite-plugin";
import { createBuilder, preview } from "vite-plus";

import { ASSET_PREFIX_GLOBAL } from "../runtime/assetPrefix";
import { HOSTED_BUILD_ENV } from "./hostedChecks";
import { camox } from "./vite";

const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const fixtureRoot = join(sdkRoot, "test/fixture-app");

export const FIXTURE_PROJECT_ID = "01a15fff-627b-7fa1-938b-93ab659c1acc";

/** A running copy of the built Worker. */
export interface ServedBuild {
  url: string;
  fetch(path: string, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

export interface FixtureBuild {
  root: string;
  /** What Workers Static Assets serves: the client build and the app's public files. */
  clientDir: string;
  /**
   * Runs the built Worker in workerd, as Cloudflare does. With `assetPrefix`, an entry module sets
   * the prefix before the build's server bundle loads, as a revision's loader does.
   */
  serve(options?: { assetPrefix?: string }): Promise<ServedBuild>;
  cleanup(): Promise<void>;
}

/**
 * Copies the fixture app (`packages/sdk/test/fixture-app`) to a temp directory, with `files`
 * written over it, and builds it for real as a dry-run release: what a project's build runs
 * without syncing Live. Camox's plugin comes from this package's source.
 */
export async function buildFixtureApp({
  apiUrl,
  files = {},
  hosted = false,
}: {
  /** The Camox API the build talks to. */
  apiUrl: string;
  /** Files to add or replace, by path from the app's root. */
  files?: Record<string, string>;
  /** Build as Camox's sandboxes build a hosted project: with its build checks on. */
  hosted?: boolean;
}): Promise<FixtureBuild> {
  const temp = await mkdtemp(join(tmpdir(), "camox-fixture-"));
  const root = join(temp, "app");
  const cleanup = () => rm(temp, { recursive: true, force: true });
  try {
    await cp(fixtureRoot, root, { recursive: true });
    for (const [path, contents] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), contents);
    }
    await linkDependencies(root);
    const env = { CAMOX_INTERNAL_RELEASE: "dry-run", [HOSTED_BUILD_ENV]: hosted ? "1" : undefined };
    await withEnv(env, async () => {
      const builder = await createBuilder({
        configFile: false,
        root,
        logLevel: "silent",
        // Emit the fixture's tiny font as a file, as a real one would be.
        build: { assetsInlineLimit: 0 },
        plugins: [
          cloudflare(),
          camox({
            projectId: FIXTURE_PROJECT_ID,
            _internal: { apiUrl, authenticationUrl: apiUrl },
          }),
        ],
      });
      await builder.buildApp();
    });
  } catch (error) {
    await cleanup();
    throw error;
  }

  // Where the Cloudflare plugin points wrangler at the built Worker's config.
  const deployConfigDir = join(root, ".wrangler/deploy");
  const deployConfig = JSON.parse(await readFile(join(deployConfigDir, "config.json"), "utf8")) as {
    configPath: string;
  };
  const wranglerPath = resolve(deployConfigDir, deployConfig.configPath);
  const workerDir = dirname(wranglerPath);
  const wrangler = JSON.parse(await readFile(wranglerPath, "utf8")) as { main: string };
  return {
    root,
    clientDir: join(root, "dist/client"),
    async serve({ assetPrefix } = {}) {
      let main = wrangler.main;
      if (assetPrefix !== undefined) {
        // A module of its own: imports run before the importing module's body.
        await writeFile(
          join(workerDir, "set-asset-prefix.js"),
          `globalThis.${ASSET_PREFIX_GLOBAL} = ${JSON.stringify(assetPrefix)};\n`,
        );
        await writeFile(
          join(workerDir, "prefixed-entry.js"),
          `import "./set-asset-prefix.js";\nexport { default } from ${JSON.stringify(`./${wrangler.main}`)};\n`,
        );
        main = "prefixed-entry.js";
      }
      await writeFile(wranglerPath, JSON.stringify({ ...wrangler, main }));
      const server = await preview({
        configFile: false,
        root,
        logLevel: "silent",
        plugins: [cloudflare()],
        preview: { host: "127.0.0.1", port: 0 },
      });
      const url = server.resolvedUrls!.local[0]!;
      return {
        url,
        fetch: (path, init) => fetch(new URL(path, url), init),
        close: () => server.close(),
      };
    },
    cleanup,
  };
}

/**
 * The app's own `node_modules`, linking this package's dependencies and `camox` itself, so Vite's
 * caches and Camox's sidecar land in the copy.
 */
async function linkDependencies(root: string) {
  const modules = join(root, "node_modules");
  const sdkModules = join(sdkRoot, "node_modules");
  await mkdir(modules);
  await symlink(sdkRoot, join(modules, "camox"), "dir");
  for (const entry of await readdir(sdkModules)) {
    if (entry.startsWith(".")) continue;
    if (entry.startsWith("@")) {
      await mkdir(join(modules, entry));
      for (const scoped of await readdir(join(sdkModules, entry)))
        await symlink(join(sdkModules, entry, scoped), join(modules, entry, scoped), "dir");
    } else {
      await symlink(join(sdkModules, entry), join(modules, entry), "dir");
    }
  }
}

/** Runs `run` with `env` set, where `undefined` unsets a variable. */
async function withEnv<T>(
  env: Record<string, string | undefined>,
  run: () => Promise<T>,
): Promise<T> {
  const set = (vars: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  const previous = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));
  set(env);
  try {
    return await run();
  } finally {
    set(previous);
  }
}
