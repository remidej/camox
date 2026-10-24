import type { PublishAbortReason } from "@camox/api-contract/drafts";
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowStepConfig,
} from "cloudflare:workers";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { Effect } from "effect";

import { createDb, type Database } from "../../db";
import { record } from "../../lib/journal";
import { runService } from "../../lib/run-service";
import type { Bindings } from "../../types";
import { discardCode } from "../code/drafts";
import { camoxContext, computePreview, publishWithCode } from "../drafts/publish";
import { drafts } from "../drafts/schema";
import { draftOf } from "../drafts/scope";
import { projects } from "../projects/schema";
import { releases } from "../releases/schema";
import { buildRevision } from "../revisions/build";
import { revisions } from "../revisions/schema";
import { promoteVersion, servedVersion, uploadVersion } from "./sandbox";

// Publishing a draft with code (ADR 0020, spec #560 section 13): its publish Workflow puts the
// build of the revision members previewed on Live, then the draft's content and definitions in
// the publish batch, then the revision's tree on `main`. A project's publishes with code run one
// at a time, in the order they were asked for: `drafts` in their publishing state are the queue.

/** What `drafts.publish` starts a publish with. */
export type PublishParams = {
  draftId: string;
  /** The project's row id. */
  projectId: number;
  /** The revision the review showed, which the publish ships. */
  revision: string;
  /** The publish token of the review, recording the conflicts it showed. */
  token: string;
  /** The member who published. */
  publishedBy: string;
};

/** The event a publish that ended sends the next one in its project's queue. */
export const PUBLISH_TURN_EVENT = "publish-turn";

/**
 * How long a queued publish waits for the event before it checks its turn anyway, in case an
 * event was lost. A tuning value.
 */
const TURN_CHECK_EVERY = "1 minute";

/** A few retries for what the sandbox, Artifacts or R2 fail at. */
const INFRASTRUCTURE_RETRIES: WorkflowStepConfig = {
  retries: { limit: 3, delay: "5 seconds", backoff: "exponential" },
};

/** What the publish ships: the revision's build and its commit, in the project's repo. */
type Shipped = {
  projectUuid: string;
  archiveKey: string;
  commit: string;
  tree: string;
  camoxVersion: string | null;
  draftName: string | null;
};

type Checked = { ship: Shipped } | { aborted: PublishAbortReason } | { gone: true };

export class PublishWorkflow extends WorkflowEntrypoint<Bindings, PublishParams> {
  async run(event: WorkflowEvent<PublishParams>, step: WorkflowStep) {
    const params = event.payload;
    const instanceId = event.instanceId;
    const db = createDb(this.env.DB);
    const abort = (reason: PublishAbortReason) =>
      step.do(`go back to the review: ${reason}`, () =>
        endPublishing(db, params, instanceId, reason),
      );

    try {
      if (!(await this.waitForTurn(step, db, params, instanceId))) return;

      // 1. The revision the review pinned must still be the draft's head.
      const checked = await step.do("check the revision is the draft's head", () =>
        this.check(db, params, instanceId),
      );
      if ("gone" in checked) return;
      if ("aborted" in checked) return await abort(checked.aborted);
      const { ship } = checked;

      // 2. Upload without serving.
      const version = await step.do("upload the Worker version", INFRASTRUCTURE_RETRIES, () =>
        uploadVersion(this.env, {
          project: ship.projectUuid,
          draft: params.draftId,
          archiveKey: ship.archiveKey,
        }),
      );

      // 3. Re-check conflicts, and blockers, against the review.
      const recheck = await step.do("re-check the conflicts", () => this.recheck(db, params));
      if (recheck) return await abort(recheck);

      // 4. Promote. From here until the batch commits, the version reads Live overlaid with the
      // publishing draft.
      const previous = await step.do("read the version Live serves", INFRASTRUCTURE_RETRIES, () =>
        servedVersion(this.env, ship.projectUuid),
      );
      await step.do("promote the Worker version", INFRASTRUCTURE_RETRIES, () =>
        promoteVersion(this.env, ship.projectUuid, version),
      );

      // 5. The publish batch, with the draft's definitions.
      const batch = await step.do("run the publish batch", () =>
        runService(publishWithCode(db, params)),
      );
      if (!batch.applied && batch.ended?.outcome !== "published") {
        if (previous) {
          await step.do("promote the previous version back", INFRASTRUCTURE_RETRIES, () =>
            promoteVersion(this.env, ship.projectUuid, previous),
          );
        }
        // A draft discarded while it published has no review to go back to.
        if (!batch.ended) {
          await abort(
            await step.do("tell why the batch aborted", () => this.whyAborted(db, params)),
          );
        }
        return;
      }

      // 6. Live serves the revision's tree: the push to `main` releases nothing.
      await step.do("record the tree Live serves", () =>
        recordServedTree(db, params, instanceId, ship),
      );

      // 7. One squashed commit on `main`.
      await step.do("push the squashed commit to main", INFRASTRUCTURE_RETRIES, async () => {
        const commit = await this.env.DRAFT_CODE.getByName(params.draftId).publishToMain({
          commit: ship.commit,
          message: ship.draftName ? `Publish "${ship.draftName}"` : "Publish a draft",
        });
        await db
          .update(releases)
          .set({ commit })
          .where(eq(releases.workflowInstanceId, instanceId));
      });

      // 8. The draft's branch, builds, working copy and sandbox.
      await step.do("delete the draft's code", () =>
        Effect.runPromise(
          discardCode(
            { env: this.env, db },
            { projectId: params.projectId, draftId: params.draftId },
          ),
        ),
      );
    } catch (error) {
      await step
        .do("go back to the review after a failure", () =>
          endPublishing(db, params, instanceId, "failed"),
        )
        .catch((ended: unknown) => console.error("A failed publish wasn't ended", ended));
      throw error;
    } finally {
      await step
        .do("wake the project's next publish", () => wakeNextPublish(this.env, db, params))
        .catch((woken: unknown) => console.error("The next publish wasn't woken", woken));
    }
  }

