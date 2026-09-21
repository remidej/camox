import { object, or } from "@optique/core/constructs";
import { optional } from "@optique/core/modifiers";
import { command, constant, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

import { dispatch } from "../lib/dispatch";
import type { OutputMode } from "../lib/output";
import { cwdFlag } from "../lib/runtime-options";

const projectFlag = optional(option("--project", string({ metavar: "SLUG" })));
const jsonFlag = option("--json");
const productionFlag = option("--production");

const list = command(
  "list",
  object({
    command: constant("layouts.list" as const),
    cwd: cwdFlag,
    project: projectFlag,
    production: productionFlag,
    json: jsonFlag,
  }),
);

export const parser = command("layouts", or(list));

type Args = {
  command: "layouts.list";
  cwd?: string;
  project?: string;
  production: boolean;
  json: boolean;
};

export async function handler(args: Args): Promise<never> {
  const outputMode: OutputMode = args.json ? "json" : "auto";
  const cwd = args.cwd;
  const projectFlag = args.project;
  const production = args.production;
  switch (args.command) {
    case "layouts.list":
      return dispatch({
        toolName: "listLayouts",
        args: {},
        cwd,
        projectFlag,
        production,
        outputMode,
      });
  }
}
