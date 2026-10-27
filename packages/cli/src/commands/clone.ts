import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import * as p from "@clack/prompts";
import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { optional } from "@optique/core/modifiers";
import { argument, command, constant } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

import { createCodeReadToken } from "../lib/api";
import { getOrAuthenticate } from "../lib/auth";
import { credentialHelperConfig } from "../lib/git-credential";

export const parser = command(
  "clone",
  object({
    command: constant("clone" as const),
    project: argument(string({ metavar: "PROJECT" }), {
      description: message`The project's Project Slug or Project ID.`,
    }),
    directory: optional(
      argument(string({ metavar: "DIRECTORY" }), {
        description: message`Where to clone it. Defaults to its Project Slug.`,
      }),
    ),
  }),
  {
    description: message`Clone a project's code, for a project whose code can be worked on outside Camox.`,
  },
);

type Args = { command: "clone"; project: string; directory?: string };

export async function handler(args: Args): Promise<never> {
  p.intro(`camox clone ${args.project}`);
  const { token } = await getOrAuthenticate().catch(() => {
    p.log.error("Authentication failed.");
    process.exit(1);
  });

  let access: Awaited<ReturnType<typeof createCodeReadToken>>;
  try {
    access = await createCodeReadToken(token, args.project);
  } catch (error) {
    p.log.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const directory = resolve(args.directory ?? access.projectSlug);
  // `--config` lands in the clone's own config before Git fetches anything, so the helper
  // answers the clone's own requests too.
  const config = credentialHelperConfig(access.remote).flatMap(([key, value]) => [
    "--config",
    `${key}=${value}`,
  ]);
  const cloned = spawnSync("git", ["clone", ...config, access.remote, directory], {
    stdio: "inherit",
  });
  if (cloned.error || cloned.status !== 0) {
    p.log.error(
      cloned.error ? `Could not run Git: ${cloned.error.message}` : "Git couldn't clone it.",
    );
    process.exit(1);
  }

  p.log.info("Installing dependencies...");
  const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const installed = spawnSync(executable, ["install"], { cwd: directory, stdio: "inherit" });
  if (installed.error || installed.status !== 0) {
    p.log.error(`Cloned into ${directory}, but installing its dependencies failed.`);
    process.exit(1);
  }

  p.outro(`Cloned into ${directory}.`);
  process.exit(0);
}
