/**
 * An SDK Bundle's name, computed from a pnpm lockfile alone, before anything is built: the
 * bundle and the website's build both bake it in. Runs anywhere Web Crypto does, in Node or a
 * Worker, so the platform can name a bundle without installing the website.
 */
import { parse } from "yaml";

import { type SdkBundleTarget, packageOfSpecifier, sdkBundleSpecifiers } from "./specifiers";

export * from "./specifiers";

/**
 * The version of the code that builds SDK Bundles. Bump it whenever a change to the builder
 * changes what a bundle holds for the same packages and settings.
 */
export const SDK_BUNDLE_BUILDER_VERSION = "1";

/** Where a website's pages and Worker find an SDK Bundle's files: `/_camox/sdk/<name>/`. */
export function sdkBundlePath(name: string): string {
  return `/_camox/sdk/${name}/`;
}

/** An SDK Bundle's name for each target: a website's build names both. */
export type SdkBundleNames = Record<SdkBundleTarget, string>;

/**
 * The file a website's build names its SDK Bundle in, as `SdkBundleNames` JSON, in the server
 * build's folder beside its `wrangler.json`. A build without it is whole-app.
 */
export const SDK_BUNDLE_BUILD_MANIFEST = "camox-sdk-bundle.json";

/** What a hosted build whose SDK Bundle is missing fails with, followed by the names as JSON. */
export const SDK_BUNDLE_MISSING = "CAMOX_SDK_BUNDLE_MISSING";

/** The line a build that's missing its SDK Bundle prints its error with. */
export function sdkBundleMissingLine(names: SdkBundleNames): string {
  return `${SDK_BUNDLE_MISSING} ${JSON.stringify({ browser: names.browser, workerd: names.workerd })}`;
}

/**
 * The SDK Bundle a build's log says is missing, or null when the build failed for another reason:
 * the caller ensures the bundle, then builds again.
 */
export function sdkBundleMissingIn(log: string): SdkBundleNames | null {
  const json = new RegExp(`${SDK_BUNDLE_MISSING} (\\{[^\n]*?\\})`).exec(log)?.[1];
  if (!json) return null;
  try {
    const { browser, workerd } = JSON.parse(json) as Partial<SdkBundleNames>;
    return typeof browser === "string" && typeof workerd === "string" ? { browser, workerd } : null;
  } catch {
    return null;
  }
}

/** The settings `camox()` compiles into an SDK Bundle. */
export interface SdkBundleSettings {
  /** The icon ids of the collection the website picked. */
  iconIds: readonly string[];
  telemetryDisabled: boolean;
  experimentalFeatures: boolean;
  apiUrl: string;
}

export interface SdkBundleNameInputs {
  /** The website's `pnpm-lock.yaml`. */
  lockfile: string;
  /** The website's folder, from the lockfile's: `.` unless the website is in a workspace. */
  importer?: string;
  target: SdkBundleTarget;
  settings: SdkBundleSettings;
  /** Defaults to the builder this SDK ships. */
  builderVersion?: string;
}

/**
 * Packages camox depends on that no specifier on the list reaches: its CLI runs in Node, beside
 * the website's build.
 */
const NEVER_BUNDLED = new Set(["@camox/cli"]);

/**
 * A digest of the builder's version, the target, the settings and the lockfile's resolution
 * (name, version, integrity) of every package the target's specifiers reach.
 */
