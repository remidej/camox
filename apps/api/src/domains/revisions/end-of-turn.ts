import { generateUuidv7 } from "@camox/api-contract/ids";
import { and, eq } from "drizzle-orm";

import { createDb } from "../../db";
import { type SpanFields, timed } from "../../lib/timing";
import type { Bindings } from "../../types";
import { drafts } from "../drafts/schema";
import { camoxVersionInLockfile } from "../releases/lockfile";
import {
  BuildInfrastructureError,
  buildRevision,
  capped,
  MESSAGES,
  retried,
  type RevisionOrigin,
} from "./build";
import { lintable } from "./lint-log";
import type { BuildResult } from "./result";
import { lintInSandbox } from "./sandbox";
import { type RevisionBuildStatus, type RevisionTypeCheckStatus, revisions } from "./schema";

/**
 * How many end-of-turn builds may fail in a row, or find lint problems, before the turn commits
 * its changes anyway, as a revision that isn't built, or keeps them with their errors. Builds the
 * agent calls itself don't count. A tuning value.
 */
export const END_OF_TURN_BUILD_FAILURES = 3;

/** What the end of a turn did about the code the turn changed. */
export type TurnBuild =
  /** The turn's code already is a revision: nothing changed since the last one. */
  | { outcome: "unchanged" }
  | { outcome: "built"; result: BuildResult }
  /**
   * The turn's code builds, but lint found problems in the files it changed: the agent is handed
   * `result` to fix them. Once it had them too often, the turn ends `built`, with them.
   */
  | { outcome: "linted"; result: BuildResult }
  /** The build failed: the agent is handed `result` to fix it. */
  | { outcome: "failed"; result: BuildResult }
  /** The build failed once too often: the changes are committed anyway, as a revision not built. */
  | { outcome: "committedUnbuilt"; result: BuildResult }
  /**
   * The changes built, committed, but had errors once too often: type errors, or definitions the
   * draft can't use. They stay as they are.
   */
  | { outcome: "keptErrors"; result: BuildResult }
  /**
   * The build failed once too often, but its changes can't be committed as they are: the files
   * hold a merge of Live's code that Camox's reconcile turn didn't fix, or conflict markers.
   * Nothing is committed: `merging` says whether the files hold a merge.
   */
  | { outcome: "uncommitted"; result: BuildResult; merging: boolean };

/**
 * The working copy's tree as it is now, and the revision the draft holds for it, if any, its
 * preparation timed as the span `name`.
 */
async function revisionOfTree(
  env: Bindings,
  draftId: string,
  span: SpanFields,
  name = "agent.turnEnd.prepareCommit",
) {
  const prepared = await retried(
    () => env.DRAFT_CODE.getByName(draftId).prepareCommit({ message: MESSAGES.turn }),
    {
      name,
      fields: span,
      after: ({ files }) => ({ bytes: files.byteLength }),
    },
  );
  const revision = await createDb(env.DB)
    .select({
      id: revisions.id,
      buildStatus: revisions.buildStatus,
      typeCheckStatus: revisions.typeCheckStatus,
      previewed: drafts.previewedRevisionId,
    })
    .from(revisions)
    .innerJoin(drafts, eq(drafts.id, revisions.draftId))
    .where(and(eq(revisions.draftId, draftId), eq(revisions.tree, prepared.tree)))
    .get();
  return { prepared, revision };
}

/**
 * Whether the draft `draftId`, which has code, previews its working copy as it is now: a revision
 * holds every change, and it's the one the draft previews.
 */
export async function previewsWorkingCopy(env: Bindings, draftId: string, span: SpanFields) {
  const { revision } = await revisionOfTree(env, draftId, span, "look.prepareCommit");
  return revision !== undefined && revision.previewed === revision.id;
}

/**
 * Whether a revision is one the turn has nothing more to do about: one that built without errors
 * and that the draft previews, or one committed without a build once the limit was reached.
 */
function settled(revision: {
  id: string;
  buildStatus: RevisionBuildStatus;
  typeCheckStatus: RevisionTypeCheckStatus;
  previewed: string | null;
}) {
  if (revision.buildStatus === "notBuilt") return true;
  return (
    revision.buildStatus === "built" &&
    revision.typeCheckStatus === "passed" &&
    revision.previewed === revision.id
  );
}

/**
 * The files the turn changed that lint lints: those that differ from `base`, the commit the
 * draft's code was at as the turn started, or from the branch's head without it.
 */
