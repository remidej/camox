import { getSandbox } from "@cloudflare/sandbox";

import { HOSTED_BUILD } from "../../lib/hosted-build";
import { type SpanFields, timed } from "../../lib/timing";
import type { Bindings } from "../../types";
import { lintErrorsOf } from "./lint-log";
import type { LintError } from "./result";

// Each draft with code builds its revisions in its own sandbox, named by the draft's ID: a
// Container in the release sandbox Worker (release-sandbox/), with the release sandbox's image,
// which holds the Template's install. It's reused across the agent's turns, keeping its install
// and its revision builder, and sleeps once idle.

/** How long a revision sandbox stays up idle, keeping its install for the next build. */
export const REVISION_SANDBOX_SLEEP_AFTER = "15m";

/** Where the website's files are built: where the image installed the Template (its Dockerfile). */
const WORKSPACE = "/opt/camox/website";
/** Where the working copy's tree is streamed to before it replaces the workspace's files. */
const TREE_ARCHIVE = "/tmp/camox-tree.tar";
/** Where a passed build's output is archived. */
const BUILD_ARCHIVE = "/tmp/camox-build.tar.gz";
/**
 * A digest of the lockfile the workspace's `node_modules` holds the install of: the Template's,
 * in a new sandbox whose image installed it.
 */
const INSTALLED_LOCKFILE = `${WORKSPACE}/node_modules/.camox-installed-lockfile`;

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

/**
 * What builds and `vp lint` run with: both load the project's Vite config, whose Camox plugin
 * throws for a build that isn't a release when no `camox login` is around, which the sandbox
 * hasn't. A dry-run release builds without one, and turns on the hosted projects' checks.
 */
const VITE_ENV = { CAMOX_INTERNAL_RELEASE: "dry-run", ...HOSTED_BUILD, CI: "1", NO_COLOR: "1" };

/** Vite+'s CLI, run as it's installed rather than through `pnpm exec`, which starts pnpm first. */
const VP = "node_modules/.bin/vp";

/**
 * The revision builder (release-sandbox/revision-builder.mjs): a process that stays up in the
 * sandbox with Vite and the website's plugins loaded, and builds without loading them again.
 */
const REVISION_BUILDER = "/opt/camox/revision-builder.mjs";
/**
 * Starts the revision builder, which stays if one of the workspace's install is up already, and
 * replaces one of another. A sandbox whose image has none starts nothing.
 */
const START_BUILDER_COMMAND = `sh -c '[ -f ${REVISION_BUILDER} ] && exec node ${REVISION_BUILDER} serve'`;
/**
 * The build: through the revision builder, or with `vp build` when none can build, as in a
 * sandbox whose image has none. Both print the same log. The builder's exit 75 says it couldn't.
 */
const BUILD_COMMAND = `sh -c 'if [ -f ${REVISION_BUILDER} ]; then node ${REVISION_BUILDER} build; status=$?; [ $status -eq 75 ] || exit $status; fi; exec ${VP} build'`;
/** The lines the revision builder prints what a span logs of its build on, as JSON. */
const BUILDER_REPORT = /^camox-builder: (.*)\n?/gm;

/**
 * A build's log without the revision builder's report, and the report's fields: the build's
 * number in the builder's life, how long it took there, the host's CPU clock, or why the
 * builder couldn't build. `builder` says whether it built.
 */
function builderReportOf(log: string): { log: string; fields: SpanFields } {
  const fields: SpanFields = {};
  for (const [, json] of log.matchAll(BUILDER_REPORT)) {
    try {
      const { build, ms, cpuMhz, unavailable } = JSON.parse(json!) as Record<string, unknown>;
      Object.assign(fields, {
        builderBuild: typeof build === "number" ? build : undefined,
        builderMs: typeof ms === "number" ? ms : undefined,
        cpuMhz: typeof cpuMhz === "number" ? cpuMhz : undefined,
        builderUnavailable: typeof unavailable === "string" ? unavailable.slice(0, 200) : undefined,
      });
    } catch {
      // Not the builder's report after all: the line stays out of the fields.
    }
  }
  return {
    log: log.replace(BUILDER_REPORT, ""),
    fields: { ...fields, builder: fields.builderBuild !== undefined },
  };
}

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

