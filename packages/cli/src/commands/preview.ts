import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { command, constant, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

import {
  createPreviewSignInUrl,
  isLoopbackUrl,
  normalizeUrl,
  readAuthTokenForUrl,
} from "../lib/auth-core";
import { printError, printResult } from "../lib/output";
import { loadRuntime } from "../lib/runtime";
import { cwdFlag } from "../lib/runtime-options";

export const parser = command(
  "preview",
  object({
    command: constant("preview" as const),
    cwd: cwdFlag,
    url: option("--url", string()),
    json: option("--json"),
  }),
  {
    description: message`Create a single-use sign-in URL for local draft verification. Open it in your automation browser within three minutes. The URL is a credential; do not share it.`,
  },
);

type Args = { command: "preview"; cwd?: string; url: string; json: boolean };

export async function handler(args: Args): Promise<void> {
  try {
    const url = new URL(args.url);
    if (!isLoopbackUrl(url)) {
      throw new Error("Preview requires an http(s) loopback URL without credentials.");
    }
    const runtime = loadRuntime(args.cwd);
    const auth = readAuthTokenForUrl(runtime.authenticationUrl, args.cwd);
    if (!auth?.email) {
      printError({
        code: "NOT_AUTHENTICATED",
        message: `Run camox login for ${runtime.authenticationUrl} first.`,
      });
      process.exitCode = 2;
      return;
    }
    const target = {
      projectSlug: runtime.projectSlug,
      environmentName: `dev:${auth.email}`,
      apiUrl: normalizeUrl(runtime.apiUrl),
    };
    const signInUrl = await createPreviewSignInUrl(url.href, target, auth.token);
    printResult(
      {
        url: signInUrl,
        ...target,
        source: "draft",
        warning:
          "Single-use sign-in credential, valid for three minutes. Open in your verification browser; do not share or commit.",
      },
      args.json ? "json" : "auto",
    );
  } catch (error) {
    // Never echo backend bodies or URLs, which may contain credentials.
    printError({
      code: "PREVIEW_FAILED",
      message: error instanceof Error ? error.message : "Could not create preview.",
    });
    process.exitCode = 2;
  }
}
