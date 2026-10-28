import { text } from "node:stream/consumers";

import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { argument, command, constant } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

import { createCodeReadToken } from "../lib/api";
import { readAuthToken } from "../lib/auth";
import { parseCredentialRequest, projectIdOfPath } from "../lib/git-credential";

export const parser = command(
  "git-credential",
  object({
    command: constant("git-credential" as const),
    action: argument(string({ metavar: "ACTION" }), {
      description: message`What Git asks: get, store or erase.`,
    }),
  }),
  {
    description: message`The Git credential helper \`camox clone\` sets up: answers Git with short-lived read tokens.`,
  },
);

type Args = { command: "git-credential"; action: string };

/**
 * Answers Git's credential protocol (git-credential(1)). Only `get` is answered, with a fresh
 * read token: tokens are short-lived, so there's nothing to store or erase. Errors go to stderr,
 * since stdout is Git's.
 */
export async function handler(args: Args): Promise<never> {
  const request = parseCredentialRequest(await text(process.stdin));
  if (args.action !== "get") process.exit(0);

  const project = projectIdOfPath(request.path);
  if (!project) process.exit(0);

  const session = readAuthToken();
  if (!session) {
    process.stderr.write("camox: not logged in. Run `camox login`, then try again.\n");
    process.exit(1);
  }

  try {
    const { token, expiresAt } = await createCodeReadToken(session.token, project);
    const expiry = Math.floor(new Date(expiresAt).getTime() / 1000);
    process.stdout.write(`username=camox\npassword=${token}\npassword_expiry_utc=${expiry}\n`);
    process.exit(0);
  } catch (error) {
    process.stderr.write(`camox: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
