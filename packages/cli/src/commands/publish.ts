import {
  DRAFT_ENDED_ERROR_CODE,
  NOT_PUBLISHED_CODES,
  type NotPublishedReason,
} from "@camox/api-contract/drafts";
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
// what publishing would do and a token; with the token it publishes, unless Live changed since
// or translations are still running (`--anyway` publishes regardless, ADR 0015).

export const parser = command(
  "publish",
  object({
    command: constant("publish" as const),
    confirm: optional(
      option("--confirm", string({ metavar: "TOKEN" }), {
        description: message`Publish, with the token \`camox publish\` printed with the list you reviewed.`,
      }),
    ),
    anyway: option("--anyway", {
      description: message`With --confirm, publish while translations are still running: Camox finishes them in a draft of its own and publishes it once they're done.`,
    }),
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
  anyway: boolean;
  cwd?: string;
  project?: string;
  json: boolean;
};

type PublishResult =
  | { published: true }
  | { published: false; reason: "empty"; message: string }
  | { published: false; reason: "discarded"; message: string }
  | {
      published: false;
      reason: NotPublishedReason;
      message: string;
      preview: PublishPreview;
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
    args: { token: args.confirm, ...(args.anyway && { publishAnyway: true }) },
  })) as PublishResult;

  if (result.published !== false) {
    if (isJsonMode(outputMode)) printResult(result, outputMode);
    else process.stdout.write("Published your development draft to Live.\n");
    process.exit(0);
  }

  // Nothing to publish isn't a failure: a retry after publishing finds the draft emptied.
  if (result.reason === "empty") {
    if (isJsonMode(outputMode)) printResult(result, outputMode);
    else process.stdout.write("Your development draft has no changes: nothing to publish.\n");
    process.exit(0);
  }

  if (result.reason === "discarded") {
    printError({
      code: DRAFT_ENDED_ERROR_CODE,
      message: `${result.message} Nothing was published.`,
    });
    process.exit(1);
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
