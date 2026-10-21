import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** Runs a command, failing with its output on `stdout` and `stderr` if it exits non-zero. */
export function run(bin, argv, options) {
  return exec(bin, argv, { maxBuffer: 64 * 1024 * 1024, ...options });
}

/** Whether pnpm failed because the registry doesn't serve a version it was asked for. */
function isVersionNotOnRegistry(error) {
  return `${error?.stdout ?? ""}${error?.stderr ?? ""}`.includes("ERR_PNPM_NO_MATCHING_VERSION");
}

/**
 * Writes `dir`'s `pnpm-lock.yaml`. npm can take a while to serve a version it has just
 * published, so this waits for one it doesn't serve yet, and fails at once on any other error.
 */
export async function installLockfile(
  dir,
  { run: runCommand = run, attempts = 10, retryDelayMs = 30_000, onRetry = () => {} } = {},
) {
  for (let attempt = 1; ; attempt++) {
    try {
      await runCommand("pnpm", ["install", "--lockfile-only"], { cwd: dir });
      return;
    } catch (error) {
      if (!isVersionNotOnRegistry(error) || attempt === attempts) throw error;
      onRetry(attempt, attempts);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}
