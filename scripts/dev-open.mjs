import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

/** Consume the launcher's flag rather than forwarding Vite's --open to every app. */
export async function prepareDevOpen(repoRoot, args, env = process.env) {
  const forwardedArgs = args.filter((argument) => argument !== "--open");
  const environment = { ...env };
  delete environment.CAMOX_DEV_OPEN_PLAYGROUND_ONCE_FILE;
  if (!args.includes("--open")) {
    return { args: forwardedArgs, env: environment, cleanup: async () => {} };
  }

  const directory = join(repoRoot, ".camox");
  await mkdir(directory, { recursive: true });
  // The SDK atomically creates this empty marker after minting a sign-in link.
  // Keep the same path across port retries and Vite restarts, never store tokens.
  const onceFile = join(directory, `dev-open-${randomUUID()}`);
  environment.CAMOX_DEV_OPEN_PLAYGROUND_ONCE_FILE = onceFile;
  return {
    args: forwardedArgs,
    env: environment,
    cleanup: () => rm(onceFile, { force: true }),
  };
}
