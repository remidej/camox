import { getSandbox } from "@cloudflare/sandbox";
import {
  SDK_BUNDLE_TARGETS,
  type SdkBundleNames,
  type SdkBundleSettings,
  sdkBundleName,
} from "camox/_internal/sdkBundleName";
import type { WorkflowStepConfig } from "cloudflare:workers";

import type { Bindings } from "../../types";
import { buildsAgainstSdkBundle } from "./switch";

// Ensuring an SDK Bundle is the only step that ever stores one (ADR 0029). It builds in a fresh
// release sandbox that installs from the lockfile with no cache restored, so no website's code
// or cached `node_modules` was ever there, and stores one archive per target in
// `REVISION_BUILDS`, unless one with its name is already there. SDK Bundles are never deleted.

export type { SdkBundleNames };

/** What an SDK Bundle is built from: a website's manifest and lockfile, and nothing else. */
export type SdkBundleSource = {
  /** The website's `package.json`. */
  packageJson: string;
  /** The website's `pnpm-lock.yaml`. */
  lockfile: string;
};

/**
 * What every hosted project's `camox()` compiles into its SDK Bundle: its `vite.config.ts` is
 * platform-owned (ADR 0021), and sets none of them, so they're `camox()`'s defaults.
 */
export const HOSTED_SDK_BUNDLE_SETTINGS: SdkBundleSettings = {
  iconIds: [],
  telemetryDisabled: false,
  experimentalFeatures: false,
  apiUrl: "https://api.camox.ai",
};

/**
 * The Workflow step that ensures an SDK Bundle: an install and a build, a few minutes at most,
 * tried again a few times, as a sandbox can fail to start.
 */
export const ENSURE_SDK_BUNDLE: WorkflowStepConfig = {
  retries: { limit: 3, delay: "30 seconds", backoff: "exponential" },
  timeout: "20 minutes",
};

/** The SDK Bundle of a website's lockfile, as the API's copy of camox names it. */
export async function sdkBundleNamesOf(
  lockfile: string,
  settings: SdkBundleSettings = HOSTED_SDK_BUNDLE_SETTINGS,
): Promise<SdkBundleNames> {
  return Object.fromEntries(
    await Promise.all(
      SDK_BUNDLE_TARGETS.map(async (target) => [
        target,
        await sdkBundleName({ lockfile, target, settings }),
      ]),
    ),
  ) as SdkBundleNames;
}

/**
 * Where one target's SDK Bundle is stored: a gzipped tar archive of its folder's files. Mirrored
 * in apps/dispatch/src/revisions.ts: keep the two in sync.
 */
export const sdkBundleArchiveKey = (name: string) => `sdk/${name}.tar.gz`;

/** Where the website is installed in the sandbox, outside the release steps' `/workspace`. */
const WEBSITE = "/tmp/camox-sdk-bundle/website";
/** Where the builder writes each target's folder. */
const OUT = "/tmp/camox-sdk-bundle/out";

/**
 * Builds with the website's own camox, so the names are its own: `camox/_internal/sdkBundle`
 * (packages/sdk/src/features/sdkBundle/buildSdkBundle.ts). Run with `node --input-type=module`,
 * which resolves its imports from the website's folder.
 */
const BUILDER = `
import { buildSdkBundle } from "camox/_internal/sdkBundle";
const settings = JSON.parse(process.env.CAMOX_SDK_BUNDLE_SETTINGS);
const built = await buildSdkBundle({ root: ".", outDir: ${JSON.stringify(OUT)}, settings });
console.log("camox-sdk-bundle: " + JSON.stringify({ browser: built.browser.name, workerd: built.workerd.name }));
`;
const BUILD_COMMAND = 'node --input-type=module -e "$CAMOX_SDK_BUNDLE_BUILDER"';
/** The line the builder reports the names it built under on. */
const BUILDER_REPORT = /^camox-sdk-bundle: (.*)$/m;

const tail = (text: string, lines = 20) => text.trimEnd().split("\n").slice(-lines).join("\n");

/**
 * Makes sure the SDK Bundle of a website's lockfile is stored, and returns its names. A stored
 * one returns at once. Otherwise it's built, and each target is stored only if nothing with its
 * name is yet, so callers that race all end up with the first stored bytes.
 *
 * The names it looks up first are the ones it's given, or else the API's copy of camox's. Those
 * digest `camox`'s own resolution, so one that's stored was built by the website's camox
 * version. It stores only under the API's names: when the website's camox, in the sandbox,
 * reports others (a fork, or a camox whose naming changed), it throws and stores nothing.
 */
export async function ensureSdkBundle(
  env: Pick<Bindings, "SANDBOX" | "REVISION_BUILDS">,
  source: SdkBundleSource,
  options?: EnsureOptions,
): Promise<SdkBundleNames>;
/**
 * With `ifSwitchedOn`, the website's camox is first asked whether it builds against an SDK
 * Bundle, once installed, and null is returned, with nothing built, when it builds whole-app.
 */
