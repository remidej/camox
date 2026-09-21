import { object, or } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { optional } from "@optique/core/modifiers";
import type { InferValue } from "@optique/core/parser";
import { command, constant, option } from "@optique/core/primitives";
import { choice, integer, string } from "@optique/core/valueparser";

import { dispatch, resolveCommandContext } from "../lib/dispatch";
import { uploadFile, validateFilename, validateMetadata, validateUpload } from "../lib/file-upload";
import { asCliError, printError, printResult } from "../lib/output";

const common = {
  project: optional(option("--project", string({ metavar: "SLUG" }))),
  production: option("--production"),
  json: option("--json"),
};
const metadata = {
  alt: optional(
    option("--alt", string({ metavar: "TEXT" }), {
      description: message`Alt text (including an empty string). Disables automatic metadata.`,
    }),
  ),
  aiMetadata: optional(
    option("--ai-metadata", choice(["on", "off"] as const), {
      description: message`Enable or disable automatic metadata. Cannot enable alongside --alt. Enabling schedules generation for raster images.`,
    }),
  ),
};

export const parser = command(
  "files",
  or(
    command(
      "upload",
      object({
        command: constant("files.upload" as const),
        file: optional(
          option("--file", string({ metavar: "PATH" }), {
            description: message`Local file to upload. Pass exactly one of --file or --url.`,
          }),
        ),
        url: optional(
          option("--url", string({ metavar: "URL" }), {
            description: message`HTTP(S) URL to download and copy into Camox, not an external reference.`,
          }),
        ),
        filename: optional(
          option("--filename", string({ metavar: "NAME" }), {
            description: message`Override the local basename or final URL path filename.`,
          }),
        ),
        ...metadata,
        ...common,
      }),
      {
        description: message`Upload media (maximum 100 MiB). Example: camox files upload --url https://example.com/hero.webp --alt "Product screenshot". Returns the stored file ID and URL. Without metadata options, raster images use automatic metadata.`,
      },
    ),
    command(
      "update",
      object({
        command: constant("files.update" as const),
        id: option("--id", integer({ min: 1, metavar: "ID" })),
        filename: optional(
          option("--filename", string({ metavar: "NAME" }), {
            description: message`Rename the file without changing its ID or URL. Preserves the AI setting; disable AI to prevent future automatic renaming.`,
          }),
        ),
        ...metadata,
        ...common,
      }),
      {
        description: message`Update the filename, alt text or AI settings. Example: camox files update --id 123 --alt "Updated description". Use --alt "" for intentionally empty alt text.`,
      },
    ),
    command(
      "get",
      object({
        command: constant("files.get" as const),
        id: option("--id", integer({ min: 1, metavar: "ID" })),
        ...common,
      }),
      { description: message`Inspect a file in the selected project and environment.` },
    ),
    command(
      "list",
      object({
        command: constant("files.list" as const),
        ...common,
      }),
      { description: message`List files in the selected project and environment.` },
    ),
  ),
  {
    description: message`Upload and manage media. Defaults to your development environment; --production explicitly targets production.`,
  },
);

type Args = InferValue<typeof parser>;

export async function handler(args: Args): Promise<never> {
  const outputMode = args.json ? "json" : "auto";
  const options = { projectFlag: args.project, production: args.production, outputMode } as const;
  try {
    if (args.command === "files.upload") {
      validateUpload(args);
      const context = await resolveCommandContext(options);
      const result = await uploadFile(context, args);
      printResult(result, outputMode);
      process.exit(0);
    }
    if (args.command === "files.list") {
      return dispatch({ ...options, toolName: "listFiles", args: {} });
    }
    if (args.command === "files.get") {
      return dispatch({ ...options, toolName: "getFile", args: { id: args.id } });
    }
    validateMetadata(args);
    validateFilename(args.filename);
    if (args.alt === undefined && args.aiMetadata === undefined && args.filename === undefined) {
      printError({ code: "INVALID_ARGS", message: "Pass --filename, --alt or --ai-metadata." });
      process.exit(2);
    }
    return dispatch({
      ...options,
      toolName: "updateFile",
      args: {
        id: args.id,
        alt: args.alt,
        filename: args.filename,
        aiMetadataEnabled: args.aiMetadata === undefined ? undefined : args.aiMetadata === "on",
      },
    });
  } catch (err) {
    const error = asCliError(err);
    printError(error);
    process.exit(error.code === "INVALID_ARGS" ? 2 : 1);
  }
}
