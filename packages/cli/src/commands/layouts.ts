import { object, or } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { optional } from "@optique/core/modifiers";
import { command, constant, option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";

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
  {
    description: message`List layout metadata. Use layouts get --id ID with a returned numeric id to discover its block instances.`,
  },
);

const get = command(
  "get",
  object({
    command: constant("layouts.get" as const),
    id: option("--id", integer({ min: 1, metavar: "ID" })),
    live: option("--live"),
    cwd: cwdFlag,
    project: projectFlag,
    production: productionFlag,
    json: jsonFlag,
  }),
  {
    description: message`Inspect a layout and its block instances, including shared navigation and footer IDs for blocks get and blocks edit. Use the numeric id from layouts list, not the code-defined layoutId. Reads the draft by default; --live reads the published snapshot. --production selects the environment, not the published state.`,
  },
);

export const parser = command("layouts", or(list, get));

type CommonFlags = {
  cwd?: string;
  project?: string;
  production: boolean;
  json: boolean;
};

type Args =
  | ({ command: "layouts.list" } & CommonFlags)
  | ({ command: "layouts.get"; id: number; live: boolean } & CommonFlags);

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
    case "layouts.get":
      return dispatch({
        toolName: "getLayout",
        args: { id: args.id, source: args.live ? "live" : "draft" },
        cwd,
        projectFlag,
        production,
        outputMode,
      });
  }
}
