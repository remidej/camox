import { generateUuidv7 } from "@camox/api-contract/ids";
import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";

import { isProjectMember } from "../../authorization";
import type { Database } from "../../db";
import type { ServiceContext } from "../_shared/service-context";
import { writeAccessWhilePublishing } from "../drafts/access";
import { drafts } from "../drafts/schema";
import type { DraftRequest } from "../drafts/scope";
import { startDraft } from "../drafts/service";
import { liveThreads } from "./schema";

/**
 * An editor's Live thread in a project, starting it the first time: its id, which it keeps for
 * good (ADR 0025).
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
      .select({ threadId: liveThreads.threadId })
      .from(liveThreads)
      .where(and(eq(liveThreads.projectId, projectId), eq(liveThreads.userId, userId)))
      .get(),
  );
  if (!thread) return yield* Effect.die(new Error("The Live thread vanished as it was started"));
  return thread;
});

/**
 * Starts the regular draft the agent on Live hands a request off to (`startDraft`), named
 * `name` and created by `editorId`, the editor whose message started the run, while they're
 * still a member. It records its own thread's id, set aside here, and the Live thread that
 * started it, which ending the draft tells. Repeating it with the same ids changes nothing, and
 * an id that belonged to a draft that ended starts nothing: whether the draft is open.
 */
export const startDraftFromLive = Effect.fn("startDraftFromLive")(function* (
  db: Database,
  start: {
    projectId: number;
    editorId: string;
    draftId: string;
    threadId: string;
    liveThreadId: string;
    name: string;
  },
) {
  const { projectId, editorId, draftId, threadId, liveThreadId, name } = start;
  if (!(yield* isProjectMember(db, projectId, editorId))) {
    return yield* Effect.die(new Error("The editor who asked is no longer a member"));
  }
  yield* startDraft(db, {
    id: draftId,
    projectId,
    createdBy: editorId,
    name,
    threadId,
    liveThreadId,
  });
  const draft = yield* Effect.promise(() =>
    db
      .select({ projectId: drafts.projectId, threadId: drafts.threadId })
      .from(drafts)
      .where(eq(drafts.id, draftId))
      .get(),
  );
  return draft?.projectId === projectId && draft.threadId === threadId;
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
 * A draft's thread, as a publish or delete ends the draft, read before it does. Its `statements`
 * join the batch ending the draft, letting go of the thread there: a development draft stays
 * open, so the next one to open its thread starts a new one, and a regular draft lets go of it
 * with its row. Once the batch applied, `end` deletes the thread, which wipes what it stored
 * and turns away whatever reaches it after. A Live thread that started the draft is never
 * touched: it's the editor's for good.
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
