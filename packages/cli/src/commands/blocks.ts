import { object, or } from "@optique/core/constructs";
import { multiple, optional } from "@optique/core/modifiers";
import { command, constant, option } from "@optique/core/primitives";
import { choice, integer, string } from "@optique/core/valueparser";

import { dispatch } from "../lib/dispatch";
import { type OutputMode, asCliError, parseJsonFlag, printError } from "../lib/output";
import { cwdFlag } from "../lib/runtime-options";

const projectFlag = optional(option("--project", string({ metavar: "SLUG" })));
const jsonFlag = option("--json");
const productionFlag = option("--production");
// `--live` flips read commands from draft (default) to the published snapshot.
const liveFlag = option("--live");

const types = command(
  "types",
  object({
    command: constant("blocks.types" as const),
    cwd: cwdFlag,
    project: projectFlag,
    production: productionFlag,
    json: jsonFlag,
  }),
);

const describe = command(
  "describe",
  object({
    command: constant("blocks.describe" as const),
    type: multiple(option("--type", string({ metavar: "TYPE" })), { min: 1 }),
    cwd: cwdFlag,
    project: projectFlag,
    production: productionFlag,
    json: jsonFlag,
  }),
);

const get = command(
  "get",
  object({
    command: constant("blocks.get" as const),
    id: option("--id", integer({ metavar: "ID" })),
    live: liveFlag,
    cwd: cwdFlag,
    project: projectFlag,
    production: productionFlag,
    json: jsonFlag,
  }),
);

const getMany = command(
  "get-many",
  object({
    command: constant("blocks.get-many" as const),
    id: multiple(option("--id", integer({ metavar: "ID" })), { min: 1 }),
    live: liveFlag,
    cwd: cwdFlag,
    project: projectFlag,
    production: productionFlag,
    json: jsonFlag,
  }),
);

const create = command(
  "create",
  object({
    command: constant("blocks.create" as const),
    pageId: option("--page-id", integer({ metavar: "ID" })),
    type: option("--type", string({ metavar: "TYPE" })),
    content: option("--content", string({ metavar: "JSON" })),
    settings: optional(option("--settings", string({ metavar: "JSON" }))),
    position: optional(
      option("--position", choice(["first", "last"] as const, { metavar: "WHERE" })),
    ),
    afterId: optional(option("--after-id", integer({ metavar: "ID" }))),
    beforeId: optional(option("--before-id", integer({ metavar: "ID" }))),
    afterPosition: optional(option("--after-position", string({ metavar: "POS" }))),
    beforePosition: optional(option("--before-position", string({ metavar: "POS" }))),
    cwd: cwdFlag,
    project: projectFlag,
    production: productionFlag,
    json: jsonFlag,
  }),
);

const edit = command(
  "edit",
  object({
    command: constant("blocks.edit" as const),
    id: option("--id", integer({ metavar: "ID" })),
    content: optional(option("--content", string({ metavar: "JSON" }))),
    settings: optional(option("--settings", string({ metavar: "JSON" }))),
    cwd: cwdFlag,
    project: projectFlag,
    production: productionFlag,
    json: jsonFlag,
  }),
);

const move = command(
  "move",
  object({
    command: constant("blocks.move" as const),
    id: option("--id", integer({ metavar: "ID" })),
    position: optional(
      option("--position", choice(["first", "last"] as const, { metavar: "WHERE" })),
    ),
    afterId: optional(option("--after-id", integer({ metavar: "ID" }))),
    beforeId: optional(option("--before-id", integer({ metavar: "ID" }))),
    afterPosition: optional(option("--after-position", string({ metavar: "POS" }))),
    beforePosition: optional(option("--before-position", string({ metavar: "POS" }))),
    cwd: cwdFlag,
    project: projectFlag,
    production: productionFlag,
    json: jsonFlag,
  }),
);

const del = command(
  "delete",
  object({
    command: constant("blocks.delete" as const),
    id: option("--id", integer({ metavar: "ID" })),
    cwd: cwdFlag,
    project: projectFlag,
    production: productionFlag,
    json: jsonFlag,
  }),
);

export const parser = command("blocks", or(types, describe, get, getMany, create, edit, move, del));

type CommonFlags = { cwd?: string; project?: string; production: boolean; json: boolean };

type PositioningFlags = {
  position?: "first" | "last";
  afterId?: number;
  beforeId?: number;
  afterPosition?: string;
  beforePosition?: string;
};

