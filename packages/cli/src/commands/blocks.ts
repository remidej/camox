import { readFile } from "node:fs/promises";

import { object, or } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { multiple, optional } from "@optique/core/modifiers";
import { command, constant, option } from "@optique/core/primitives";
import { choice, string } from "@optique/core/valueparser";

import { dispatch } from "../lib/dispatch";
import { type OutputMode, asCliError, parseJsonFlag, printError } from "../lib/output";
import { cwdFlag } from "../lib/runtime-options";
import { uuidv7 } from "../lib/uuidv7";

const projectFlag = optional(option("--project", string({ metavar: "SLUG" })));
const jsonFlag = option("--json");
const fieldFileFlag = multiple(
  option("--field-file", string({ metavar: "NAME=PATH" }), {
    description: message`Set the string field NAME to the raw contents of the file at PATH, without JSON escaping. Repeat to set several fields. Merges with --content; when both set a field, the file wins.`,
  }),
);

const types = command(
  "types",
  object({
    command: constant("blocks.types" as const),
    cwd: cwdFlag,
    project: projectFlag,
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
    json: jsonFlag,
  }),
);

const get = command(
  "get",
  object({
    command: constant("blocks.get" as const),
    id: option("--id", uuidv7()),
    cwd: cwdFlag,
    project: projectFlag,
    json: jsonFlag,
  }),
);

const getMany = command(
  "get-many",
  object({
    command: constant("blocks.get-many" as const),
    id: multiple(option("--id", uuidv7()), { min: 1 }),
    cwd: cwdFlag,
    project: projectFlag,
    json: jsonFlag,
  }),
);

const create = command(
  "create",
  object({
    command: constant("blocks.create" as const),
    pageId: option("--page-id", uuidv7()),
    type: option("--type", string({ metavar: "TYPE" })),
    content: optional(option("--content", string({ metavar: "JSON" }))),
    fieldFile: fieldFileFlag,
    settings: optional(option("--settings", string({ metavar: "JSON" }))),
    position: optional(
      option("--position", choice(["first", "last"] as const, { metavar: "WHERE" })),
    ),
    afterId: optional(option("--after-id", uuidv7())),
    beforeId: optional(option("--before-id", uuidv7())),
    afterPosition: optional(option("--after-position", string({ metavar: "POS" }))),
    beforePosition: optional(option("--before-position", string({ metavar: "POS" }))),
    cwd: cwdFlag,
    project: projectFlag,
    json: jsonFlag,
  }),
);

const edit = command(
  "edit",
  object({
    command: constant("blocks.edit" as const),
    id: option("--id", uuidv7()),
    content: optional(option("--content", string({ metavar: "JSON" }))),
    fieldFile: fieldFileFlag,
    settings: optional(option("--settings", string({ metavar: "JSON" }))),
    cwd: cwdFlag,
    project: projectFlag,
    json: jsonFlag,
  }),
);

const move = command(
  "move",
  object({
    command: constant("blocks.move" as const),
    id: option("--id", uuidv7()),
    position: optional(
      option("--position", choice(["first", "last"] as const, { metavar: "WHERE" })),
    ),
    afterId: optional(option("--after-id", uuidv7())),
    beforeId: optional(option("--before-id", uuidv7())),
    afterPosition: optional(option("--after-position", string({ metavar: "POS" }))),
    beforePosition: optional(option("--before-position", string({ metavar: "POS" }))),
    cwd: cwdFlag,
    project: projectFlag,
    json: jsonFlag,
  }),
);

const del = command(
  "delete",
  object({
    command: constant("blocks.delete" as const),
    id: option("--id", uuidv7()),
    cwd: cwdFlag,
    project: projectFlag,
    json: jsonFlag,
  }),
);

export const parser = command("blocks", or(types, describe, get, getMany, create, edit, move, del));

type CommonFlags = { cwd?: string; project?: string; json: boolean };

type PositioningFlags = {
  position?: "first" | "last";
  afterId?: string;
  beforeId?: string;
  afterPosition?: string;
  beforePosition?: string;
};

