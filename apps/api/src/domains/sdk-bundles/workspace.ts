import type { DirectoryBackup } from "@cloudflare/ci/worker";
import { getSandbox } from "@cloudflare/sandbox";

import type { Bindings } from "../../types";
import type { SdkBundleNames, SdkBundleSource } from "./ensure";
import { fetchSdkBundle } from "./fetch";
import { buildsAgainstSdkBundle } from "./switch";

// Release steps (`camox release`, and an Upgrade's dry run) build in `@cloudflare/ci` sandboxes,
// each on the workspace snapshot the step before it left. A hosted build never builds its SDK
// Bundle (ADR 0029), so the step before the build gets a snapshot of its own: the same
// workspace, with the stored bundle in its bundle cache.

/**
 * The bundle cache release steps build with (`CAMOX_INTERNAL_SDK_BUNDLE_CACHE`): inside the
 * workspace, the only folder a snapshot keeps, and out of the project's `node_modules`, which
 * an install restores from the project's cache.
 */
export const RELEASE_SDK_BUNDLE_CACHE = "/workspace/.camox-sdk-bundles";

/** The environment a release step builds with, so that it reads its bundle cache. */
export const RELEASE_SDK_BUNDLE_ENV = { CAMOX_INTERNAL_SDK_BUNDLE_CACHE: RELEASE_SDK_BUNDLE_CACHE };

/** How long the snapshot stays restorable, as `@cloudflare/ci` keeps its steps' snapshots. */
const SNAPSHOT_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * A snapshot of the workspace `snapshot` with the stored SDK Bundle of the website `source`
 * describes in `RELEASE_SDK_BUNDLE_CACHE`, ensured first when it isn't stored. Null when the
 * website's camox builds whole-app: the step builds on `snapshot` as it is.
 *
 * The cache is emptied first, so the bundle always comes from `REVISION_BUILDS`, never from what
 * the workspace held. `env` is the build's environment, which may set camox's switch.
 */
export async function withStoredSdkBundle(
  env: Pick<Bindings, "SANDBOX" | "REVISION_BUILDS">,
  snapshot: DirectoryBackup,
  source: SdkBundleSource,
  buildEnv: Record<string, string> = {},
): Promise<{ snapshot: DirectoryBackup; names: SdkBundleNames } | null> {
  const sandbox = getSandbox(env.SANDBOX, `sdk-bundle-workspace-${crypto.randomUUID()}`, {
    transport: "rpc",
    enableDefaultSession: false,
  });
  try {
    await sandbox.restoreBackup(snapshot);
    if (!(await buildsAgainstSdkBundle(sandbox, snapshot.dir, buildEnv))) return null;

    const emptied = await sandbox.exec(`rm -rf ${RELEASE_SDK_BUNDLE_CACHE}`);
    if (!emptied.success) {
      throw new Error(`The SDK Bundle cache wasn't emptied: ${emptied.stderr.trim()}`);
    }
    const names = await fetchSdkBundle(env, sandbox, {
      cacheDir: RELEASE_SDK_BUNDLE_CACHE,
      lockfile: source.lockfile,
      ensureFrom: { packageJson: source.packageJson },
    });
    // Ensuring returns names or throws.
    if (!names) throw new Error("The SDK Bundle was neither stored nor ensured");
    // As `@cloudflare/ci` backs a step's workspace up: local R2 where there's no FUSE.
    const localBucket = (await sandbox.exec("test -c /dev/fuse")).exitCode !== 0;
    const withBundle = await sandbox.createBackup({
      dir: snapshot.dir,
      name: "sdk-bundle",
      ttl: SNAPSHOT_TTL_SECONDS,
      localBucket,
    });
    return { snapshot: withBundle, names };
  } finally {
    await sandbox.destroy().catch((error: unknown) => {
      console.error("An SDK Bundle's workspace sandbox wasn't destroyed", error);
    });
  }
}
