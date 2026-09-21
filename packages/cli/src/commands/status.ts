import { object } from "@optique/core/constructs";
import { command, constant, option } from "@optique/core/primitives";

import { readAuthTokenForUrl } from "../lib/auth";
import { printError } from "../lib/output";
import {
  RuntimeDirectoryError,
  RuntimeMalformedError,
  RuntimeNotFoundError,
  loadRuntime,
} from "../lib/runtime";
import { cwdFlag } from "../lib/runtime-options";

export const parser = command(
  "status",
  object({
    command: constant("status" as const),
    cwd: cwdFlag,
    production: option("--production"),
    json: option("--json"),
  }),
);

type Args = { cwd?: string; command: "status"; production: boolean; json: boolean };

export async function handler(args: Args): Promise<never> {
  let runtime;
  try {
    runtime = loadRuntime(args.cwd);
  } catch (err) {
    if (err instanceof RuntimeDirectoryError) {
      printError({ code: "INVALID_CWD", message: err.message });
      process.exit(2);
    }
    if (err instanceof RuntimeNotFoundError || err instanceof RuntimeMalformedError) {
      printError({ code: "RUNTIME_NOT_FOUND", message: err.message });
      process.exit(2);
    }
    throw err;
  }

  const token = readAuthTokenForUrl(runtime.authenticationUrl);
  const environmentName = args.production
    ? "production"
    : token?.email
      ? `dev:${token.email}`
      : null;
  const status = {
    projectSlug: runtime.projectSlug,
    environmentName,
    apiUrl: runtime.apiUrl,
    authenticationUrl: runtime.authenticationUrl,
    authenticated: token !== null,
    user: token ? { name: token.name, email: token.email } : null,
  };

  if (args.json || !process.stdout.isTTY) {
    process.stdout.write(`${JSON.stringify(status, null, process.stdout.isTTY ? 2 : 0)}\n`);
    process.exit(0);
  }

  const lines = [
    `project:     ${status.projectSlug}`,
    `environment: ${status.environmentName ?? "(unknown — run `camox login`)"}`,
    `api:         ${status.apiUrl}`,
    `auth:        ${status.authenticationUrl}`,
    status.user
      ? `signed in:   ${status.user.name} <${status.user.email}>`
      : `signed in:   (no token for ${status.authenticationUrl} — run \`camox login\`)`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
  process.exit(0);
}
