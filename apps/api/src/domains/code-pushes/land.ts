import type { PreparedCommit } from "../../durable-objects/draft-code";
import type { Bindings } from "../../types";
import { buildRevision, failedBuild, retried } from "../revisions/build";
import type { BuildResult } from "../revisions/result";
import { buildInSandbox, type SandboxBuild } from "../revisions/sandbox";
import { PULL_DRAFT_FIRST, type PushRefusal } from "./checks";

// Landing a checked push on a draft (ADR 0026): its commits join the draft's branch as they are,
// and its head becomes one revision, built in the draft's sandbox.

/** A push that passed its checks, as the draft it lands on receives it. */
export type CheckedLanding = {
  /** The project's Project ID, which names its repo. */
  repo: string;
  /** The pushed head, as a commit to build. */
  prepared: PreparedCommit;
  /** The commits of `main` or of the draft's branch the pushed commits build on. */
  prerequisites: string[];
  /** The newest commit of `main` the pushed head holds. */
  base: string;
  pack: Uint8Array;
};

/** Whether the push landed, with its head's build, or why it was refused. */
export type Landing = { refused: PushRefusal } | { result: BuildResult };

/** The refusal of a push whose head doesn't build, with its build's errors. */
export function doesNotBuild(log: string): PushRefusal & { data: Record<string, unknown> } {
  const { build, truncated } = failedBuild(log);
  return {
    reason: "doesNotBuild",
    message: "Your branch's code doesn't build: fix its build errors, then push again.",
    data: { build, ...(truncated && { truncated }) },
  };
}

/** Builds the pushed head in the draft `draftId`'s sandbox, before anything is written. */
export const buildPushedHead = (env: Bindings, draftId: string, prepared: PreparedCommit) =>
  retried(() => buildInSandbox(env, draftId, prepared, { draftId, leftBy: "push" }));

/**
 * Lands the checked push `push` on the draft `draftId`, in its build queue: its commits must
 * include the branch's head, as it is now, and its head must build. A draft without code gets
 * its branch from the commit of `main` the push holds. A refused push writes nothing.
 */
export async function landPush(
  env: Bindings,
  draftId: string,
  push: CheckedLanding,
): Promise<Landing> {
  const code = env.DRAFT_CODE.getByName(draftId);
  const held = await code.held();
  if (held) {
    await retried(() => code.receive({ pack: push.pack, prerequisites: push.prerequisites }));
    // A commit landed on the draft since the push's checks, such as the agent's.
    if (!(await code.includesHead(push.prepared.commit))) return { refused: PULL_DRAFT_FIRST };
  }
  const built = await buildPushedHead(env, draftId, push.prepared);
  if (!built.ok) return { refused: doesNotBuild(built.log) };
  return { result: await landBuilt(env, draftId, push, built) };
}

/**
 * Lands the checked push `push`, whose head `built` built, on the draft `draftId`: a draft with
 * code must have received its commits already.
 */
export async function landBuilt(
  env: Bindings,
  draftId: string,
  push: CheckedLanding,
  built: Extract<SandboxBuild, { ok: true }>,
): Promise<BuildResult> {
  const code = env.DRAFT_CODE.getByName(draftId);
  // A draft with code received the push's commits as its checks began.
  if (!(await code.held())) {
    await retried(() => code.start({ repo: push.repo, commit: push.base }));
    await retried(() => code.receive({ pack: push.pack, prerequisites: push.prerequisites }));
  }
  return buildRevision(env, draftId, {
    leftBy: "push",
    prepared: push.prepared,
    built,
    mergedMain: push.base,
  });
}