export async function sdkBundleName({
  lockfile,
  importer = ".",
  target,
  settings,
  builderVersion = SDK_BUNDLE_BUILDER_VERSION,
}: SdkBundleNameInputs): Promise<string> {
  const roots = [...new Set(sdkBundleSpecifiers(target).map(packageOfSpecifier))];
  const resolutions = bundledResolutions(parse(lockfile) as Lockfile, importer, roots);
  const digested = JSON.stringify({
    builderVersion,
    target,
    settings: {
      iconIds: settings.iconIds,
      telemetryDisabled: settings.telemetryDisabled,
      experimentalFeatures: settings.experimentalFeatures,
      apiUrl: settings.apiUrl,
    },
    packages: resolutions,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(digested));
  return [...new Uint8Array(digest).slice(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** The parts of a pnpm v9 lockfile the name reads. */
interface Lockfile {
  importers?: Record<string, LockedImporter>;
  packages?: Record<string, { resolution?: Record<string, unknown>; peerDependencies?: object }>;
  snapshots?: Record<string, { dependencies?: Versions; optionalDependencies?: Versions }>;
}

type Versions = Record<string, string>;

interface LockedImporter {
  dependencies?: Record<string, { version: string }>;
  optionalDependencies?: Record<string, { version: string }>;
  devDependencies?: Record<string, { version: string }>;
}

/** Each package the roots reach, as `name@version` with its resolution, sorted. */
function bundledResolutions(lockfile: Lockfile, importer: string, roots: string[]): string[] {
  const resolutions = new Set<string>();
  const visited = new Set<string>();
  const importerOf = (path: string) => {
    const locked = lockfile.importers?.[path];
    if (!locked) throw new Error(`Camox: the lockfile has no importer at ${JSON.stringify(path)}.`);
    return locked;
  };
  const importerVersions = (locked: LockedImporter, withDev: boolean): Versions =>
    Object.fromEntries(
      [
        ...Object.entries(locked.dependencies ?? {}),
        ...Object.entries(locked.optionalDependencies ?? {}),
        ...(withDev ? Object.entries(locked.devDependencies ?? {}) : []),
      ].map(([name, { version }]) => [name, version]),
    );

  const visit = (name: string, version: string, from: string) => {
    if (NEVER_BUNDLED.has(name)) return;
    // A workspace package: its folder is an importer of its own.
    if (version.startsWith("link:")) {
      const path = joinPath(from, version.slice("link:".length));
      if (visited.has(`link:${path}`)) return;
      visited.add(`link:${path}`);
      resolutions.add(`${name}@link:${path}`);
      for (const [dependency, dependencyVersion] of Object.entries(
        importerVersions(importerOf(path), false),
      ))
        visit(dependency, dependencyVersion, path);
      return;
    }
    const { snapshotKey, packageKey } = lockedKeys(name, version);
    if (visited.has(snapshotKey)) return;
    visited.add(snapshotKey);
    const locked = lockfile.packages?.[packageKey];
    if (!locked) throw new Error(`Camox: the lockfile has no package ${packageKey}.`);
    resolutions.add(`${packageKey} ${JSON.stringify(locked.resolution ?? {})}`);
    // A peer is the installer's to resolve: a package camox only needs beside the website's
    // build, like its Vite plugin's, is reached through it, never through what camox bundles.
    const peers = new Set(Object.keys(locked.peerDependencies ?? {}));
    const snapshot = lockfile.snapshots?.[snapshotKey] ?? {};
    for (const [dependency, dependencyVersion] of Object.entries({
      ...snapshot.dependencies,
      ...snapshot.optionalDependencies,
    })) {
      if (!peers.has(dependency)) visit(dependency, dependencyVersion, from);
    }
  };

  const website = importerVersions(importerOf(importer), true);
  for (const root of roots) {
    const version = website[root];
    if (!version) throw new Error(`Camox: the website doesn't install ${root}.`);
    visit(root, version, importer);
  }
  return [...resolutions].sort();
}

/**
 * Where a dependency's version finds it in the lockfile. pnpm writes `1.0.0(react@19.3.1)` for a
 * package resolved with peers, and the target's own `name@version` for an aliased one.
 */
function lockedKeys(name: string, version: string) {
  const withoutPeers = version.split("(")[0]!;
  const alias = /^(@?[^@]+)@(.+)$/.exec(withoutPeers);
  if (alias) return { snapshotKey: version, packageKey: withoutPeers };
  return { snapshotKey: `${name}@${version}`, packageKey: `${name}@${withoutPeers}` };
}

/** A workspace folder, from the lockfile's, as pnpm names importers: `packages/sdk`, or `.`. */
function joinPath(from: string, relative: string): string {
  const parts: string[] = [];
  for (const part of `${from}/${relative}`.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/") || ".";
}
