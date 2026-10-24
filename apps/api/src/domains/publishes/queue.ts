import { and, eq, isNotNull } from "drizzle-orm";

import type { Database } from "../../db";
import type { Bindings } from "../../types";
import { drafts } from "../drafts/schema";
import { projects } from "../projects/schema";
import { PUBLISH_TURN_EVENT } from "./events";

// A project's queue of what moves Live's code: its publishes with code, the drafts in their
// publishing state and the publish whose batch committed, until it pushed to `main`, and an
// Upgrade ready to push to `main`. They run one at a time, in the order
// they joined, so a publish's squashed commit always sits on the `main` its revision merged, and
// an Upgrade's on the publish's (spec #560, section 13's open edge).

type Entry = { instanceId: string; at: number; kind: "publish" | "upgrade" };

/** The project's queue, by its row id, in the order the entries joined. */
async function queueOf(db: Database, projectId: number): Promise<Entry[]> {
  const [publishes, project] = await Promise.all([
    db
      .select({ instanceId: drafts.publishInstanceId, at: drafts.publishRequestedAt })
      .from(drafts)
      .where(and(eq(drafts.projectId, projectId), isNotNull(drafts.publishInstanceId))),
    db
      .select({
        instanceId: projects.upgradePushInstanceId,
        at: projects.upgradePushRequestedAt,
        pushing: projects.publishPushInstanceId,
        pushingSince: projects.publishPushRequestedAt,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .get(),
  ]);
  const entries: Entry[] = publishes.map(({ instanceId, at }) => ({
    instanceId: instanceId!,
    at: at ?? 0,
    kind: "publish",
  }));
  if (project?.pushing) {
    entries.push({ instanceId: project.pushing, at: project.pushingSince ?? 0, kind: "publish" });
  }
  if (project?.instanceId) {
    entries.push({ instanceId: project.instanceId, at: project.at ?? 0, kind: "upgrade" });
  }
  return entries.sort(
    (a, b) =>
      a.at - b.at || a.kind.localeCompare(b.kind) || a.instanceId.localeCompare(b.instanceId),
  );
}

/**
 * Whether it's the turn of the queue's entry `instanceId`, whether it waits for one before it,
 * or is no longer queued.
 */
export async function turnOf(db: Database, projectId: number, instanceId: string) {
  const queue = await queueOf(db, projectId);
  if (!queue.some((entry) => entry.instanceId === instanceId)) return "gone" as const;
  return queue[0]!.instanceId === instanceId ? ("turn" as const) : ("waiting" as const);
}

/**
 * Wakes the project's next publish with code, now that the entry before it left. An Upgrade
 * checks its turn by itself.
 */
export async function wakeNextPublish(env: Bindings, db: Database, projectId: number) {
  const [next] = await queueOf(db, projectId);
  if (next?.kind !== "publish") return;
  const instance = await env.PUBLISH_WORKFLOW.get(next.instanceId);
  await instance.sendEvent({ type: PUBLISH_TURN_EVENT, payload: {} });
}

/**
 * Puts the Upgrade `instanceId`, ready to push to the project's `main`, in its queue, unless it's
 * in it already. Returns the project's row id, or null for a project that was deleted.
 */
export async function queueUpgradePush(db: Database, projectUuid: string, instanceId: string) {
  const project = await db
    .select({ id: projects.id, queued: projects.upgradePushInstanceId })
    .from(projects)
    .where(eq(projects.uuid, projectUuid))
    .get();
  if (!project) return null;
  if (project.queued !== instanceId) {
    await db
      .update(projects)
      .set({ upgradePushInstanceId: instanceId, upgradePushRequestedAt: Date.now() })
      .where(eq(projects.id, project.id));
  }
  return project.id;
}

/** Takes the Upgrade `instanceId` out of its project's queue, and wakes the next publish. */
export async function leaveUpgradePush(
  env: Bindings,
  db: Database,
  projectId: number,
  instanceId: string,
) {
  await db
    .update(projects)
    .set({ upgradePushInstanceId: null, upgradePushRequestedAt: null })
    .where(and(eq(projects.id, projectId), eq(projects.upgradePushInstanceId, instanceId)));
  await wakeNextPublish(env, db, projectId);
}

/**
 * What the publish batch of `instanceId` runs to keep its place in the project's queue once its
 * draft's row is gone, until its push to `main` landed (`leavePublishPush`).
 */
export function holdPublishPush(
  db: Database,
  {
    projectId,
    instanceId,
    requestedAt,
  }: { projectId: number; instanceId: string; requestedAt: number },
) {
  return db
    .update(projects)
    .set({ publishPushInstanceId: instanceId, publishPushRequestedAt: requestedAt })
    .where(eq(projects.id, projectId));
}

/** Takes the publish `instanceId`, which pushed to `main`, out of its project's queue. */
export async function leavePublishPush(db: Database, projectId: number, instanceId: string) {
  await db
    .update(projects)
    .set({ publishPushInstanceId: null, publishPushRequestedAt: null })
    .where(and(eq(projects.id, projectId), eq(projects.publishPushInstanceId, instanceId)));
}