/**
 * How the API talks to the sandbox's container. The tree's archive is written as a stream, which
 * only the RPC transport takes: the default HTTP one throws. Every `getSandbox` of a draft's
 * sandbox passes the same one, as changing it drops the calls in flight.
 */
export const REVISION_SANDBOX_TRANSPORT = "rpc";

const sandboxOf = (env: Pick<Bindings, "REVISION_SANDBOX">, draftId: string) =>
  getSandbox(env.REVISION_SANDBOX, draftId, {
    sleepAfter: REVISION_SANDBOX_SLEEP_AFTER,
    transport: REVISION_SANDBOX_TRANSPORT,
  });

/**
 * The draft's sandbox running each command on its own, outside its shell session, which runs
 * one at a time: so the type check runs beside the build.
 */
const sessionlessSandboxOf = (env: Pick<Bindings, "REVISION_SANDBOX">, draftId: string) =>
  getSandbox(env.REVISION_SANDBOX, draftId, {
    sleepAfter: REVISION_SANDBOX_SLEEP_AFTER,
    transport: REVISION_SANDBOX_TRANSPORT,
    enableDefaultSession: false,
  });

async function digest(text: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const tail = (text: string, lines = 20) => text.trimEnd().split("\n").slice(-lines).join("\n");

/** A working copy's tree: a tar archive of its files, and its lockfile. */
type Tree = { files: Uint8Array; lockfile: string | null };

/**
 * Type checks all of `src/` in the tree the draft's sandbox last extracted, with its install.
 * Throws a `SandboxError` when the sandbox, not the check, fails.
 */
export async function checkTypesInSandbox(
  env: Pick<Bindings, "REVISION_SANDBOX">,
  draftId: string,
  span: SpanFields = { draftId },
): Promise<SandboxTypeCheck> {
  const sandbox = sessionlessSandboxOf(env, draftId);
  await sandbox.writeFile(`${WORKSPACE}/${TYPE_CHECK_CONFIG}`, TYPE_CHECK_CONFIG_CONTENT);
  const checked = await timed(
    "revision.sandbox.typeCheck",
    span,
    () => sandbox.exec(TYPE_CHECK_COMMAND, { cwd: WORKSPACE, env: { CI: "1" } }),
    ({ exitCode }) => ({ exitCode }),
  );
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
 * The draft's sandbox, its workspace holding `tree`: its files replace the workspace's, keeping
 * its `node_modules`, which is installed again only when the lockfile isn't the one last
 * installed. `run` runs a command in the workspace, throwing a `SandboxError` when it fails.
 */
async function workspaceWith(
  env: Pick<Bindings, "REVISION_SANDBOX">,
  draftId: string,
  { files, lockfile }: Tree,
  span: SpanFields,
) {
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

  await timed("revision.sandbox.writeTree", { ...span, bytes: files.byteLength }, async () => {
    await sandbox.writeFile(TREE_ARCHIVE, new Blob([files]).stream());
    await sandbox.exec(`mkdir -p ${WORKSPACE}`);
    await run(
      `find . -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} + && tar -xf ${TREE_ARCHIVE} -C .`,
    );
  });

  // The lockfile is platform-owned: an install that fails is the sandbox's failure. A sandbox
  // that holds the install of this lockfile, its own or its image's, skips it: `installed` says
  // whether it ran. An install that fails midway leaves no digest, so the next one runs again.
  await timed(
    "revision.sandbox.install",
    span,
    async () => {
      const installed = (await sandbox.exists(INSTALLED_LOCKFILE)).exists
        ? (await sandbox.readFile(INSTALLED_LOCKFILE)).content.trim()
        : null;
      const wanted = await digest(lockfile ?? "");
      if (installed === wanted) return false;
      await run(`rm -f ${INSTALLED_LOCKFILE} && pnpm install --frozen-lockfile`, {
        env: { CI: "1" },
      });
      await sandbox.writeFile(INSTALLED_LOCKFILE, wanted);
      return true;
    },
    (installed) => ({ installed }),
  );
  // Once installed, so the builder loads that install. It loads as the agent writes, in a
  // sandbox started ahead of its build, and a builder that didn't start leaves `vp build` to it.
  try {
    const started = await sandbox.startProcess(START_BUILDER_COMMAND, {
      cwd: WORKSPACE,
      env: VITE_ENV,
    });
    // Nothing else is asked of the process: its methods, stubs over RPC, are let go now.
    (started as Partial<Disposable>)[Symbol.dispose]?.();
  } catch (error) {
    console.warn("A revision sandbox's builder didn't start", error);
  }
  return { sandbox, run };
}

/**
 * Starts the draft's sandbox and installs the dependencies of `tree`, which holds the files the
 * install reads, so the build that follows doesn't wait for either: it writes its own tree, and
 * installs only if the lockfile changed since. Throws a `SandboxError` when the sandbox fails.
 */
export async function warmSandbox(
  env: Pick<Bindings, "REVISION_SANDBOX">,
  draftId: string,
  tree: Tree,
  span: SpanFields = { draftId },
): Promise<void> {
  await workspaceWith(env, draftId, tree, span);
}

/**
 * Builds a tree in the draft's sandbox, as a dry-run release of a hosted project. The type check
 * of `src/` runs beside the build, and a passed build returns it still going. Throws a
 * `SandboxError` when the sandbox, not the build, fails.
 */
export async function buildInSandbox(
  env: Pick<Bindings, "REVISION_SANDBOX">,
  draftId: string,
  tree: Tree,
  span: SpanFields = { draftId },
): Promise<SandboxBuild> {
  const { sandbox, run } = await workspaceWith(env, draftId, tree, span);

  const typeCheck = checkTypesInSandbox(env, draftId, span);
  // A build that fails drops its check: nothing waits on it then.
  typeCheck.catch(() => undefined);
  const built = await timed(
    "revision.sandbox.viteBuild",
    span,
    async () => {
      const result = await sandbox.exec(BUILD_COMMAND, { cwd: WORKSPACE, env: VITE_ENV });
      return { ...result, ...builderReportOf(`${result.stdout}\n${result.stderr}`) };
    },
    ({ success, fields }) => ({ built: success, ...fields }),
  );
  if (!built.success) return { ok: false, log: built.log };

  const archive = await timed(
    "revision.sandbox.archive",
    span,
    async () => {
      // gzip's fastest level, in a third of the default's time: the archive only goes to R2,
      // inside Cloudflare, where a few more bytes cost less than a second more.
      await run(`tar -I 'gzip -1' -cf ${BUILD_ARCHIVE} -C . dist`);
      const { content } = await sandbox.readFile(BUILD_ARCHIVE, { encoding: "base64" });
      return Uint8Array.from(atob(content), (char) => char.charCodeAt(0));
    },
    ({ byteLength }) => ({ bytes: byteLength }),
  );
  return { ok: true, archive, typeCheck };
}

/**
 * Lints a tree in the draft's sandbox with the project's `vp lint` config, and returns its
 * findings in the files the agent may change. Throws a `SandboxError` when the sandbox fails, or
 * the lint itself does: findings never fail it.
 */
export async function lintInSandbox(
  env: Pick<Bindings, "REVISION_SANDBOX">,
  draftId: string,
  tree: Tree,
  span: SpanFields = { draftId },
): Promise<LintError[]> {
  const { sandbox } = await workspaceWith(env, draftId, tree, span);
  const command = `${VP} lint --format json src`;
  // Exits non-zero when it finds an error, which its report then lists.
  const linted = await timed("revision.sandbox.lint", span, () =>
    sandbox.exec(command, { cwd: WORKSPACE, env: VITE_ENV }),
  );
  const errors = lintErrorsOf(linted.stdout);
  if (!errors) {
    throw new SandboxError(
      `\`${command}\` exited with ${linted.exitCode} without a report: ${tail(`${linted.stdout}\n${linted.stderr}`)}`,
    );
  }
  return errors;
}

/** Destroys the draft's sandbox, as the draft ends. */
export async function destroySandbox(env: Pick<Bindings, "REVISION_SANDBOX">, draftId: string) {
  await sandboxOf(env, draftId).destroy();
}
