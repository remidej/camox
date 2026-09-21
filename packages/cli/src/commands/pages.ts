import { object, or } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { optional } from "@optique/core/modifiers";
import { command, constant, option } from "@optique/core/primitives";
import { choice, integer, string } from "@optique/core/valueparser";

import { dispatch } from "../lib/dispatch";
import { type OutputMode, printError } from "../lib/output";
import { cwdFlag } from "../lib/runtime-options";

const projectFlag = optional(option("--project", string({ metavar: "SLUG" })));
const jsonFlag = option("--json");
const productionFlag = option("--production");
// `--live` flips read commands from the draft (default) to the published
// snapshot. Orthogonal to `--production` (which selects the environment).
const liveFlag = option("--live");

const list = command(
  "list",
  object({
    command: constant("pages.list" as const),
    cwd: cwdFlag,
    project: projectFlag,
    production: productionFlag,
    json: jsonFlag,
  }),
);

const get = command(
  "get",
  object({
    command: constant("pages.get" as const),
    id: optional(option("--id", integer({ metavar: "ID" }))),
    path: optional(option("--path", string({ metavar: "PATH" }))),
    live: liveFlag,
    cwd: cwdFlag,
    project: projectFlag,
    production: productionFlag,
    json: jsonFlag,
  }),
);

const publish = command(
  "publish",
  object({
    command: constant("pages.publish" as const),
    id: optional(option("--id", integer({ metavar: "ID" }))),
    path: optional(option("--path", string({ metavar: "PATH" }))),
    // `--no-layout` opts out of the default layout cascade. The service no-ops
    // the layout publish when there are no pending changes, so the cascade is
    // safe to leave on by default.
    noLayout: option("--no-layout"),
    cwd: cwdFlag,
    project: projectFlag,
    production: productionFlag,
    json: jsonFlag,
  }),
);

const unpublish = command(
  "unpublish",
  object({
    command: constant("pages.unpublish" as const),
    id: optional(option("--id", integer({ metavar: "ID" }))),
    path: optional(option("--path", string({ metavar: "PATH" }))),
    cwd: cwdFlag,
    project: projectFlag,
    production: productionFlag,
    json: jsonFlag,
  }),
);

const discardChanges = command(
  "discard-changes",
  object({
    command: constant("pages.discard-changes" as const),
    id: optional(option("--id", integer({ metavar: "ID" }))),
    path: optional(option("--path", string({ metavar: "PATH" }))),
    cwd: cwdFlag,
    project: projectFlag,
    production: productionFlag,
    json: jsonFlag,
  }),
);

const create = command(
  "create",
  object({
    command: constant("pages.create" as const),
    nickname: optional(option("--nickname", string({ metavar: "TEXT" }))),
    pathSegment: option("--path-segment", string({ metavar: "SEGMENT" })),
    layoutId: option("--layout-id", integer({ metavar: "ID" })),
    parentPageId: optional(option("--parent-page-id", integer({ metavar: "ID" }))),
    cwd: cwdFlag,
    project: projectFlag,
    production: productionFlag,
    json: jsonFlag,
  }),
);

const update = command(
  "update",
  object({
    command: constant("pages.update" as const),
    id: optional(option("--id", integer({ min: 1, metavar: "ID" }))),
    path: optional(option("--path", string({ metavar: "PATH" }))),
    metaTitle: optional(
      option("--meta-title", string({ metavar: "TEXT" }), {
        description: message`Set the SEO title. An empty string clears it. Disables automatic SEO for both fields.`,
      }),
    ),
    metaDescription: optional(
      option("--meta-description", string({ metavar: "TEXT" }), {
        description: message`Set the SEO description. An empty string clears it. Disables automatic SEO for both fields.`,
      }),
    ),
    aiSeo: optional(
      option("--ai-seo", choice(["on", "off"] as const), {
        description: message`Enable or disable automatic SEO. Enabling schedules asynchronous generation; it cannot be combined with manual metadata. Disabling preserves current metadata.`,
      }),
    ),
    nickname: optional(option("--nickname", string({ metavar: "TEXT" }))),
    pathSegment: optional(option("--path-segment", string({ metavar: "SEGMENT" }))),
    parentPageId: optional(option("--parent-page-id", integer({ metavar: "ID" }))),
    cwd: cwdFlag,
    project: projectFlag,
    production: productionFlag,
    json: jsonFlag,
  }),
  {
    description: message`Update a page draft, including in --production. Pass exactly one of --id or --path and at least one update field. Omitted fields are preserved. Publish separately with pages publish. Example: camox pages update --path /about --meta-title "About us" --meta-description "Meet the team". Read metadata with pages get; add --live for published metadata.`,
  },
);

const setLayout = command(
  "set-layout",
  object({
    command: constant("pages.set-layout" as const),
    id: option("--id", integer({ metavar: "ID" })),
    layoutId: option("--layout-id", integer({ metavar: "ID" })),
    cwd: cwdFlag,
    project: projectFlag,
    production: productionFlag,
    json: jsonFlag,
  }),
);

const del = command(
  "delete",
  object({
    command: constant("pages.delete" as const),
    id: option("--id", integer({ metavar: "ID" })),
    cwd: cwdFlag,
    project: projectFlag,
    production: productionFlag,
    json: jsonFlag,
  }),
);

export const parser = command(
  "pages",
  or(list, get, create, update, setLayout, del, publish, unpublish, discardChanges),
);

type CommonFlags = { cwd?: string; project?: string; production: boolean; json: boolean };