type Args =
  | ({ command: "blocks.types" } & CommonFlags)
  | ({ command: "blocks.describe"; type: readonly string[] } & CommonFlags)
  | ({ command: "blocks.get"; id: number; live: boolean } & CommonFlags)
  | ({ command: "blocks.get-many"; id: readonly number[]; live: boolean } & CommonFlags)
  | ({
      command: "blocks.create";
      pageId: number;
      type: string;
      content: string;
      settings?: string;
    } & PositioningFlags &
      CommonFlags)
  | ({
      command: "blocks.edit";
      id: number;
      content?: string;
      settings?: string;
    } & CommonFlags)
  | ({ command: "blocks.move"; id: number } & PositioningFlags & CommonFlags)
  | ({ command: "blocks.delete"; id: number } & CommonFlags);

const POSITIONING_FLAGS = [
  ["position", "--position"],
  ["afterId", "--after-id"],
  ["beforeId", "--before-id"],
  ["afterPosition", "--after-position"],
  ["beforePosition", "--before-position"],
] as const;

/**
 * Both `create` and `move` accept multiple positioning inputs, but only one is
 * meaningful per call. The server will reject conflicts, but we surface the
 * mistake earlier (and with friendlier wording) by checking on the client.
 */
function collectPositioningArgs(args: PositioningFlags): {
  used: string[];
  toolArgs: PositioningFlags;
} {
  const used: string[] = [];
  const toolArgs: PositioningFlags = {};
  for (const [key, flag] of POSITIONING_FLAGS) {
    const value = args[key];
    if (value === undefined) continue;
    used.push(flag);
    Object.assign(toolArgs, { [key]: value });
  }
  return { used, toolArgs };
}

export async function handler(args: Args): Promise<never> {
  const outputMode: OutputMode = args.json ? "json" : "auto";
  const cwd = args.cwd;
  const projectFlag = args.project;
  const production = args.production;

  try {
    switch (args.command) {
      case "blocks.types":
        return dispatch({
          toolName: "listBlockTypes",
          args: {},
          cwd,
          projectFlag,
          production,
          outputMode,
        });
      case "blocks.describe":
        return dispatch({
          toolName: "describeBlockTypes",
          args: { types: [...args.type] },
          cwd,
          projectFlag,
          production,
          outputMode,
        });
      case "blocks.get":
        return dispatch({
          toolName: "getBlock",
          args: { id: args.id, source: args.live ? "live" : "draft" },
          cwd,
          projectFlag,
          production,
          outputMode,
        });
      case "blocks.get-many":
        return dispatch({
          toolName: "getBlocks",
          args: { ids: [...args.id], source: args.live ? "live" : "draft" },
          cwd,
          projectFlag,
          production,
          outputMode,
        });
      case "blocks.create": {
        const content = parseJsonFlag("--content", args.content);
        const settings =
          args.settings !== undefined ? parseJsonFlag("--settings", args.settings) : undefined;
        const { used, toolArgs } = collectPositioningArgs(args);
        if (used.length > 1) {
          printError({
            code: "INVALID_ARGS",
            message: `Pass at most one positioning flag — got: ${used.join(", ")}.`,
          });
          process.exit(2);
        }
        return dispatch({
          toolName: "createBlock",
          args: {
            pageId: args.pageId,
            type: args.type,
            content,
            settings,
            ...toolArgs,
          },
          cwd,
          projectFlag,
          production,
          outputMode,
        });
      }
      case "blocks.edit": {
        const content =
          args.content !== undefined ? parseJsonFlag("--content", args.content) : undefined;
        const settings =
          args.settings !== undefined ? parseJsonFlag("--settings", args.settings) : undefined;
        return dispatch({
          toolName: "editBlock",
          args: { id: args.id, content, settings },
          cwd,
          projectFlag,
          production,
          outputMode,
        });
      }
      case "blocks.move": {
        const { used, toolArgs } = collectPositioningArgs(args);
        if (used.length === 0) {
          printError({
            code: "INVALID_ARGS",
            message:
              "Pass a positioning flag — one of --position, --after-id, --before-id, --after-position, --before-position. Use `--position last` to move a block to the end of the page.",
          });
          process.exit(2);
        }
        if (used.length > 1) {
          printError({
            code: "INVALID_ARGS",
            message: `Pass at most one positioning flag — got: ${used.join(", ")}.`,
          });
          process.exit(2);
        }
        return dispatch({
          toolName: "moveBlock",
          args: { id: args.id, ...toolArgs },
          cwd,
          projectFlag,
          production,
          outputMode,
        });
      }
      case "blocks.delete":
        return dispatch({
          toolName: "deleteBlock",
          args: { id: args.id },
          cwd,
          projectFlag,
          production,
          outputMode,
        });
    }
  } catch (err) {
    printError(asCliError(err));
    process.exit(1);
  }
}
