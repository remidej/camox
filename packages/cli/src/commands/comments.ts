import { object, or } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { optional } from "@optique/core/modifiers";
import { command, constant, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

import { dispatch } from "../lib/dispatch";
import { cwdFlag } from "../lib/runtime-options";
import { uuidv7 } from "../lib/uuidv7";

const common = {
  cwd: cwdFlag,
  project: optional(option("--project", string({ metavar: "SLUG" }))),
  json: option("--json"),
};

export const parser = command(
  "comments",
  or(
    command(
      "list",
      object({
        command: constant("comments.list" as const),
        pageId: option("--page-id", uuidv7()),
        ...common,
      }),
      { description: message`List all comments (including resolved ones) for a page.` },
    ),
    command(
      "resolve",
      object({
        command: constant("comments.resolve" as const),
        pageId: option("--page-id", uuidv7()),
        id: option("--id", uuidv7()),
        ...common,
      }),
      {
        description: message`Resolve a comment by its UUID and page ID. Use comments list to find both.`,
      },
    ),
  ),
  {
    description: message`Read and resolve page comments in your development draft.`,
  },
);

type CommonFlags = { cwd?: string; project?: string; json: boolean };
type Args =
  | ({ command: "comments.list"; pageId: string } & CommonFlags)
  | ({ command: "comments.resolve"; pageId: string; id: string } & CommonFlags);

export async function handler(args: Args): Promise<never> {
  return dispatch({
    toolName: args.command === "comments.list" ? "listComments" : "resolveComment",
    args: {
      pageId: args.pageId,
      ...(args.command === "comments.resolve" ? { id: args.id } : {}),
    },
    cwd: args.cwd,
    projectFlag: args.project,
    outputMode: args.json ? "json" : "auto",
  });
}
