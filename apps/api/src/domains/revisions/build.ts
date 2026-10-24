import { generateUuidv7 } from "@camox/api-contract/ids";
import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";

import { createDb } from "../../db";
import { runService } from "../../lib/run-service";
import type { Bindings } from "../../types";
import { syncRevisionDefinitions } from "../definitions/service";
import { drafts } from "../drafts/schema";
import { projects } from "../projects/schema";
import { camoxVersionInLockfile } from "../releases/lockfile";
import { revisionArchiveKey } from "./archive";
import { buildErrorsOf } from "./build-log";
import { type BuildResult, ERRORS_SHOWN } from "./result";
import { buildInSandbox } from "./sandbox";
import { revisions, type RevisionSource } from "./schema";

/** How many times a step that fails on Camox's side is tried, the first try included. */
export const INFRASTRUCTURE_ATTEMPTS = 4;
/** How long the first retry of such a step waits, doubling for each one after. */
export const INFRASTRUCTURE_RETRY_DELAY_MS = 500;

/**
 * A build that couldn't run because of Camox's own infrastructure (the sandbox, Artifacts, R2,
 * the loader),
 * after its retries: never a problem with the agent's code.
 */
export class BuildInfrastructureError extends Error {
  override name = "BuildInfrastructureError";
  constructor(cause: unknown) {
    super(
      "Camox couldn't build your changes because of a problem on its side, not in your code, " +
        "which it already retried. Don't change the code for it: build again later, and if it " +
        "keeps failing, tell the editor the preview can't be updated right now.",
      { cause },
    );
  }
}

/** Runs `step`, trying it again after a failure, with a growing delay, before giving up. */
export async function retried<T>(step: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await step();
    } catch (error) {
      if (attempt >= INFRASTRUCTURE_ATTEMPTS) throw new BuildInfrastructureError(error);
      console.warn("A revision's build step failed, and is tried again", error);
      await scheduler.wait(INFRASTRUCTURE_RETRY_DELAY_MS * 2 ** (attempt - 1));
    }
  }
}

/** What a list of errors becomes in a result: its first `ERRORS_SHOWN`, and its total if longer. */
export function capped<T>(errors: T[]) {
  return {
    shown: errors.slice(0, ERRORS_SHOWN),
    total: errors.length > ERRORS_SHOWN ? errors.length : undefined,
  };
}

const passed = (revision: string): BuildResult => ({
  ok: true,
  revision,
  build: [],
  types: [],
  lint: [],
});

/** What left a revision, and the thread run that did, if one did. */
export type RevisionOrigin = {
  leftBy: RevisionSource;
  run?: { threadId: string; runId: string };
};

/**
 * Makes a built revision's definitions its draft's, unless the draft already previews it: reads
 * the revision's Definition Set through dispatch, and syncs it into the draft, which then
 * previews the revision. A set the API refuses is the build's error: the revision stays built,
 * but the draft keeps its definitions.
 */
async function syncDefinitionsOf(
  env: Bindings,
  draft: { id: string; projectUuid: string; previewedRevisionId: string | null },
  revision: { id: string; archiveKey: string },
): Promise<BuildResult> {
  if (draft.previewedRevisionId === revision.id) return passed(revision.id);
  const definitionSet = await retried(() =>
    env.DISPATCH.readDefinitionSet({
      revision: revision.id,
      archiveKey: revision.archiveKey,
      project: draft.projectUuid,
      draft: draft.id,
    }),
  );
  const ctx = {
    db: createDb(env.DB),
    user: null,
    env,
    waitUntil: (promise: Promise<unknown>) => void promise.catch(console.error),
    client: "camox-agent",
    telemetryDisabled: false,
    draft: null,
  };
  try {
    await runService(
      syncRevisionDefinitions(ctx, {
        draftId: draft.id,
        revisionId: revision.id,
        definitionSet,
      }),
    );
  } catch (error) {
    if (!(error instanceof ORPCError) || error.code !== "BAD_REQUEST") throw error;
    return {
      ok: false,
      revision: revision.id,
      build: [
        {
          file: "",
          line: 0,
          column: 0,
          message: `The build passed, but its definitions can't be used: ${error.message}`,
          frame: "",
        },
      ],
      types: [],
      lint: [],
    };
  }
  return passed(revision.id);
}