  /**
   * Waits until the draft's publish is the first in its project's queue. False when it's no
   * longer queued, as when the draft was discarded meanwhile.
   */
  private async waitForTurn(
    step: WorkflowStep,
    db: Database,
    params: PublishParams,
    instanceId: string,
  ) {
    for (let check = 1; ; check++) {
      const turn = await step.do(`check the project's turn (${check})`, () =>
        turnOf(db, params, instanceId),
      );
      if (turn !== "waiting") return turn === "turn";
      await step
        .waitForEvent(`wait for the project's turn (${check})`, {
          type: PUBLISH_TURN_EVENT,
          timeout: TURN_CHECK_EVERY,
        })
        .catch(() => undefined);
    }
  }

  /**
   * Step 1: the draft still previews the pinned revision, its head, with a build to upload. A
   * head whose build was pruned is built again in the draft's sandbox, which finds its tree.
   */
  private async check(db: Database, params: PublishParams, instanceId: string): Promise<Checked> {
    const draft = await publishingDraft(db, params.draftId, instanceId);
    if (!draft) return { gone: true };
    if (draft.headRevisionId !== params.revision || draft.previewedRevisionId !== params.revision) {
      return { aborted: "revisionChanged" };
    }
    if (!(await this.includesLiveCode(draft.projectUuid, params.draftId))) {
      return { aborted: "liveCodeMoved" };
    }
    let revision = await revisionOf(db, params.revision);
    if (revision && !revision.archiveKey) {
      const code = this.env.DRAFT_CODE.getByName(params.draftId);
      await code.markBuilding(true);
      try {
        const built = await buildRevision(this.env, params.draftId, { leftBy: "build" });
        if (built.revision !== params.revision) return { aborted: "revisionChanged" };
      } finally {
        await code.markBuilding(false);
      }
      revision = await revisionOf(db, params.revision);
    }
    if (!revision?.archiveKey) return { aborted: "revisionChanged" };
    return {
      ship: {
        projectUuid: draft.projectUuid,
        archiveKey: revision.archiveKey,
        commit: revision.commit,
        tree: revision.tree,
        camoxVersion: revision.camoxVersion,
        draftName: draft.name,
      },
    };
  }

  /**
   * Whether the draft's code holds the current `main`. Until merges of `main` into drafts land
   * (#581), a draft forked from an older `main` goes back to the review rather than undo what
   * moved it. That's where the publish will wait for the draft's merge revision instead.
   */
  private async includesLiveCode(projectUuid: string, draftId: string) {
    using repo = await this.env.ARTIFACTS.get(projectUuid);
    const [main] = await repo.log({ ref: "main", limit: 1 });
    const forkedFrom = await this.env.DRAFT_CODE.getByName(draftId).forkedFrom();
    return !main || main.hash === forkedFrom;
  }

