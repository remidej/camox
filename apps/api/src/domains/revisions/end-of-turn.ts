import { generateUuidv7 } from "@camox/api-contract/ids";
import { and, eq } from "drizzle-orm";

import { createDb } from "../../db";
import type { Bindings } from "../../types";
import { drafts } from "../drafts/schema";
import { camoxVersionInLockfile } from "../releases/lockfile";
import { buildRevision, MESSAGES, retried, type RevisionOrigin } from "./build";
import type { BuildResult } from "./result";
import { revisions } from "./schema";

/**
 * How many end-of-turn builds may fail in a row before the turn commits its changes anyway, as a
 * revision that isn't built. Builds the agent calls itself don't count. A tuning value.
 */
export const END_OF_TURN_BUILD_FAILURES = 3;

/** What the end of a turn did about the code the turn changed. */
export type TurnBuild =
  /** The turn's code already is a revision: nothing changed since the last one. */
  | { outcome: "unchanged" }
  | { outcome: "built"; result: BuildResult }
  /** The build failed: the agent is handed `result` to fix it. */
  | { outcome: "failed"; result: BuildResult }
  /** The build failed once too often: the changes are committed anyway, as a revision not built. */
  | { outcome: "committedUnbuilt"; result: BuildResult }
  /**
   * The changes built, committed, but had errors once too often: type errors, or definitions the
   * draft can't use. They stay as they are.
   */
  | { outcome: "keptErrors"; result: BuildResult };

/**
 * Whether the working copy's tree as it is now is a revision the turn has nothing more to do
 * about: one that built without errors and that the draft previews, or one committed without a
 * build once the limit was reached.
 */
async function treeSettled(env: Bindings, draftId: string) {
  const prepared = await retried(() =>
    env.DRAFT_CODE.getByName(draftId).prepareCommit({ message: MESSAGES.turn }),
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
  if (!revision) return false;
  if (revision.buildStatus === "notBuilt") return true;
  return (
    revision.buildStatus === "built" &&
    revision.typeCheckStatus === "passed" &&
    revision.previewed === revision.id
  );
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
 */
export async function buildAtEndOfTurn(
  env: Bindings,
  draftId: string,
  {
    run,
    failedInARow,
    building,
  }: { run?: RevisionOrigin["run"]; failedInARow: number; building: () => Promise<void> },
): Promise<TurnBuild> {
  if (await treeSettled(env, draftId)) return { outcome: "unchanged" };
  await building();
  const result = await buildRevision(env, draftId, { leftBy: "turn", run });
  if (result.ok) return { outcome: "built", result };
  if (failedInARow + 1 < END_OF_TURN_BUILD_FAILURES) return { outcome: "failed", result };
  if (result.revision) return { outcome: "keptErrors", result };
  await commitUnbuilt(env, draftId, { leftBy: "turn", run });
  return { outcome: "committedUnbuilt", result };
}

/**
 * Commits the working copy of the draft `draftId` as its new revision without a build, pushed to
 * its branch: a revision that isn't built, which the draft's preview doesn't show.
 */
async function commitUnbuilt(env: Bindings, draftId: string, { leftBy, run }: RevisionOrigin) {
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
  "Editors don't see this message.\n\n" +
  JSON.stringify(result);

const EXPLAIN =
  "Don't change the code again in this turn. Tell the editor what you couldn't do, in terms " +
  "of what they see in the preview rather than code, and that they can ask you again in this " +
  "thread. Editors don't see this message.";

/** What the agent is told once the end of its turn failed too often in a row. */
export function explainFailures(
  turn: Extract<TurnBuild, { outcome: "committedUnbuilt" | "keptErrors" }>,
) {
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
