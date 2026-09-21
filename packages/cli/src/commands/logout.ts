import * as p from "@clack/prompts";
import { log } from "@clack/prompts";
import { object } from "@optique/core/constructs";
import { command, constant } from "@optique/core/primitives";

import {
  readAuthToken,
  readAuthTokenForUrl,
  removeAuthToken,
  removeAuthTokenForUrl,
} from "../lib/auth";
import {
  RuntimeDirectoryError,
  RuntimeMalformedError,
  RuntimeNotFoundError,
  loadRuntime,
} from "../lib/runtime";
import { cwdFlag } from "../lib/runtime-options";

export const parser = command(
  "logout",
  object({
    command: constant("logout"),
    cwd: cwdFlag,
  }),
);

export const handler = logout;

export function logout(args: { cwd?: string } = {}) {
  p.intro("camox logout");

  let authenticationUrl: string | null = null;
  try {
    authenticationUrl = loadRuntime(args.cwd).authenticationUrl;
  } catch (error) {
    if (
      error instanceof RuntimeMalformedError ||
      error instanceof RuntimeDirectoryError ||
      (args.cwd !== undefined && error instanceof RuntimeNotFoundError)
    ) {
      log.error(error.message);
      return;
    }
    if (!(error instanceof RuntimeNotFoundError)) throw error;
  }

  const token = authenticationUrl ? readAuthTokenForUrl(authenticationUrl) : readAuthToken();
  if (!token) {
    log.error("Not logged in.");
    return;
  }

  if (authenticationUrl) {
    removeAuthTokenForUrl(authenticationUrl);
  } else {
    removeAuthToken();
  }
  p.log.success(`Logged out from ${token.name}.`);
}
