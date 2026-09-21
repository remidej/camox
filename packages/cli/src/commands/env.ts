import { object, or } from "@optique/core/constructs";
import { optional } from "@optique/core/modifiers";
import { command, constant, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

import { dispatch } from "../lib/dispatch";
import { type OutputMode, printError } from "../lib/output";
import { cwdFlag } from "../lib/runtime-options";

const projectFlag = optional(option("--project", string({ metavar: "SLUG" })));
const jsonFlag = option("--json");
const yesFlag = option("--yes", "-y");

const check = command(
  "check",
  object({
    command: constant("env.check" as const),
    cwd: cwdFlag,
    project: projectFlag,
    json: jsonFlag,
  }),
);

const push = command(
  "push",
  object({
    command: constant("env.push" as const),
    yes: yesFlag,
    cwd: cwdFlag,
    project: projectFlag,
    json: jsonFlag,
  }),
);

const pull = command(
  "pull",
  object({
    command: constant("env.pull" as const),
    yes: yesFlag,
    cwd: cwdFlag,
    project: projectFlag,
    json: jsonFlag,
  }),
);

export const parser = command("env", or(check, push, pull));

type CommonFlags = { cwd?: string; project?: string; json: boolean };

type Args =
  | ({ command: "env.check" } & CommonFlags)
  | ({ command: "env.push"; yes: boolean } & CommonFlags)
  | ({ command: "env.pull"; yes: boolean } & CommonFlags);

export async function handler(args: Args): Promise<never> {
  const outputMode: OutputMode = args.json ? "json" : "auto";
  const cwd = args.cwd;
  const projectFlag = args.project;

  switch (args.command) {
    case "env.check":
      return dispatch({
        toolName: "checkEnvironmentCompatibility",
        args: {},
        cwd,
        projectFlag,
        outputMode,
      });

    case "env.push":
    case "env.pull": {
      const isPush = args.command === "env.push";
      if (!args.yes) {
        const source = isPush ? "your dev environment" : "production";
        const target = isPush ? "production" : "your dev environment";
        printError({
          code: "CONFIRMATION_REQUIRED",
          message:
            `This will replace all content in ${target} with ${source}. ` +
            "This action cannot be undone. Re-run with --yes to confirm.",
        });
        process.exit(2);
      }
      return dispatch({
        toolName: "replicateEnvironment",
        args: { direction: isPush ? "push" : "pull" },
        cwd,
        projectFlag,
        outputMode,
      });
    }
  }
}