type Args =
  | ({ command: "blocks.types" } & CommonFlags)
  | ({ command: "blocks.describe"; type: readonly string[] } & CommonFlags)
  | ({ command: "blocks.get"; id: string } & CommonFlags)
  | ({ command: "blocks.get-many"; id: readonly string[] } & CommonFlags)
  | ({
      command: "blocks.create";
      pageId: string;
      type: string;
      content?: string;
      fieldFile: readonly string[];
      settings?: string;
    } & PositioningFlags &
      CommonFlags)
  | ({
      command: "blocks.edit";
      id: string;
      content?: string;
      fieldFile: readonly string[];
      settings?: string;
    } & CommonFlags)
  | ({ command: "blocks.move"; id: string } & PositioningFlags & CommonFlags)
  | ({ command: "blocks.delete"; id: string } & CommonFlags);

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

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { __cliError: { code, message } });
}

/**
 * Build block content from `--content` and repeated `--field-file NAME=PATH`
 * flags. Every file is read before anything is sent, so a bad path fails the
 * whole command without a partial write. Files win over `--content` on conflicts.
 */
async function resolveContent(
  rawContent: string | undefined,
  fieldFiles: readonly string[],
): Promise<unknown> {
  const content = rawContent !== undefined ? parseJsonFlag("--content", rawContent) : undefined;
  if (fieldFiles.length === 0) return content;
  if (
    content !== undefined &&
    (typeof content !== "object" || content === null || Array.isArray(content))
  ) {
    fail("INVALID_ARGS", "--content must be a JSON object when combined with --field-file.");
  }
  const merged: Record<string, unknown> = { ...(content as Record<string, unknown> | undefined) };
  for (const entry of fieldFiles) {
    const separator = entry.indexOf("=");
    const name = entry.slice(0, separator);
    const path = entry.slice(separator + 1);
    if (separator <= 0 || !path) {
      fail("INVALID_ARGS", `Invalid --field-file "${entry}". Use --field-file NAME=PATH.`);
    }
    try {
      merged[name] = await readFile(path, "utf8");
    } catch (err) {
      const reason = err instanceof Error && "code" in err ? String(err.code) : String(err);
      fail("FILE_READ_ERROR", `Cannot read --field-file ${name}=${path} (${reason}).`);
    }
  }
  return merged;
}

export async function handler(args: Args): Promise<never> {
  const outputMode: OutputMode = args.json ? "json" : "auto";
  const cwd = args.cwd;
  const projectFlag = args.project;

  try {
    switch (args.command) {
      case "blocks.types":
        return dispatch({
          toolName: "listBlockTypes",
          args: {},
          cwd,
          projectFlag,
          outputMode,
        });
      case "blocks.describe":
        return dispatch({
          toolName: "describeBlockTypes",
          args: { types: [...args.type] },
          cwd,
          projectFlag,
          outputMode,
        });
      case "blocks.get":
        return dispatch({
          toolName: "getBlock",
          args: { id: args.id },
          cwd,
          projectFlag,
          outputMode,
        });
      case "blocks.get-many":
        return dispatch({
          toolName: "getBlocks",
          args: { ids: [...args.id] },
          cwd,
          projectFlag,
          outputMode,
        });
      case "blocks.create": {
        if (args.content === undefined && args.fieldFile.length === 0) {
          printError({ code: "INVALID_ARGS", message: "Pass --content, --field-file, or both." });
          process.exit(2);
        }
        const content = await resolveContent(args.content, args.fieldFile);
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
          outputMode,
        });
      }
      case "blocks.edit": {
        const content = await resolveContent(args.content, args.fieldFile);
        const settings =
          args.settings !== undefined ? parseJsonFlag("--settings", args.settings) : undefined;
        return dispatch({
          toolName: "editBlock",
          args: { id: args.id, content, settings },
          cwd,
          projectFlag,
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
          outputMode,
        });
      }
      case "blocks.delete":
        return dispatch({
          toolName: "deleteBlock",
          args: { id: args.id },
          cwd,
          projectFlag,
          outputMode,
        });
    }
  } catch (err) {
    printError(asCliError(err));
    process.exit(1);
  }
}
