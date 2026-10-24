import type { PublishAbortReason } from "@camox/api-contract/drafts";
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowStepConfig,
} from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
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
import { DRAFT_MERGED_EVENT, PUBLISH_TURN_EVENT } from "./events";
import { turnOf, wakeNextPublish } from "./queue";
import { promoteVersion, servedVersion, uploadVersion } from "./sandbox";

// Publishing a draft with code (ADR 0020, spec #560 section 13): its publish Workflow puts the
// build of the revision members previewed on Live, then the draft's content and definitions in
// the publish batch, then the revision's tree on `main`. A project's publishes with code run one
// at a time, in the order they were asked for, with Upgrades' pushes to `main` (`queue.ts`).

export { PUBLISH_TURN_EVENT };

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

/**
 * How long a queued publish waits for the event before it checks its turn anyway, in case an
 * event was lost. A tuning value.
 */
const TURN_CHECK_EVERY = "1 minute";

/** A few retries for what the sandbox, Artifacts or R2 fail at. */
const INFRASTRUCTURE_RETRIES: WorkflowStepConfig = {
  retries: { limit: 3, delay: "5 seconds", backoff: "exponential" },
};

/**
 * How long a publish waits for its draft's merge of the `main` that moved, between checks: it's
 * woken as soon as the merge ends, so this only bounds a lost event. A tuning value.
 */
const MERGE_CHECK_EVERY = "1 minute";
/**
 * How many times a publish checks for its draft's merge before going back to the review: the
 * merge waits for the release of `main`, which takes minutes. A tuning value.
 */
export const MERGE_CHECKS = 30;

/** What the publish ships: the revision's build and its commit, in the project's repo. */
type Shipped = {
  /** The revision: the one the review pinned, or the draft's merge of `main` on top of it. */
  revision: string;
  projectUuid: string;
  archiveKey: string;
  commit: string;
  tree: string;
  camoxVersion: string | null;
  draftName: string | null;
};

type Checked =
  | { ship: Shipped }
  | { aborted: PublishAbortReason }
  | { gone: true }
  | { merging: true };

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

      // 1. The revision the review pinned must still be the draft's head, or the draft's merges
      // of `main` on top of it: when `main` moved, the publish waits for the merge, and ships it.
      const checked = await this.waitForHead(step, db, params, instanceId);
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
        runService(publishWithCode(db, { ...params, revision: ship.revision })),
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
        .do("wake the project's next publish", () =>
          wakeNextPublish(this.env, db, params.projectId),
        )
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
        turnOf(db, params.projectId, instanceId),
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
   * Step 1: the draft still previews the pinned revision, its head, with a build to upload, and
   * holds the current `main`. When `main` moved, the head to ship is the draft's merge of it on
   * top of the pinned revision, once built, previewed and type checked: until then, the publish
   * is `merging`. A head whose build was pruned is built again in the draft's sandbox, which
   * finds its tree.
   */
  private async check(db: Database, params: PublishParams, instanceId: string): Promise<Checked> {
    const draft = await publishingDraft(db, params.draftId, instanceId);
    if (!draft) return { gone: true };
    const head = draft.headRevisionId;
    if (!head || !(await mergesOnto(db, params.draftId, head, params.revision))) {
      return { aborted: "revisionChanged" };
    }
    const code = this.env.DRAFT_CODE.getByName(params.draftId);
    using repo = await this.env.ARTIFACTS.get(draft.projectUuid);
    const [[main], merges] = await Promise.all([
      repo.log({ ref: "main", limit: 1 }),
      code.merges(),
    ]);
    let revision = await revisionOf(db, head);
    if (!revision) return { aborted: "revisionChanged" };
    // `main` moved, and the draft hasn't merged it yet: its merge revision is what ships.
    if (main && (main.hash !== merges.mergedMain || merges.head !== revision.commit)) {
      // A merge that clashed goes back to the draft, with its blocker, as Camox's turn fixes it.
      return merges.clash?.main === main.hash ? { aborted: "codeDoesNotMerge" } : { merging: true };
    }
    if (head !== params.revision) {
      // A merge revision ships once the draft previews it, and it type checks.
      if (draft.previewedRevisionId !== head || revision.typeCheckStatus === "pending") {
        return { merging: true };
      }
      if (revision.typeCheckStatus === "failed") return { aborted: "codeDoesNotMerge" };
    } else if (draft.previewedRevisionId !== head) return { aborted: "revisionChanged" };
    if (!revision.archiveKey) {
      await code.markBuilding(true);
      try {
        const built = await buildRevision(this.env, params.draftId, { leftBy: "build" });
        if (built.revision !== head) return { aborted: "revisionChanged" };
      } finally {
        await code.markBuilding(false);
      }
      revision = await revisionOf(db, head);
    }
    if (!revision?.archiveKey) return { aborted: "revisionChanged" };
    return {
      ship: {
        revision: head,
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
   * Step 1, checked again while the draft merges the `main` that moved, woken as its merge ends.
   * A merge that takes too long goes back to the review.
   */
  private async waitForHead(
    step: WorkflowStep,
    db: Database,
    params: PublishParams,
    instanceId: string,
  ): Promise<Exclude<Checked, { merging: true }>> {
    for (let check = 1; ; check++) {
      const checked = await step.do(`check the revision is the draft's head (${check})`, () =>
        this.check(db, params, instanceId),
      );
      if (!("merging" in checked)) return checked;
      if (check >= MERGE_CHECKS) return { aborted: "liveCodeMoved" };
      await step
        .waitForEvent(`wait for the draft's merge of main (${check})`, {
          type: DRAFT_MERGED_EVENT,
          timeout: MERGE_CHECK_EVERY,
        })
        .catch(() => undefined);
    }
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
      typeCheckStatus: revisions.typeCheckStatus,
    })
    .from(revisions)
    .where(eq(revisions.id, revisionId))
    .get();
}

/**
 * Whether the draft's revision `head` is `pinned`, or merges of `main` on top of it: no agent
 * revision came after the one the review showed.
 */
async function mergesOnto(db: Database, draftId: string, head: string, pinned: string) {
  const left = await db
    .select({
      id: revisions.id,
      commit: revisions.commit,
      parents: revisions.parents,
      leftBy: revisions.leftBy,
    })
    .from(revisions)
    .where(eq(revisions.draftId, draftId));
  const byId = new Map(left.map((revision) => [revision.id, revision]));
  const byCommit = new Map(left.map((revision) => [revision.commit, revision]));
  for (let at = byId.get(head); at; at = byCommit.get(at.parents[0] ?? "")) {
    if (at.id === pinned) return true;
    if (at.leftBy !== "merge") return false;
  }
  return false;
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
