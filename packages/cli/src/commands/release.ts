import { spawnSync } from "node:child_process";

import * as p from "@clack/prompts";
import { object } from "@optique/core/constructs";
import { command, constant } from "@optique/core/primitives";

export const parser = command(
  "release",
  object({
    command: constant("release" as const),
  }),
);

export function handler(): never {
  p.intro("camox release");

  if (!process.env.CAMOX_DEPLOY_TOKEN) {
    p.log.error("CAMOX_DEPLOY_TOKEN is required to release to Live.");
    process.exit(1);
  }

  p.log.info("Building and syncing definitions to Live...");

  const executable = process.platform === "win32" ? "vp.cmd" : "vp";
  const result = spawnSync(executable, ["build"], {
    stdio: "inherit",
    env: {
      ...process.env,
      CAMOX_INTERNAL_RELEASE: "1",
    },
  });

  if (result.error) {
    p.log.error(`Could not start the release build: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    p.log.error("Release failed.");
    process.exit(result.status ?? 1);
  }

  p.outro("Release prepared successfully.");
  process.exit(0);
}
