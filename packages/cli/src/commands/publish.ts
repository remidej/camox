import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { optional } from "@optique/core/modifiers";
import { command, constant, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

import { callToolResult } from "../lib/dispatch";
import { type OutputMode, isJsonMode, printError, printResult } from "../lib/output";
import { type PublishPreview, formatPreview } from "../lib/publish-preview";
import { cwdFlag } from "../lib/runtime-options";

// Publishing the development draft to Live (ADR 0009, ADR 0010): without `--confirm` it prints
// what publishing would do and a token; with the token it publishes, unless Live changed since.

export const parser = command(
  "publish",
  object({
    command: constant("publish" as const),
    confirm: optional(
      option("--confirm", string({ metavar: "TOKEN" }), {
        description: message`Publish, with the token \`camox publish\` printed with the list you reviewed.`,
      }),
    ),
    cwd: cwdFlag,
    project: optional(option("--project", string({ metavar: "SLUG" }))),
    json: option("--json"),
  }),
  {
    description: message`List what publishing your development draft to Live would do, with a token; publish with --confirm <token>.`,
  },
);

type Args = {
  command: "publish";
  confirm?: string;
  cwd?: string;
  project?: string;
  json: boolean;
};

type PublishResult =
  | { published: true }
  | {
      published: false;
      reason: "conflictsChanged" | "blocked";
      message: string;
      preview: PublishPreview;
    };

const NOT_PUBLISHED_CODES = {
  conflictsChanged: "CONFLICTS_CHANGED",
  blocked: "PUBLISH_BLOCKED",
};

export async function handler(args: Args): Promise<never> {
  const outputMode: OutputMode = args.json ? "json" : "auto";
  const target = { cwd: args.cwd, projectFlag: args.project };

  if (args.confirm === undefined) {
    const preview = (await callToolResult({
      ...target,
      toolName: "previewPublish",
      args: {},
    })) as PublishPreview;
    printPreview(preview, outputMode);
    process.exit(0);
  }

  const result = (await callToolResult({
    ...target,
    toolName: "publishDraft",
    args: { token: args.confirm },
  })) as PublishResult;

  if (result.published !== false) {
    if (isJsonMode(outputMode)) printResult(result, outputMode);
    else process.stdout.write("Published your development draft to Live.\n");
    process.exit(0);
  }

  // Nothing was published: show the new list, which the user reviews before confirming again.
  printError({
    code: NOT_PUBLISHED_CODES[result.reason],
    message: `${result.message} Nothing was published.`,
  });
  printPreview(result.preview, outputMode);
  process.exit(1);
}

function printPreview(preview: PublishPreview, outputMode: OutputMode) {
  if (isJsonMode(outputMode)) return printResult(preview, outputMode);
  process.stdout.write(formatPreview(preview));
}
