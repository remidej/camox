import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as p from "@clack/prompts";
import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { command, constant } from "@optique/core/primitives";

import { pushCode } from "../lib/api";
import { getOrAuthenticate } from "../lib/auth";

// `camox push` sends the local branch's commits to Camox, which opens a draft with them (ADR
// 0026): the push goes to the API, which checks and lands them, never to the repo.

export const parser = command("push", object({ command: constant("push" as const) }), {
  description: message`Push the current branch's commits to a new draft, on a project whose code can be worked on outside Camox.`,
});

/** The Project ID the camox() plugin names in a Vite config. */
const PROJECT_ID =
  /\bprojectId\s*:\s*["']([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})["']/i;

const fail = (text: string): never => {
  p.log.error(text);
  process.exit(1);
};

/** Runs `git` in the checkout, returning its trimmed output, or failing with `why`. */
function git(args: string[], why: string, { quiet = false } = {}) {
  const run = spawnSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (run.error || run.status !== 0) {
    if (quiet) return undefined;
    return fail(`${why}${run.stderr ? `\n${run.stderr.trim()}` : ""}`);
  }
  return run.stdout.trim();
}

type Errors = { file: string; line: number; column?: number; message: string }[];

const listed = (errors: Errors) =>
  errors
    .map(({ file, line, column, message: text }) =>
      file ? `${file}:${line}${column === undefined ? "" : `:${column}`} ${text}` : text,
    )
    .join("\n");

export async function handler(_args: { command: "push" }): Promise<never> {
  p.intro("camox push");
  const root = git(
    ["rev-parse", "--show-toplevel"],
    "Run camox push inside a project's checkout.",
  )!;
  let config: string;
  try {
    config = readFileSync(join(root, "vite.config.ts"), "utf8");
  } catch {
    return fail("This checkout has no vite.config.ts naming its project.");
  }
  const projectUuid = config.match(PROJECT_ID)?.[1]?.toLowerCase();
  if (!projectUuid) return fail("This checkout's vite.config.ts doesn't name a Project ID.");
  const branch = git(
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    "Check out a branch to push.",
  )!;
  if (branch === "main") return fail("Push a branch of your own: main changes only by publishing.");

  const { token } = await getOrAuthenticate().catch(() => fail("Authentication failed."));

  // The branch's new commits are those the current `main` doesn't have.
  git(["fetch", "--quiet", "origin", "main"], "Couldn't fetch main.");
  const base = git(
    ["merge-base", "HEAD", "origin/main"],
    "Your branch shares no history with main.",
  )!;
  const scratch = mkdtempSync(join(tmpdir(), "camox-push-"));
  let bundle: Buffer;
  try {
    const file = join(scratch, "push.bundle");
    git(
      ["bundle", "create", "--quiet", file, branch, `^${base}`],
      "Your branch has no new commits to push.",
    );
    bundle = readFileSync(file);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  const spinner = p.spinner();
  spinner.start("Pushing and building your commits...");
  let pushed: Awaited<ReturnType<typeof pushCode>>;
  try {
    pushed = await pushCode(token, {
      projectUuid,
      branch,
      bundle: new File([new Uint8Array(bundle)], `${branch}.bundle`),
    });
  } catch (error) {
    spinner.error("Camox refused the push.");
    const data = (error as { data?: { build?: Errors } }).data;
    return fail(
      [error instanceof Error ? error.message : String(error), data?.build && listed(data.build)]
        .filter(Boolean)
        .join("\n"),
    );
  }
  spinner.stop("Pushed.");

  // The branch now follows the draft's, so pulling brings in what Camox adds to it.
  git(["fetch", "--quiet", "origin", pushed.branch], "Couldn't fetch the draft's branch.");
  git(
    ["branch", `--set-upstream-to=origin/${pushed.branch}`, branch],
    "Couldn't set your branch's upstream to the draft's branch.",
  );

  const { result } = pushed;
  if (result.ok) p.log.success("Your code built.");
  else if (result.types.length > 0) {
    p.log.warn(
      `Your code built, but has type errors, which block publishing:\n${listed(result.types)}`,
    );
  } else p.log.warn(`Your code built, but the preview can't show it:\n${listed(result.build)}`);
  p.outro(`Review your draft in the studio: ${pushed.studioUrl}`);
  process.exit(0);
}