type Args =
  | ({ command: "pages.list" } & CommonFlags)
  | ({ command: "pages.get"; id?: number; path?: string; live: boolean } & CommonFlags)
  | ({
      command: "pages.create";
      nickname?: string;
      pathSegment: string;
      layoutId: number;
      parentPageId?: number;
    } & CommonFlags)
  | ({
      command: "pages.update";
      id?: number;
      path?: string;
      metaTitle?: string;
      metaDescription?: string;
      aiSeo?: "on" | "off";
      nickname?: string;
      pathSegment?: string;
      parentPageId?: number;
    } & CommonFlags)
  | ({ command: "pages.set-layout"; id: number; layoutId: number } & CommonFlags)
  | ({ command: "pages.delete"; id: number } & CommonFlags)
  | ({
      command: "pages.publish";
      id?: number;
      path?: string;
      noLayout: boolean;
    } & CommonFlags)
  | ({
      command: "pages.unpublish" | "pages.discard-changes";
      id?: number;
      path?: string;
    } & CommonFlags);

export async function handler(args: Args): Promise<never> {
  const outputMode: OutputMode = args.json ? "json" : "auto";
  const cwd = args.cwd;
  const projectFlag = args.project;
  const production = args.production;

  switch (args.command) {
    case "pages.list":
      return dispatch({
        toolName: "listPages",
        args: {},
        cwd,
        projectFlag,
        production,
        outputMode,
      });
    case "pages.get": {
      if ((args.id == null) === (args.path == null)) {
        printError({
          code: "INVALID_ARGS",
          message: "Pass exactly one of --id or --path.",
        });
        process.exit(2);
      }
      const target = args.id != null ? { id: args.id } : { path: args.path };
      // Read draft by default; `--live` flips to the published snapshot. The
      // tool errors when the page has never been published.
      const toolArgs = { ...target, source: args.live ? "live" : "draft" };
      return dispatch({
        toolName: "getPage",
        args: toolArgs,
        cwd,
        projectFlag,
        production,
        outputMode,
      });
    }
    case "pages.create":
      return dispatch({
        toolName: "createPage",
        args: {
          nickname: args.nickname,
          pathSegment: args.pathSegment,
          layoutId: args.layoutId,
          parentPageId: args.parentPageId,
        },
        cwd,
        projectFlag,
        production,
        outputMode,
      });
    case "pages.update": {
      if ((args.id == null) === (args.path == null)) {
        printError({ code: "INVALID_ARGS", message: "Pass exactly one of --id or --path." });
        process.exit(2);
      }
      if (
        args.aiSeo === "on" &&
        (args.metaTitle !== undefined || args.metaDescription !== undefined)
      ) {
        printError({
          code: "INVALID_ARGS",
          message: "Cannot enable automatic SEO alongside manual metadata.",
        });
        process.exit(2);
      }
      if (
        [
          args.nickname,
          args.pathSegment,
          args.parentPageId,
          args.metaTitle,
          args.metaDescription,
          args.aiSeo,
        ].every((value) => value === undefined)
      ) {
        printError({ code: "INVALID_ARGS", message: "Pass at least one field to update." });
        process.exit(2);
      }
      return dispatch({
        toolName: "updatePage",
        args: {
          ...(args.id != null ? { id: args.id } : { path: args.path }),
          metaTitle: args.metaTitle,
          metaDescription: args.metaDescription,
          aiSeoEnabled: args.aiSeo === undefined ? undefined : args.aiSeo === "on",
          nickname: args.nickname,
          pathSegment: args.pathSegment,
          parentPageId: args.parentPageId,
        },
        cwd,
        projectFlag,
        production,
        outputMode,
      });
    }
    case "pages.set-layout":
      return dispatch({
        toolName: "setPageLayout",
        args: { id: args.id, layoutId: args.layoutId },
        cwd,
        projectFlag,
        production,
        outputMode,
      });
    case "pages.delete":
      return dispatch({
        toolName: "deletePage",
        args: { id: args.id },
        cwd,
        projectFlag,
        production,
        outputMode,
      });
    case "pages.publish": {
      if ((args.id == null) === (args.path == null)) {
        printError({
          code: "INVALID_ARGS",
          message: "Pass exactly one of --id or --path.",
        });
        process.exit(2);
      }
      const target = args.id != null ? { id: args.id } : { path: args.path };
      return dispatch({
        toolName: "publishPage",
        args: { ...target, alsoPublishLayout: !args.noLayout },
        cwd,
        projectFlag,
        production,
        outputMode,
      });
    }
    case "pages.unpublish": {
      if ((args.id == null) === (args.path == null)) {
        printError({
          code: "INVALID_ARGS",
          message: "Pass exactly one of --id or --path.",
        });
        process.exit(2);
      }
      const target = args.id != null ? { id: args.id } : { path: args.path };
      return dispatch({
        toolName: "unpublishPage",
        args: target,
        cwd,
        projectFlag,
        production,
        outputMode,
      });
    }
    case "pages.discard-changes": {
      if ((args.id == null) === (args.path == null)) {
        printError({
          code: "INVALID_ARGS",
          message: "Pass exactly one of --id or --path.",
        });
        process.exit(2);
      }
      const target = args.id != null ? { id: args.id } : { path: args.path };
      return dispatch({
        toolName: "discardPageChanges",
        args: target,
        cwd,
        projectFlag,
        production,
        outputMode,
      });
    }
  }
}
