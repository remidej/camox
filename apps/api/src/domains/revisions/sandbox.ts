import { getSandbox } from "@cloudflare/sandbox";

import type { Bindings } from "../../types";

// Each draft with code builds its revisions in its own sandbox, named by the draft's ID: a
// Container in the release sandbox Worker (release-sandbox/), with the release sandbox's image.
// It's reused across the agent's turns, keeping its install, and sleeps once idle.

/** How long a revision sandbox stays up idle, keeping its install for the next build. */
export const REVISION_SANDBOX_SLEEP_AFTER = "15m";

/** Where the website's files are built. */
const WORKSPACE = "/workspace/website";
/** Where the working copy's tree is streamed to before it replaces the workspace's files. */
const TREE_ARCHIVE = "/tmp/camox-tree.tar";
/** Where a passed build's output is archived. */
const BUILD_ARCHIVE = "/tmp/camox-build.tar.gz";
/** A digest of the lockfile the workspace last installed. */
const INSTALLED_LOCKFILE = "/tmp/camox-installed-lockfile";

/**
 * Turns on the build checks only hosted projects have (`HOSTED_BUILD_ENV` in
 * packages/sdk/src/features/vite/hostedChecks.ts).
 */
const HOSTED_BUILD_ENV = "CAMOX_INTERNAL_HOSTED";

/**
 * The config the type check reads: the project's own `tsconfig.json`, over all of `src/`. It's
 * written in the workspace, so the project's settings resolve as they do there.
 */
const TYPE_CHECK_CONFIG = "tsconfig.camox-check.json";
const TYPE_CHECK_CONFIG_CONTENT = JSON.stringify({
  extends: "./tsconfig.json",
  include: ["src/**/*.ts", "src/**/*.tsx"],
});
/**
 * The type check: native tsrs, pinned in the sandbox's image (release-sandbox/Dockerfile), not in
 * the project's `package.json`. It exits with 0 when the code type checks, 1 or 2 with errors.
 */
const TYPE_CHECK_COMMAND = `tsrs -p ${TYPE_CHECK_CONFIG} --pretty false`;

/** A sandbox that failed to do its part, as opposed to a build that failed. */
export class SandboxError extends Error {
  override name = "SandboxError";
}

/** A type check's outcome, with what it printed: its errors when it failed. */
export type SandboxTypeCheck = { ok: boolean; output: string };

/**
 * A build's outcome: its output as one gzipped tar archive, with the type check of the same tree,
 * which may still be running, or the log of its failure.
 */
export type SandboxBuild =
  | { ok: true; archive: Uint8Array; typeCheck: Promise<SandboxTypeCheck> }
  | { ok: false; log: string };

const sandboxOf = (env: Pick<Bindings, "REVISION_SANDBOX">, draftId: string) =>
  getSandbox(env.REVISION_SANDBOX, draftId, { sleepAfter: REVISION_SANDBOX_SLEEP_AFTER });

/**
 * The draft's sandbox running each command on its own, outside its shell session, which runs
 * one at a time: so the type check runs beside the build.
 */
const sessionlessSandboxOf = (env: Pick<Bindings, "REVISION_SANDBOX">, draftId: string) =>
  getSandbox(env.REVISION_SANDBOX, draftId, {
    sleepAfter: REVISION_SANDBOX_SLEEP_AFTER,
    enableDefaultSession: false,
  });

async function digest(text: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const tail = (text: string, lines = 20) => text.trimEnd().split("\n").slice(-lines).join("\n");

/**
 * Type checks all of `src/` in the tree the draft's sandbox last extracted, with its install.
 * Throws a `SandboxError` when the sandbox, not the check, fails.
 */
export async function checkTypesInSandbox(
  env: Pick<Bindings, "REVISION_SANDBOX">,
  draftId: string,
): Promise<SandboxTypeCheck> {
  const sandbox = sessionlessSandboxOf(env, draftId);
  await sandbox.writeFile(`${WORKSPACE}/${TYPE_CHECK_CONFIG}`, TYPE_CHECK_CONFIG_CONTENT);
  const checked = await sandbox.exec(TYPE_CHECK_COMMAND, { cwd: WORKSPACE, env: { CI: "1" } });
  const output = `${checked.stdout}\n${checked.stderr}`;
  if (checked.exitCode === 0) return { ok: true, output };
  // Any other exit, such as tsrs missing or crashing, isn't a verdict on the code.
  if (checked.exitCode !== 1 && checked.exitCode !== 2) {
    throw new SandboxError(
      `\`${TYPE_CHECK_COMMAND}\` exited with ${checked.exitCode}: ${tail(output)}`,
    );
  }
  return { ok: false, output };
}

/**
 * Builds a tree in the draft's sandbox, as a dry-run release of a hosted project: `files`, a tar
 * archive of the tree, replace the workspace's files, keeping its `node_modules`, which is
 * installed again only when `lockfile` isn't the one last installed. The type check of `src/`
 * runs beside the build, and a passed build returns it still going. Throws a `SandboxError` when
 * the sandbox, not the build, fails.
 */
export async function buildInSandbox(
  env: Pick<Bindings, "REVISION_SANDBOX">,
  draftId: string,
  { files, lockfile }: { files: Uint8Array; lockfile: string | null },
): Promise<SandboxBuild> {
  const sandbox = sandboxOf(env, draftId);
  const run = async (command: string, options: { env?: Record<string, string> } = {}) => {
    const result = await sandbox.exec(command, { cwd: WORKSPACE, ...options });
    if (!result.success) {
      throw new SandboxError(
        `\`${command}\` exited with ${result.exitCode}: ${tail(`${result.stdout}\n${result.stderr}`)}`,
      );
    }
    return result;
  };

  await sandbox.writeFile(TREE_ARCHIVE, new Blob([files]).stream());
  await sandbox.exec(`mkdir -p ${WORKSPACE}`);
  await run(
    `find . -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} + && tar -xf ${TREE_ARCHIVE} -C .`,
  );

  // The lockfile is platform-owned: an install that fails is the sandbox's failure.
  const installed = (await sandbox.exists(INSTALLED_LOCKFILE)).exists
    ? (await sandbox.readFile(INSTALLED_LOCKFILE)).content
    : null;
  const wanted = await digest(lockfile ?? "");
  if (installed !== wanted) {
    await run("pnpm install --frozen-lockfile", { env: { CI: "1" } });
    await sandbox.writeFile(INSTALLED_LOCKFILE, wanted);
  }

  const typeCheck = checkTypesInSandbox(env, draftId);
  // A build that fails drops its check: nothing waits on it then.
  typeCheck.catch(() => undefined);
  const built = await sandbox.exec("pnpm exec vp build", {
    cwd: WORKSPACE,
    env: { CAMOX_INTERNAL_RELEASE: "dry-run", [HOSTED_BUILD_ENV]: "1", CI: "1", NO_COLOR: "1" },
  });
  if (!built.success) return { ok: false, log: `${built.stdout}\n${built.stderr}` };

  await run(`tar -czf ${BUILD_ARCHIVE} -C . dist`);
  const { content } = await sandbox.readFile(BUILD_ARCHIVE, { encoding: "base64" });
  return {
    ok: true,
    archive: Uint8Array.from(atob(content), (char) => char.charCodeAt(0)),
    typeCheck,
  };
}

/** Destroys the draft's sandbox, as the draft ends. */
export async function destroySandbox(env: Pick<Bindings, "REVISION_SANDBOX">, draftId: string) {
  await sandboxOf(env, draftId).destroy();
}
