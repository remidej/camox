import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import * as p from "@clack/prompts";
import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { command, constant, option } from "@optique/core/primitives";

export const parser = command(
  "release",
  object({
    command: constant("release" as const),
    dryRun: option("--dry-run", {
      description: message`Build the website as a release would, without logging in or syncing its definitions to Live.`,
    }),
  }),
);

type Args = { command: "release"; dryRun: boolean };

export async function handler(args: Args): Promise<never> {
  p.intro(args.dryRun ? "camox release --dry-run" : "camox release");

  if (!args.dryRun && !process.env.CAMOX_DEPLOY_TOKEN) {
    p.log.error("CAMOX_DEPLOY_TOKEN is required to release to Live.");
    process.exit(1);
  }

  p.log.info(
    args.dryRun
      ? "Building for Live, without syncing definitions..."
      : "Building and syncing definitions to Live...",
  );

  const executable = process.platform === "win32" ? "vp.cmd" : "vp";
  const result = spawnSync(executable, ["build"], {
    stdio: "inherit",
    env: {
      ...process.env,
      // The SDK's Vite plugin reads it (packages/sdk/src/features/vite/vite.ts).
      CAMOX_INTERNAL_RELEASE: args.dryRun ? "dry-run" : "1",
    },
  });

  if (result.error) {
    p.log.error(`Could not start the release build: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    p.log.error(args.dryRun ? "Dry run failed." : "Release failed.");
    process.exit(result.status ?? 1);
  }

  try {
    const names = await addSdkBundle(process.cwd());
    if (names)
      p.log.info(`Added the SDK Bundle ${names.browser} (browser) and ${names.workerd} (workerd).`);
  } catch (error) {
    p.log.error(
      `Could not add the SDK Bundle: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }

  p.outro(args.dryRun ? "Dry run built successfully." : "Release prepared successfully.");
  process.exit(0);
}

type SdkBundleNames = { browser: string; workerd: string };

/**
 * Adds the SDK Bundle the build names to its output, so it deploys on its own, with the website's
 * own camox. A camox without SDK Bundles builds whole-app, so there's nothing to add.
 */
async function addSdkBundle(root: string): Promise<SdkBundleNames | null> {
  const module = websiteModule(root, "camox", "./_internal/sdkBundle");
  if (!module) return null;
  const { addSdkBundleToBuild } = (await import(pathToFileURL(module).href)) as {
    addSdkBundleToBuild?: (options: { root: string }) => Promise<SdkBundleNames | null>;
  };
  return addSdkBundleToBuild ? addSdkBundleToBuild({ root }) : null;
}

/**
 * The file a package's export resolves to for `import`, from the website in `root`, or null when
 * it isn't installed or doesn't export it.
 */
function websiteModule(root: string, name: string, subpath: string): string | null {
  for (let dir = resolve(root); ; dir = dirname(dir)) {
    const manifestPath = join(dir, "node_modules", name, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        exports?: Record<string, unknown>;
      };
      let target = manifest.exports?.[subpath];
      while (target && typeof target === "object")
        target =
          (target as Record<string, unknown>).import ?? (target as Record<string, unknown>).default;
      return typeof target === "string" ? join(dirname(manifestPath), target) : null;
    }
    if (dirname(dir) === dir) return null;
  }
}
