import { spawnSync } from "node:child_process";

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

export function handler(args: Args): never {
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

  p.outro(args.dryRun ? "Dry run built successfully." : "Release prepared successfully.");
  process.exit(0);
}
