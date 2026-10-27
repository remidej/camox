import type { EndedDraft } from "@camox/api-contract/drafts";
import { and, eq, not, sql } from "drizzle-orm";
import { Effect } from "effect";

import { record } from "../../lib/journal";
import type { ServiceContext } from "../_shared/service-context";
import { hasPendingTranslations } from "../translations/service";
import * as overlay from "./overlay";
import { peopleNamed, personOf } from "./people";
import { drafts, endedDrafts } from "./schema";
import { draftOf, type Draft, type DraftScope } from "./scope";

// Drafts' lifecycle outside a request: starting, dropping and finding how one ended. Requests
// reach their draft through content access (`access.ts`).

/** How a project's draft ended and who ended it, or undefined while it hasn't ended. */
export const findEndedDraft = Effect.fn("findEndedDraft")(function* (
  db: ServiceContext["db"],
  projectId: number,
  draftId: string,
) {
  const ended = yield* Effect.promise(() =>
    db
      .select()
      .from(endedDrafts)
      .where(and(eq(endedDrafts.id, draftId), eq(endedDrafts.projectId, projectId)))
      .get(),
  );
  if (!ended) return undefined;
  const people = yield* peopleNamed(db, [ended.endedBy]);
  return {
    draftId: ended.id,
    outcome: ended.outcome,
    endedBy: personOf(people, ended.endedBy),
    endedAt: ended.endedAt,
  } satisfies EndedDraft;
});

/**
 * Creates a draft unless its id is taken or belonged to a draft that ended, so an ended
 * draft never comes back, with the thread it starts with if any, and the Live thread whose agent
 * started it, if any. Whether this call created it.
 */
export const startDraft = Effect.fn("startDraft")(function* (
  db: ServiceContext["db"],
  draft: {
    id: string;
    projectId: number;
    createdBy: string;
    name: string | null;
    threadId?: string | null;
    liveThreadId?: string | null;
  },
) {
  // Two requests racing to start the same draft both land here; the primary key keeps one.
  // The insert skips an ended draft's id in the same statement, so it can't race an ending.
  const inserted = yield* Effect.promise(() =>
    db.run(sql`
      insert into ${drafts} (id, project_id, name, created_by, created_at, thread_id, live_thread_id)
      select ${draft.id}, ${draft.projectId}, ${draft.name}, ${draft.createdBy}, ${Date.now()}, ${draft.threadId ?? null}, ${draft.liveThreadId ?? null}
      where not exists (select 1 from ${endedDrafts} where ${endedDrafts.id} = ${draft.id})
      on conflict do nothing`),
  );
  const started = inserted.meta.changes > 0;
  if (started) yield* record(db, { kind: "drafts", projectId: draft.projectId });
  return started;
});

/**
 * Deletes a draft in one statement, only while it stores nothing and has nothing left to
 * translate. Whether it deleted it.
 */
export const dropIfEmpty = (db: ServiceContext["db"], scope: Draft) =>
  Effect.promise(async () => {
    const dropped = await db
      .delete(drafts)
      .where(
        and(
          eq(drafts.id, scope.id),
          not(overlay.storesAnything(scope)),
          not(hasPendingTranslations(scope.id)),
        ),
      );
    return dropped.meta.changes > 0;
  });

/**
 * The scope a background job scheduled from `draftId` runs in: Live for `null`, or undefined
 * when the draft has ended since, so the job does nothing (ADR 0012).
 */
export const draftScopeOfJob = Effect.fn("draftScopeOfJob")(function* (
  db: ServiceContext["db"],
  draftId: string | null,
) {
  if (draftId === null) return null satisfies DraftScope;
  const draft = yield* Effect.promise(() =>
    db.select().from(drafts).where(eq(drafts.id, draftId)).get(),
  );
  if (!draft) return undefined;
  return draftOf(draft);
});