export const MESSAGES: Record<RevisionSource, string> = {
  build: "Camox's agent built its changes",
  turn: "Camox's agent ended its turn",
  merge: "Merge Live's code",
};

/**
 * Builds the working copy of the draft `draftId`, which has code, and when the build passes,
 * commits it as the draft's new revision, pushed to its branch, with its build stored in R2, and
 * makes its definitions the draft's. A tree that already has a built revision returns it without
 * building again, so a call replayed after an eviction is safe. A failed build commits nothing and
 * returns its errors.
 *
 * Failures of the sandbox, Artifacts, R2 or the loader are retried, and throw a `BuildInfrastructureError`
 * once they've failed too often: they're never the build's errors.
 */
export async function buildRevision(
  env: Bindings,
  draftId: string,
  { leftBy, run }: RevisionOrigin,
): Promise<BuildResult> {
  const db = createDb(env.DB);
  const draft = await db
    .select({
      id: drafts.id,
      projectUuid: projects.uuid,
      previewedRevisionId: drafts.previewedRevisionId,
    })
    .from(drafts)
    .innerJoin(projects, eq(projects.id, drafts.projectId))
    .where(eq(drafts.id, draftId))
    .get();
  if (!draft) throw new Error("The draft to build ended");
  const code = env.DRAFT_CODE.getByName(draftId);
  const prepared = await retried(() => code.prepareCommit({ message: MESSAGES[leftBy] }));
  const existing = await db
    .select({
      id: revisions.id,
      buildStatus: revisions.buildStatus,
      archiveKey: revisions.archiveKey,
    })
    .from(revisions)
    .where(and(eq(revisions.draftId, draftId), eq(revisions.tree, prepared.tree)))
    .get();
  if (existing?.buildStatus === "built" && existing.archiveKey) {
    return syncDefinitionsOf(env, draft, { id: existing.id, archiveKey: existing.archiveKey });
  }

  const outcome = await retried(() => buildInSandbox(env, draftId, prepared));
  if (!outcome.ok) {
    const { shown, total } = capped(buildErrorsOf(outcome.log));
    return {
      ok: false,
      build: shown,
      types: [],
      lint: [],
      ...(total === undefined ? {} : { truncated: { build: total } }),
    };
  }

  const revisionId = existing?.id ?? generateUuidv7();
  const archiveKey = revisionArchiveKey({
    project: draft.projectUuid,
    draft: draftId,
    revision: revisionId,
  });
  await retried(() => env.REVISION_BUILDS.put(archiveKey, outcome.archive));
  const { commit, parents } = await retried(() => code.commit({ commit: prepared.commit }));
  const built = {
    commit,
    parents,
    buildStatus: "built" as const,
    archiveKey,
  };
  const [recorded] = await db
    .insert(revisions)
    .values({
      id: revisionId,
      draftId,
      tree: prepared.tree,
      leftBy,
      threadId: run?.threadId ?? null,
      runId: run?.runId ?? null,
      typeCheckStatus: "pending",
      camoxVersion: prepared.lockfile ? camoxVersionInLockfile(prepared.lockfile) : null,
      createdAt: Date.now(),
      ...built,
    })
    // A concurrent build of the same tree recorded it first.
    .onConflictDoUpdate({ target: [revisions.draftId, revisions.tree], set: built })
    .returning({ id: revisions.id });
  await db.update(drafts).set({ headRevisionId: recorded!.id }).where(eq(drafts.id, draftId));
  return syncDefinitionsOf(env, draft, { id: recorded!.id, archiveKey });
}
