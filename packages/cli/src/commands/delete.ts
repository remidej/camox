import * as p from "@clack/prompts";
import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { command, constant, option } from "@optique/core/primitives";

import { callToolResult } from "../lib/dispatch";
import { type OutputMode, isJsonMode, printError, printResult } from "../lib/output";
import { cwdFlag, projectFlag } from "../lib/runtime-options";

// Deleting empties the development draft; Live is untouched (ADR 0010).

export const parser = command(
  "delete",
  object({
    command: constant("delete" as const),
    yes: option("--yes", "-y", {
      description: message`Delete without asking for confirmation.`,
    }),
    cwd: cwdFlag,
    project: projectFlag,
    json: option("--json"),
  }),
  {
    description: message`Delete every change in your development draft. Live is untouched.`,
  },
);

type Args = {
  command: "delete";
  yes: boolean;
  cwd?: string;
  project?: string;
  json: boolean;
};

const WARNING = "This deletes every change in your development draft and can't be undone.";

async function confirmed(): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    printError({
      code: "CONFIRMATION_REQUIRED",
      message: `${WARNING} Re-run with --yes to confirm.`,
    });
    process.exit(2);
  }
  const answer = await p.confirm({
    message: `${WARNING} Delete it?`,
    initialValue: false,
  });
  return answer === true;
}

export async function handler(args: Args): Promise<never> {
  const outputMode: OutputMode = args.json ? "json" : "auto";
  if (!args.yes && !(await confirmed())) {
    printError({ code: "CANCELLED", message: "Nothing was deleted." });
    process.exit(1);
  }

  const result = await callToolResult({
    toolName: "deleteDraft",
    args: {},
    cwd: args.cwd,
    projectFlag: args.project,
  });
  if (isJsonMode(outputMode)) printResult(result, outputMode);
  else process.stdout.write("Deleted every change in your development draft.\n");
  process.exit(0);
}