async function filesToLint(env: Bindings, draftId: string, base: string | undefined) {
  const changed = await retried(() =>
    env.DRAFT_CODE.getByName(draftId).changedFiles({ since: base }),
  );
  return changed.filter(lintable);
}

/**
 * Lints `files` of the turn's tree, built already. Lint is for code quality: when Camox can't run
 * it, it finds nothing, and the turn goes on as if it found nothing.
 */
async function lintTree(
  env: Bindings,
  draftId: string,
  tree: Parameters<typeof lintInSandbox>[2],
  files: string[],
  span: SpanFields,
) {
  try {
    return await retried(() => lintInSandbox(env, draftId, tree, files, span), {
      name: "agent.turnEnd.lint",
      fields: span,
      after: (errors) => ({ lintErrors: errors.length }),
    });
  } catch (error) {
    if (!(error instanceof BuildInfrastructureError)) throw error;
    console.error("A turn ended without linting its code", error);
    return [];
  }
}

/**
 * What the end of a turn whose code builds does about `result`'s lint findings: hands them to the
 * agent, unless the end of the turn failed too often in a row with this one.
 */
function lintedOrBuilt(result: BuildResult, failedInARow: number): TurnBuild {
  if (result.lint.length === 0 || failedInARow + 1 >= END_OF_TURN_BUILD_FAILURES) {
    return { outcome: "built", result };
  }
  return { outcome: "linted", result };
}

/**
 * Builds what a turn changed in the code of the draft `draftId`, which has code, as the turn
 * ends: whatever changed since its last revision, nothing when the agent's last `build` already
 * covered it without errors. A passing build leaves a revision, even with type errors. A build
 * fails when it, its type check or its definitions have errors. `failedInARow` is how many
 * end-of-turn builds of this turn failed before this one: once this one makes
 * `END_OF_TURN_BUILD_FAILURES`, changes that didn't build are committed anyway, as a revision
 * that isn't built, and ones that did stay with their errors. `building` runs before a build
 * starts.
 *
 * The files the turn changed since `base`, the commit its code was at as it started, are linted
 * too, beside the build, or alone when the agent's builds covered its changes: findings in code
 * that builds hand the agent a `linted` result, and count as a failure, and the findings of a
 * build that fails come with its errors. Lint never fails a build, and the turn ends with
 * findings it had once too often.
 */
export async function buildAtEndOfTurn(
  env: Bindings,
  draftId: string,
  {
    run,
    failedInARow,
    building,
    base,
  }: {
    run?: RevisionOrigin["run"];
    failedInARow: number;
    building: () => Promise<void>;
    base?: string;
  },
): Promise<TurnBuild> {
  const span = { draftId, threadId: run?.threadId, runId: run?.runId, failedInARow };
  return timed(
    "agent.turnEnd",
    span,
    () => turnBuild(env, draftId, { run, failedInARow, building, base }, span),
    (turn) => ({
      outcome: turn.outcome,
      lintErrors: "result" in turn ? turn.result.lint.length : undefined,
    }),
  );
}

async function turnBuild(
  env: Bindings,
  draftId: string,
  { run, failedInARow, building, base }: Parameters<typeof buildAtEndOfTurn>[2],
  span: SpanFields,
): Promise<TurnBuild> {
  const { prepared, revision } = await revisionOfTree(env, draftId, span);
  const lint = await filesToLint(env, draftId, base);
  if (revision && settled(revision)) {
    // The agent's own build in this turn covered its changes: they're still to lint.
    if (revision.buildStatus !== "built" || lint.length === 0) return { outcome: "unchanged" };
    const found = await lintTree(env, draftId, prepared, lint, span);
    if (found.length === 0) return { outcome: "unchanged" };
    const { shown, total } = capped(found);
    const result = { ok: true, revision: revision.id, build: [], types: [], lint: shown };
    return lintedOrBuilt(
      total === undefined ? result : { ...result, truncated: { lint: total } },
      failedInARow,
    );
  }
  await building();
  const result = await buildRevision(env, draftId, { leftBy: "turn", run, lint });
  if (result.ok) return lintedOrBuilt(result, failedInARow);
  if (failedInARow + 1 < END_OF_TURN_BUILD_FAILURES) return { outcome: "failed", result };
  if (result.revision) return { outcome: "keptErrors", result };
  const code = env.DRAFT_CODE.getByName(draftId);
  const merging = (await retried(() => code.merging())) !== undefined;
  if (merging || (await retried(() => code.conflicts())).length > 0) {
    return { outcome: "uncommitted", result, merging };
  }
  await commitUnbuilt(env, draftId, { leftBy: "turn", run });
  return { outcome: "committedUnbuilt", result };
}

