import { generateUuidv7 } from "@camox/api-contract/ids";
import type { StartedDraft } from "@camox/api-contract/threads";
import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import type { ServiceContext } from "../_shared/service-context";
import { writeAccessWhilePublishing } from "../drafts/access";
import { drafts } from "../drafts/schema";
import type { DraftRequest } from "../drafts/scope";
import { findEndedDraft } from "../drafts/service";
import { liveThreads } from "./schema";

/**
 * An editor's current Live thread in a project, starting one the first time: its id, and the
 * draft their previous Live thread continued in, if any.
 */
export const currentLiveThread = Effect.fn("currentLiveThread")(function* (
  db: Database,
  projectId: number,
  userId: string,
) {
  yield* Effect.promise(() =>
    db
      .insert(liveThreads)
      .values({ threadId: generateUuidv7(), projectId, userId, createdAt: Date.now() })
      .onConflictDoNothing(),
  );
  const thread = yield* Effect.promise(() =>
    db
      .select({ threadId: liveThreads.threadId, continuedIn: liveThreads.continuedIn })
      .from(liveThreads)
      .where(and(eq(liveThreads.projectId, projectId), eq(liveThreads.userId, userId)))
      .get(),
  );
  if (!thread) return yield* Effect.die(new Error("The Live thread vanished as it was started"));
  return thread;
});

/**
 * Gives the editor a fresh Live thread once their current one became the thread of the draft its
 * first write started, linking to that draft. The draft recorded the thread as it was created,
 * and nothing is copied. Repeating it changes nothing.
 */
export const moveLiveThreadIntoDraft = Effect.fn("moveLiveThreadIntoDraft")(function* (
  db: Database,
  move: { threadId: string; startedDraft: StartedDraft },
) {
  const { threadId, startedDraft } = move;
  yield* Effect.promise(() =>
    db
      .update(liveThreads)
      .set({ threadId: generateUuidv7(), createdAt: Date.now(), continuedIn: startedDraft })
      .where(eq(liveThreads.threadId, threadId)),
  );
});

/**
 * Where the draft a Live thread's write set out to start stands: `started` with the thread as
 * its own, `ended` (published or discarded) since, or `unstarted` while no write created it.
 */
export const reservedDraftState = Effect.fn("reservedDraftState")(function* (
  db: Database,
  reserved: { projectId: number; draftId: string; threadId: string },
) {
  const { projectId, draftId, threadId } = reserved;
  const draft = yield* Effect.promise(() =>
    db.select({ threadId: drafts.threadId }).from(drafts).where(eq(drafts.id, draftId)).get(),
  );
  if (draft) {
    // Only the thread's own writes create the draft, recording it as they do.
    if (draft.threadId !== threadId) {
      return yield* Effect.die(new Error("A draft set aside for a thread belongs to another"));
    }
    return "started" as const;
  }
  return (yield* findEndedDraft(db, projectId, draftId))
    ? ("ended" as const)
    : ("unstarted" as const);
});

/** The id of a draft's thread, once someone opened it: null before. */
const threadOfDraft = Effect.fn("threadOfDraft")(function* (db: Database, draftId: string) {
  const row = yield* Effect.promise(() =>
    db.select({ threadId: drafts.threadId }).from(drafts).where(eq(drafts.id, draftId)).get(),
  );
  return row?.threadId ?? null;
});

/**
 * The draft a member's request names, with its thread's id: a draft has at most one thread. The
 * id is set aside the first time someone opens the draft's thread, so everyone in the draft
 * reaches the same one; the thread itself only starts with its first message. Its runs change
 * the draft's content, so content access checks the draft as for a write: only members reach a
 * regular draft's thread, and only its developer a development draft's.
 */
export const draftThread = Effect.fn("draftThread")(function* (
  ctx: ServiceContext & { draft: DraftRequest },
  projectId: number,
) {
  const { scope: draft } = yield* Effect.scoped(
    writeAccessWhilePublishing(ctx, { project: projectId }),
  );
  yield* Effect.promise(() =>
    ctx.db
      .update(drafts)
      .set({ threadId: generateUuidv7() })
      .where(and(eq(drafts.id, draft.id), isNull(drafts.threadId))),
  );
  const threadId = yield* threadOfDraft(ctx.db, draft.id);
  if (!threadId) return yield* Effect.die(new Error("The draft vanished as its thread started"));
  return { draft, threadId };
});

/**
 * A draft's thread, as a publish or discard ends the draft, read before it does. Its `statements`
 * join the batch ending the draft, letting go of the thread there: a development draft stays
 * open, so the next one to open its thread starts a new one, and a regular draft lets go of it
 * with its row. An editor whose Live thread it still is gets a fresh one. Once the batch applied, `end` deletes the thread, which wipes what it stored
 * and turns away whatever reaches it after.
 *
 * The draft ended either way, so `end` never fails: a thread it couldn't reach is only reported.
 */
export const endingThread = Effect.fn("endingThread")(function* (
  ctx: Pick<ServiceContext, "db" | "env">,
  draftId: string,
) {
  const threadId = yield* threadOfDraft(ctx.db, draftId);
  if (!threadId) return { statements: [], end: Effect.void };
  return {
    statements: [
      ctx.db
        .update(drafts)
        .set({ threadId: null })
        .where(and(eq(drafts.id, draftId), eq(drafts.threadId, threadId))),
      // A Live thread whose write started the draft is the draft's from then on, even if it
      // hadn't moved into it yet: its editor's Live thread starts fresh.
      ctx.db
        .update(liveThreads)
        .set({ threadId: generateUuidv7(), createdAt: Date.now(), continuedIn: null })
        .where(eq(liveThreads.threadId, threadId)),
    ],
    end: Effect.promise(async () => {
      try {
        await ctx.env.THREAD.getByName(threadId).end();
      } catch (error) {
        console.error("A thread didn't end with its draft", error);
      }
    }).pipe(Effect.withSpan("endThread")),
  };
});