export async function ensureSdkBundle(
  env: Pick<Bindings, "SANDBOX" | "REVISION_BUILDS">,
  source: SdkBundleSource,
  options: EnsureOptions & { ifSwitchedOn: { buildEnv: Record<string, string> } },
): Promise<SdkBundleNames | null>;
export async function ensureSdkBundle(
  env: Pick<Bindings, "SANDBOX" | "REVISION_BUILDS">,
  source: SdkBundleSource,
  {
    settings = HOSTED_SDK_BUNDLE_SETTINGS,
    names: given,
    ifSwitchedOn,
  }: EnsureOptions & { ifSwitchedOn?: { buildEnv: Record<string, string> } } = {},
): Promise<SdkBundleNames | null> {
  const names = given ?? (await sdkBundleNamesOf(source.lockfile, settings));
  const stored = await Promise.all(
    Object.values(names).map((name) => env.REVISION_BUILDS.head(sdkBundleArchiveKey(name))),
  );
  if (stored.every(Boolean)) return names;
  return buildSdkBundle(env, source, settings, ifSwitchedOn?.buildEnv);
}

type EnsureOptions = {
  settings?: SdkBundleSettings;
  /**
   * The names the website's own camox gave the bundle, such as a build's missing-bundle error
   * reports: they're looked up instead of the API's.
   */
  names?: SdkBundleNames;
};

/**
 * Builds the SDK Bundle in a sandbox of its own, and stores each target it doesn't find. Stores
 * nothing when the website's camox names it unlike the API's copy does.
 */
async function buildSdkBundle(
  env: Pick<Bindings, "SANDBOX" | "REVISION_BUILDS">,
  source: SdkBundleSource,
  settings: SdkBundleSettings,
  /** With it, the website's camox is asked first whether it builds against an SDK Bundle. */
  probeEnv?: Record<string, string>,
): Promise<SdkBundleNames | null> {
  // A new sandbox each time: nothing ran in it, and no snapshot is restored into it.
  const sandbox = getSandbox(env.SANDBOX, `sdk-bundle-${crypto.randomUUID()}`, {
    transport: "rpc",
    enableDefaultSession: false,
  });
  const run = async (command: string, options: { env?: Record<string, string> } = {}) => {
    const result = await sandbox.exec(command, { cwd: WEBSITE, ...options });
    if (!result.success) {
      throw new Error(
        `\`${command}\` exited with ${result.exitCode}: ${tail(`${result.stdout}\n${result.stderr}`)}`,
      );
    }
    return result;
  };
  try {
    // The manifest without its scripts, which are the website's code.
    const { scripts: _scripts, ...manifest } = JSON.parse(source.packageJson) as Record<
      string,
      unknown
    >;
    await sandbox.writeFile(`${WEBSITE}/package.json`, JSON.stringify(manifest, null, 2));
    await sandbox.writeFile(`${WEBSITE}/pnpm-lock.yaml`, source.lockfile);
    // No package's install script runs either: the build needs none.
    await run("pnpm install --frozen-lockfile --ignore-scripts", { env: { CI: "1" } });
    if (probeEnv && !(await buildsAgainstSdkBundle(sandbox, WEBSITE, probeEnv))) return null;
    const built = await run(BUILD_COMMAND, {
      env: {
        CI: "1",
        CAMOX_SDK_BUNDLE_BUILDER: BUILDER,
        CAMOX_SDK_BUNDLE_SETTINGS: JSON.stringify(settings),
      },
    });
    const report = BUILDER_REPORT.exec(built.stdout)?.[1];
    if (!report)
      throw new Error(`The SDK Bundle's builder reported no names: ${tail(built.stdout)}`);
    const names = JSON.parse(report) as SdkBundleNames;
    // The website's camox can be a fork, whose builder could name its bytes after another
    // lockfile's bundle, such as the Template's next one. Only the API's names are stored under.
    const expected = await sdkBundleNamesOf(source.lockfile, settings);
    if (SDK_BUNDLE_TARGETS.some((target) => names[target] !== expected[target])) {
      throw new Error(
        `The website's camox built the SDK Bundle under other names than the API's copy of camox ` +
          `gives its lockfile (${JSON.stringify(names)}, not ${JSON.stringify(expected)}), so ` +
          `nothing was stored. The API's camox and the website's must name SDK Bundles alike.`,
      );
    }

    for (const target of SDK_BUNDLE_TARGETS) {
      const archive = `/tmp/camox-sdk-bundle/${target}.tar.gz`;
      await run(`tar -I 'gzip -1' -cf ${archive} -C ${OUT}/${target} .`);
      const { content } = await sandbox.readFile(archive, { encoding: "base64" });
      const bytes = Uint8Array.from(atob(content), (char) => char.charCodeAt(0));
      // Stored only if nothing has its name yet: a bundle never changes once stored.
      await env.REVISION_BUILDS.put(sdkBundleArchiveKey(names[target]), bytes, {
        onlyIf: { etagDoesNotMatch: "*" },
      });
    }
    return names;
  } finally {
    await sandbox.destroy().catch((error: unknown) => {
      console.error("An SDK Bundle's sandbox wasn't destroyed", error);
    });
  }
}
