import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as p from "@clack/prompts";
import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { optional } from "@optique/core/modifiers";
import { command, constant, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

import { pushCode } from "../lib/api";
import { getOrAuthenticate } from "../lib/auth";
import { UUID } from "../lib/uuid";

// `camox push` sends the local branch's commits to Camox, which lands them on a draft (ADR
// 0026): the push goes to the API, which checks and lands them, never to the repo. The first
// push from a branch opens a draft, and the branch then follows the draft's branch, so later
// pushes go to the same draft. `--draft <id>` names an open draft instead, such as one the agent
// started.

export const parser = command(
  "push",
  object({
    command: constant("push" as const),
    draft: optional(
      option("--draft", string({ metavar: "DRAFT_ID" }), {
        description: message`Push to this open draft, such as one Camox's agent started, rather than the branch's own.`,
      }),
    ),
  }),
  {
    description: message`Push the current branch's commits to its draft, on a project whose code can be worked on outside Camox: a new draft on its first push.`,
  },
);

/** A draft's branch, as a branch's upstream names it: `origin/<draft id>`. */
const DRAFT_UPSTREAM = new RegExp(`^origin/(${UUID})$`, "i");

/** What the spinner says while the push is at each step. */
const STEPS: Record<string, string> = {
  checking: "Checking your commits...",
  waiting: "Waiting for Camox's agent to finish its turn in the draft...",
  building: "Building your code...",
};

/** The Project ID the camox() plugin names in a Vite config. */
const PROJECT_ID = new RegExp(`\\bprojectId\\s*:\\s*["'](${UUID})["']`, "i");

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

/** Errors as a build result lists them: build errors, or type errors, which have no column. */
type Errors = (Pushed["result"]["build"][number] | Pushed["result"]["types"][number])[];

const listed = (errors: Errors) =>
  errors
    .map((error) => {
      const column = "column" in error ? `:${error.column}` : "";
      return error.file ? `${error.file}:${error.line}${column} ${error.message}` : error.message;
    })
    .join("\n");

export async function handler(args: { command: "push"; draft?: string }): Promise<never> {
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
  // The draft named, or else the one the branch follows since its first push.
  const upstream = git(
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", `${branch}@{upstream}`],
    "",
    { quiet: true },
  );
  const draftId = args.draft ?? upstream?.match(DRAFT_UPSTREAM)?.[1]?.toLowerCase();

  const { token } = await getOrAuthenticate().catch(() => fail("Authentication failed."));

  // The branch's new commits are those neither the current `main` nor the draft has.
  git(["fetch", "--quiet", "origin", "main"], "Couldn't fetch main.");
  const base = git(
    ["merge-base", "HEAD", "origin/main"],
    "Your branch shares no history with main.",
  )!;
  // A draft without code yet, or one that ended, has no branch: Camox says which.
  const draftFetched =
    !!draftId &&
    git(
      ["fetch", "--quiet", "origin", `+refs/heads/${draftId}:refs/remotes/origin/${draftId}`],
      "",
      { quiet: true },
    ) !== undefined;
  const scratch = mkdtempSync(join(tmpdir(), "camox-push-"));
  let bundle: Buffer;
  try {
    const file = join(scratch, "push.bundle");
    git(
      [
        "bundle",
        "create",
        "--quiet",
        file,
        branch,
        `^${base}`,
        ...(draftFetched ? [`^origin/${draftId}`] : []),
      ],
      "Your branch has no new commits to push.",
    );
    bundle = readFileSync(file);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  const spinner = p.spinner();
  spinner.start("Pushing your commits...");
  let pushed: Pushed | undefined;
  try {
    // The push streams where it stands until it lands, however long its build takes.
    const events = await pushCode(token, {
      projectUuid,
      branch,
      ...(draftId && { draftId }),
      bundle: new File([new Uint8Array(bundle)], `${branch}.bundle`),
    });
    for await (const event of events) {
      if (event.type === "progress") spinner.message(STEPS[event.step] ?? "Pushing...");
      else pushed = event;
    }
    if (!pushed) throw new Error("Camox ended the push without landing it. Push again.");
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
  // The draft's branch is named by its id.
  git(["fetch", "--quiet", "origin", pushed.draftId], "Couldn't fetch the draft's branch.");
  git(
    ["branch", `--set-upstream-to=origin/${pushed.draftId}`, branch],
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

type Pushed = Extract<
  Awaited<ReturnType<typeof pushCode>> extends AsyncIterable<infer E> ? E : never,
  { type: "pushed" }
>;