  /** Step 3: why the review no longer holds, if it doesn't: Live's conflicts or a blocker. */
  private async recheck(db: Database, params: PublishParams) {
    const row = await db.select().from(drafts).where(eq(drafts.id, params.draftId)).get();
    if (!row) return null;
    const preview = await runService(computePreview(camoxContext(db), draftOf(row)));
    if (preview.token !== params.token) return "conflictsChanged" as const;
    if (preview.blockers.length > 0) return "blocked" as const;
    return null;
  }

  /** Why the batch aborted: the agent's newer revision, or Live's conflicts. */
  private async whyAborted(db: Database, params: PublishParams): Promise<PublishAbortReason> {
    const row = await db
      .select({ previewed: drafts.previewedRevisionId })
      .from(drafts)
      .where(eq(drafts.id, params.draftId))
      .get();
    return row && row.previewed !== params.revision ? "revisionChanged" : "conflictsChanged";
  }
}

/** The draft `instanceId` publishes, with its project's Project ID, while it still does. */
async function publishingDraft(db: Database, draftId: string, instanceId: string) {
  return db
    .select({
      name: drafts.name,
      headRevisionId: drafts.headRevisionId,
      previewedRevisionId: drafts.previewedRevisionId,
      projectUuid: projects.uuid,
    })
    .from(drafts)
    .innerJoin(projects, eq(projects.id, drafts.projectId))
    .where(and(eq(drafts.id, draftId), eq(drafts.publishInstanceId, instanceId)))
    .get();
}

async function revisionOf(db: Database, revisionId: string) {
  return db
    .select({
      commit: revisions.commit,
      tree: revisions.tree,
      archiveKey: revisions.archiveKey,
      camoxVersion: revisions.camoxVersion,
    })
    .from(revisions)
    .where(eq(revisions.id, revisionId))
    .get();
}

/** The project's publishes with code still to land, in the order they were asked for. */
function queueOf(db: Database, projectId: number) {
  return db
    .select({ draftId: drafts.id, instanceId: drafts.publishInstanceId })
    .from(drafts)
    .where(and(eq(drafts.projectId, projectId), isNotNull(drafts.publishInstanceId)))
    .orderBy(asc(drafts.publishRequestedAt), asc(drafts.id));
}

/** Whether it's this publish's turn, whether it waits for one before it, or is no longer queued. */
async function turnOf(db: Database, params: PublishParams, instanceId: string) {
  const queue = await queueOf(db, params.projectId);
  if (!queue.some((queued) => queued.instanceId === instanceId)) return "gone" as const;
  return queue[0]!.instanceId === instanceId ? ("turn" as const) : ("waiting" as const);
}

/** Wakes the project's next publish with code, now that this one ended. */
async function wakeNextPublish(env: Bindings, db: Database, params: PublishParams) {
  const [next] = await queueOf(db, params.projectId);
  if (!next?.instanceId) return;
  const instance = await env.PUBLISH_WORKFLOW.get(next.instanceId);
  await instance.sendEvent({ type: PUBLISH_TURN_EVENT, payload: {} });
}

/**
 * Takes the draft out of its publishing state, back to its review, saying why, and tells its
 * viewers, whose review refreshes. A draft another publish took over is left alone.
 */
async function endPublishing(
  db: Database,
  params: PublishParams,
  instanceId: string,
  reason: PublishAbortReason,
) {
  await runService(
    Effect.gen(function* () {
      const ended = yield* Effect.promise(() =>
        db
          .update(drafts)
          .set({
            publishingRevisionId: null,
            publishInstanceId: null,
            publishRequestedAt: null,
            publishAbortReason: reason,
          })
          .where(and(eq(drafts.id, params.draftId), eq(drafts.publishInstanceId, instanceId)))
          .returning({ id: drafts.id }),
      );
      if (ended.length > 0) yield* record(db, { kind: "drafts", projectId: params.projectId });
    }),
  );
}

/**
 * Records the release of this publish: Live serves the revision's tree from now on, so the push
 * of that tree to `main` releases nothing (../releases/README.md).
 */
async function recordServedTree(
  db: Database,
  params: PublishParams,
  instanceId: string,
  ship: Shipped,
) {
  const now = Date.now();
  await db
    .insert(releases)
    .values({
      projectId: params.projectId,
      commit: ship.commit,
      tree: ship.tree,
      camoxVersion: ship.camoxVersion,
      status: "succeeded",
      workflowInstanceId: instanceId,
      startedAt: now,
      endedAt: now,
    })
    .onConflictDoNothing({ target: releases.workflowInstanceId });
}
