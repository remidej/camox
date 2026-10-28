import type { getSandbox } from "@cloudflare/sandbox";
import { SDK_BUNDLE_TARGETS } from "camox/_internal/sdkBundleName";

import type { Bindings } from "../../types";
import {
  ensureSdkBundle,
  type SdkBundleNames,
  sdkBundleArchiveKey,
  sdkBundleNamesOf,
} from "./ensure";

// A hosted build never builds its SDK Bundle (ADR 0029): it reads it from its bundle cache
// (`CAMOX_INTERNAL_SDK_BUNDLE_CACHE`), one folder per target named by the target's name, which
// whoever runs the build fills from the stored bundle first.

/**
 * A sandbox a build runs in, as `getSandbox` gives it with the RPC transport: the bundle's
 * archive is written to it as a stream.
 */
export type SdkBundleSandbox = Pick<ReturnType<typeof getSandbox>, "exists" | "writeFile" | "exec">;

export type FetchSdkBundle = {
  /** The build's bundle cache: the folder its `CAMOX_INTERNAL_SDK_BUNDLE_CACHE` names. */
  cacheDir: string;
  /** The website's `pnpm-lock.yaml`, which names the bundle when `names` doesn't. */
  lockfile: string;
  /** The names the website's own camox gave the bundle, such as a missing-bundle error says. */
  names?: SdkBundleNames;
  /**
   * The website's `package.json`, to ensure the bundle from when it isn't stored. Without it, a
   * bundle that isn't stored isn't fetched.
   */
  ensureFrom?: { packageJson: string };
};

/**
 * Puts the stored SDK Bundle of a website into a sandbox's bundle cache, unless it's there
 * already, ensuring it first when `ensureFrom` allows it. Returns the names it's cached under,
 * or null when it isn't stored and wasn't ensured.
 */
export async function fetchSdkBundle(
  env: Pick<Bindings, "SANDBOX" | "REVISION_BUILDS">,
  sandbox: SdkBundleSandbox,
  { cacheDir, lockfile, names: given, ensureFrom }: FetchSdkBundle,
): Promise<SdkBundleNames | null> {
  let names = given ?? (await sdkBundleNamesOf(lockfile));
  const missing = async () =>
    (
      await Promise.all(
        SDK_BUNDLE_TARGETS.map(async (target) =>
          (await sandbox.exists(manifestOf(cacheDir, names[target]))).exists ? [] : [target],
        ),
      )
    ).flat();
  let uncached = await missing();
  if (uncached.length === 0) return names;

  let archives = await Promise.all(
    uncached.map((target) => env.REVISION_BUILDS.get(sdkBundleArchiveKey(names[target]))),
  );
  if (archives.some((archive) => !archive)) {
    for (const archive of archives) await archive?.body.cancel();
    if (!ensureFrom) return null;
    const ensured = await ensureSdkBundle(
      env,
      { packageJson: ensureFrom.packageJson, lockfile },
      { names },
    );
    // A bundle built by the website's camox has its names, which an older API may not compute.
    if (ensured.browser !== names.browser || ensured.workerd !== names.workerd) {
      names = ensured;
      uncached = await missing();
    }
    archives = await Promise.all(
      uncached.map((target) => env.REVISION_BUILDS.get(sdkBundleArchiveKey(names[target]))),
    );
    if (archives.some((archive) => !archive)) {
      throw new Error(`The SDK Bundle ${JSON.stringify(names)} was ensured, but isn't stored`);
    }
  }

  await Promise.all(
    uncached.map(async (target, at) => {
      const name = names[target];
      const id = crypto.randomUUID();
      const archive = `/tmp/camox-sdk-bundle-${id}.tar.gz`;
      // Unpacked aside, then named: a folder under its name always holds the whole bundle.
      const unpacking = `${cacheDir}/.fetching-${id}`;
      await sandbox.writeFile(archive, archives[at]!.body);
      const unpacked = await sandbox.exec(
        `mkdir -p ${unpacking} && tar -xzf ${archive} -C ${unpacking} && rm -f ${archive} && mv -T ${unpacking} ${cacheDir}/${name}`,
      );
      if (!unpacked.success) {
        throw new Error(
          `The SDK Bundle ${name} wasn't unpacked into its cache: ${unpacked.stderr.trim()}`,
        );
      }
    }),
  );
  return names;
}

/** The file every target's folder holds as `buildSdkBundle` leaves it. */
const manifestOf = (cacheDir: string, name: string) => `${cacheDir}/${name}/sdk-bundle.json`;
