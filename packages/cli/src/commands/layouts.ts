import { object, or } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { optional } from "@optique/core/modifiers";
import { command, constant, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

import { dispatch } from "../lib/dispatch";
import type { OutputMode } from "../lib/output";
import { cwdFlag } from "../lib/runtime-options";

const projectFlag = optional(option("--project", string({ metavar: "SLUG" })));
const jsonFlag = option("--json");

const list = command(
  "list",
  object({
    command: constant("layouts.list" as const),
    cwd: cwdFlag,
    project: projectFlag,
    json: jsonFlag,
  }),
  {
    description: message`List layout metadata. Use layouts get --layout-id NAME with a returned layoutId to discover its blocks.`,
  },
);

const get = command(
  "get",
  object({
    command: constant("layouts.get" as const),
    layoutId: option("--layout-id", string({ metavar: "NAME" })),
    cwd: cwdFlag,
    project: projectFlag,
    json: jsonFlag,
  }),
  {
    description: message`Inspect a layout and its blocks, including shared navigation and footer IDs for blocks get and blocks edit. A layout is named by the layoutId its code gives it, as listed by layouts list.`,
  },
);

export const parser = command("layouts", or(list, get));

type CommonFlags = {
  cwd?: string;
  project?: string;
  json: boolean;
};

type Args =
  | ({ command: "layouts.list" } & CommonFlags)
  | ({ command: "layouts.get"; layoutId: string } & CommonFlags);

export async function handler(args: Args): Promise<never> {
  const outputMode: OutputMode = args.json ? "json" : "auto";
  const cwd = args.cwd;
  const projectFlag = args.project;
  switch (args.command) {
    case "layouts.list":
      return dispatch({
        toolName: "listLayouts",
        args: {},
        cwd,
        projectFlag,
        outputMode,
      });
    case "layouts.get":
      return dispatch({
        toolName: "getLayout",
        args: { layoutId: args.layoutId },
        cwd,
        projectFlag,
        outputMode,
      });
  }
}
