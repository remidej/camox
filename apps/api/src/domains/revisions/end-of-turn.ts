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
  | { outcome: "committedUnbuilt"; result: BuildResult };

/** The revision the draft holds for the working copy's tree as it is now, if any. */
async function revisionOfTree(env: Bindings, draftId: string) {
  const prepared = await retried(() =>
    env.DRAFT_CODE.getByName(draftId).prepareCommit({ message: MESSAGES.turn }),
  );
  return createDb(env.DB)
    .select({ id: revisions.id })
    .from(revisions)
    .where(and(eq(revisions.draftId, draftId), eq(revisions.tree, prepared.tree)))
    .get();
}

/**
 * Builds what a turn changed in the code of the draft `draftId`, which has code, as the turn
 * ends: whatever changed since its last revision, nothing when the agent's last `build` already
 * covered it. A passing build leaves a revision. `failedInARow` is how many end-of-turn builds of
 * this turn failed before this one: once this one makes `END_OF_TURN_BUILD_FAILURES`, the changes
 * are committed anyway, as a revision that isn't built. `building` runs before a build starts.
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
  if (await revisionOfTree(env, draftId)) return { outcome: "unchanged" };
  await building();
  const result = await buildRevision(env, draftId, { leftBy: "turn", run });
  if (result.ok) return { outcome: "built", result };
  if (failedInARow + 1 < END_OF_TURN_BUILD_FAILURES) return { outcome: "failed", result };
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
  "Your code changes don't build, so your turn isn't over: fix these errors, then end your " +
  "turn again. Editors don't see this message.\n\n" +
  JSON.stringify(result);

/** What the agent is told once the end of its turn failed to build too often in a row. */
export const explainUnbuilt =
  `Your code changes still don't build after ${END_OF_TURN_BUILD_FAILURES} tries, so Camox ` +
  "saved them as they are: the preview keeps showing the last version that built, and the " +
  "draft can't be published until its code builds. Don't change the code again in this turn. " +
  "Tell the editor what you couldn't do, in terms of what they see in the preview rather than " +
  "code, and that they can ask you again in this thread. Editors don't see this message.";
