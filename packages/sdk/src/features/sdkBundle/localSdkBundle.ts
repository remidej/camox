/**
 * A website's SDK Bundle on this machine: looked up in a local cache by name, and built there when
 * it's missing, unless the build is a hosted one, which never builds one. Runs in Node.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import { type SdkBundleBuild, buildSdkBundle, sdkBundleNamesFor } from "./buildSdkBundle";
import {
  SDK_BUNDLE_BUILD_MANIFEST,
  type SdkBundleNames,
  type SdkBundleSettings,
  sdkBundleMissingLine,
  sdkBundlePath,
} from "./sdkBundleName";
import { SDK_BUNDLE_TARGETS } from "./specifiers";

/** Turns building against an SDK Bundle on (`1`) or off (`0`) for `vite build`. */
export const SDK_BUNDLE_SWITCH_ENV = "CAMOX_INTERNAL_SDK_BUNDLE";
/** On: websites build against an SDK Bundle by default (#670, ADR 0029). */
const SDK_BUNDLE_SWITCH_DEFAULT = true;
/** The folder SDK Bundles are cached in, when not the website's own. */
export const SDK_BUNDLE_CACHE_ENV = "CAMOX_INTERNAL_SDK_BUNDLE_CACHE";

/** Whether `vite build` builds against an SDK Bundle. */
export function buildsAgainstSdkBundle(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[SDK_BUNDLE_SWITCH_ENV];
  if (value === "1") return true;
  if (value === "0") return false;
  return SDK_BUNDLE_SWITCH_DEFAULT;
}

/** What a hosted build fails with when its SDK Bundle isn't in the cache: it never builds one. */
export class SdkBundleMissingError extends Error {
  override name = "SdkBundleMissingError";
  readonly code = "CAMOX_SDK_BUNDLE_MISSING";
  constructor(readonly names: SdkBundleNames) {
    super(
      `Camox: this build's SDK Bundle isn't in its cache, and a hosted build never builds one.\n` +
        sdkBundleMissingLine(names),
    );
  }
}

/**
 * The folder a website's SDK Bundles are cached in, one folder per target's name:
 * `CAMOX_INTERNAL_SDK_BUNDLE_CACHE`, or the website's `node_modules/.cache/camox/sdk-bundles`.
 */
export function sdkBundleCacheDir(root: string, env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[SDK_BUNDLE_CACHE_ENV];
  return configured
    ? resolve(configured)
    : join(resolve(root), "node_modules/.cache/camox/sdk-bundles");
}

/**
 * Where the cache holds a target's bundle. A linked camox, as in Camox's monorepo, has no
 * integrity in the lockfile, so its name stays the same when its code changes: the cache keys
 * it by its built files too.
 */
function cachedDir(cacheDir: string, name: string, salt: string | null): string {
  return join(cacheDir, salt ? `${name}-${salt}` : name);
}

/**
 * A digest of the linked camox's built files, or null when camox is installed from the registry.
 * Paths, sizes and modification times: enough to see a rebuild.
 */
function linkedCamoxSalt(root: string): string | null {
  const installed = join(resolve(root), "node_modules", "camox");
  if (!existsSync(installed)) return null;
  const real = realpathSync(installed);
  if (real.split(sep).includes("node_modules")) return null;
  const dist = join(real, "dist");
  const hash = createHash("sha256");
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir).sort()) {
      const path = join(dir, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else hash.update(`${relative(dist, path)} ${stat.size} ${stat.mtimeMs}\n`);
    }
  };
  if (existsSync(dist)) walk(dist);
  return hash.digest("hex").slice(0, 12);
}

/**
 * The website's SDK Bundle from the cache, built there first when it's missing and `mayBuild`.
 * A hosted build passes `mayBuild: false`, and gets `SdkBundleMissingError` for a missing one.
 */
export async function ensureLocalSdkBundle({
  root,
  settings,
  mayBuild,
  onBuild,
  env = process.env,
}: {
  root: string;
  settings: SdkBundleSettings;
  mayBuild: boolean;
  /** Called before a missing bundle is built. */
  onBuild?: (names: SdkBundleNames) => void;
  env?: NodeJS.ProcessEnv;
}): Promise<SdkBundleBuild> {
  const names = await sdkBundleNamesFor({ root, settings });
  const cacheDir = sdkBundleCacheDir(root, env);
  const salt = linkedCamoxSalt(root);
  const cached = (target: keyof SdkBundleNames) => ({
    name: names[target],
    dir: cachedDir(cacheDir, names[target], salt),
  });
  const result: SdkBundleBuild = { browser: cached("browser"), workerd: cached("workerd") };
  if (SDK_BUNDLE_TARGETS.every((target) => existsSync(result[target].dir))) return result;
  if (!mayBuild) throw new SdkBundleMissingError(names);

  onBuild?.(names);
  await mkdir(cacheDir, { recursive: true });
  // Built aside, then moved in: a cached folder is always a whole bundle.
  const staging = await mkdtemp(join(cacheDir, ".building-"));
  try {
    const built = await buildSdkBundle({ root, outDir: staging, settings });
    for (const target of SDK_BUNDLE_TARGETS) {
      if (existsSync(result[target].dir)) continue;
      await rename(built[target].dir, result[target].dir).catch((error: unknown) => {
        // Another build moved the same bundle in first.
        if (!existsSync(result[target].dir)) throw error;
      });
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return result;
}

/** Where the Cloudflare plugin's build put the Worker and its static assets. */
async function buildOutput(root: string): Promise<{ workerDir: string; clientDir: string }> {
  const deployDir = join(resolve(root), ".wrangler/deploy");
  const { configPath } = JSON.parse(await readFile(join(deployDir, "config.json"), "utf8")) as {
    configPath: string;
  };
  const wranglerPath = resolve(deployDir, configPath);
  const wrangler = JSON.parse(readFileSync(wranglerPath, "utf8")) as {
    assets?: { directory?: string };
  };
  const workerDir = dirname(wranglerPath);
  const clientDir = resolve(workerDir, wrangler.assets?.directory ?? "../client");
  return { workerDir, clientDir };
}

/**
 * Adds the SDK Bundle a website's build names to its output, so it deploys on its own: the
 * browser files under `/_camox/sdk/<name>/` in the static assets, and the workerd modules under
 * `_camox/sdk/<name>/` beside the Worker's. A whole-app build is left as it is. Returns the names,
 * or null for a whole-app build.
 */
export async function addSdkBundleToBuild({
  root,
  env = process.env,
}: {
  root: string;
  env?: NodeJS.ProcessEnv;
}): Promise<SdkBundleNames | null> {
  const { workerDir, clientDir } = await buildOutput(root);
  const manifestPath = join(workerDir, SDK_BUNDLE_BUILD_MANIFEST);
  if (!existsSync(manifestPath)) return null;
  const names = JSON.parse(await readFile(manifestPath, "utf8")) as SdkBundleNames;
  const cacheDir = sdkBundleCacheDir(root, env);
  const salt = linkedCamoxSalt(root);
  const destinations = { browser: clientDir, workerd: workerDir };
  for (const target of SDK_BUNDLE_TARGETS) {
    const from = cachedDir(cacheDir, names[target], salt);
    if (!existsSync(from))
      throw new Error(`Camox: the build's SDK Bundle ${names[target]} isn't in ${cacheDir}.`);
    const to = join(destinations[target], sdkBundlePath(names[target]).slice(1));
    await rm(to, { recursive: true, force: true });
    await cp(from, to, { recursive: true });
  }
  return names;
}