/**
 * Commits the working copy of the draft `draftId` as its new revision without a build, pushed to
 * its branch: a revision that isn't built, which the draft's preview doesn't show.
 */
async function commitUnbuilt(
  env: Bindings,
  draftId: string,
  { leftBy, run }: RevisionOrigin & { leftBy: keyof typeof MESSAGES },
) {
  const db = createDb(env.DB);
  const code = env.DRAFT_CODE.getByName(draftId);
  const prepared = await retried(() => code.prepareCommit({ message: MESSAGES[leftBy] }));
  const { commit, parents } = await retried(() => code.commit({ commit: prepared.commit }));
  await db
    .insert(revisions)
    .values({
      id: generateUuidv7(),
      draftId,
      commit,
      tree: prepared.tree,
      parents,
      leftBy,
      threadId: run?.threadId ?? null,
      runId: run?.runId ?? null,
      buildStatus: "notBuilt",
      typeCheckStatus: "pending",
      archiveKey: null,
      camoxVersion: prepared.lockfile ? camoxVersionInLockfile(prepared.lockfile) : null,
      createdAt: Date.now(),
    })
    // A build of the same tree recorded it first: it stays as it is.
    .onConflictDoNothing({ target: [revisions.draftId, revisions.tree] });
  const recorded = await db
    .select({ id: revisions.id })
    .from(revisions)
    .where(and(eq(revisions.draftId, draftId), eq(revisions.tree, prepared.tree)))
    .get();
  await db.update(drafts).set({ headRevisionId: recorded!.id }).where(eq(drafts.id, draftId));
}

/** What the agent is told when the end of its turn didn't build: its turn goes on. */
export const fixBuild = (result: BuildResult) =>
  (result.revision
    ? "Your code changes built, but they have errors, so your turn isn't over: fix them, " +
      "then end your turn again. "
    : "Your code changes don't build, so your turn isn't over: fix these errors, then end " +
      "your turn again. ") +
  (result.lint.length > 0 ? "Fix the problems lint found in the files you changed too. " : "") +
  "Editors don't see this message.\n\n" +
  JSON.stringify(result);

/** What the agent is told when the code its turn changed builds, but lint found problems in it. */
export const fixLint = (result: BuildResult) =>
  "Your code changes build, and the preview shows them, but lint found these problems in the " +
  "files you changed, so your turn isn't over: fix them, then end your turn again. Editors " +
  "don't see this message.\n\n" +
  JSON.stringify(result);

const EXPLAIN =
  "Don't change the code again in this turn. Tell the editor what you couldn't do, in terms " +
  "of what they see in the preview rather than code, and that they can ask you again in this " +
  "thread. Editors don't see this message.";

/** What the agent is told once the end of its turn failed too often in a row. */
export function explainFailures(
  turn: Extract<TurnBuild, { outcome: "committedUnbuilt" | "keptErrors" | "uncommitted" }>,
) {
  if (turn.outcome === "uncommitted") {
    return turn.merging
      ? `Live's code still doesn't merge with this draft's after ${END_OF_TURN_BUILD_FAILURES} ` +
          "tries, so Camox saved nothing: the preview keeps showing the draft's last version, " +
          "and the draft can't be published until its code merges with Live's. " +
          EXPLAIN
      : `Your code changes still have conflict markers after ${END_OF_TURN_BUILD_FAILURES} ` +
          "tries, so Camox saved nothing: the preview keeps showing the last version that " +
          `built, and publishing the draft leaves these changes out. ${EXPLAIN}`;
  }
  if (turn.outcome === "committedUnbuilt") {
    return (
      `Your code changes still don't build after ${END_OF_TURN_BUILD_FAILURES} tries, so ` +
      "Camox saved them as they are: the preview keeps showing the last version that built, " +
      `and the draft can't be published until its code builds. ${EXPLAIN}`
    );
  }
  // A built revision's build errors are definitions the draft can't use: it doesn't preview it.
  if (turn.result.build.length > 0) {
    return (
      `Your code changes still have errors after ${END_OF_TURN_BUILD_FAILURES} tries, so ` +
      "Camox kept them as they are: the preview keeps showing the last version that worked. " +
      EXPLAIN
    );
  }
  return (
    `Your code changes still have type errors after ${END_OF_TURN_BUILD_FAILURES} tries. ` +
    "They built, so the preview shows them, but the draft can't be published until its code " +
    `type checks. ${EXPLAIN}`
  );
}
