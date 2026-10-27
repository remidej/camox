import { generateUuidv7 } from "@camox/api-contract/ids";
import type { DraftCardState } from "@camox/api-contract/threads";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { Effect } from "effect";

import { isProjectMember } from "../../authorization";
import type { Database } from "../../db";
import type { Bindings } from "../../types";
import type { ServiceContext } from "../_shared/service-context";
import { writeAccessWhilePublishing } from "../drafts/access";
import { peopleNamed, personOf } from "../drafts/people";
import { drafts, endedDrafts } from "../drafts/schema";
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

/**
 * Where the drafts a Live thread's cards name stand in a project: an open draft's current name,
 * an ended one's last name and how it ended. A draft that isn't there yet is left out.
 */
export const draftCardsOf = Effect.fn("draftCardsOf")(function* (
  db: Database,
  projectId: number,
  draftIds: readonly string[],
) {
  const cards: Record<string, DraftCardState> = {};
  if (draftIds.length === 0) return cards;
  const [open, ended] = yield* Effect.promise(() =>
    Promise.all([
      db
        .select({ id: drafts.id, name: drafts.name })
        .from(drafts)
        .where(and(eq(drafts.projectId, projectId), inArray(drafts.id, [...draftIds]))),
      db
        .select({ id: endedDrafts.id, name: endedDrafts.name, outcome: endedDrafts.outcome })
        .from(endedDrafts)
        .where(and(eq(endedDrafts.projectId, projectId), inArray(endedDrafts.id, [...draftIds]))),
    ]),
  );
  for (const { id, name } of open) cards[id] = { name };
  for (const { id, name, outcome } of ended) cards[id] = { name, ended: outcome };
  return cards;
});

type ThreadStub = ReturnType<Bindings["THREAD"]["getByName"]>;

/**
 * Calls the thread `threadId`, if any, on a best-effort basis: a thread it can't reach is only
 * reported, as `failure`, and never fails the caller.
 */
const tellThread = (
  ctx: Pick<ServiceContext, "env">,
  threadId: string | null | undefined,
  {
    span,
    failure,
    tell,
  }: { span: string; failure: string; tell: (thread: ThreadStub) => Promise<void> },
) =>
  Effect.promise(async () => {
    if (!threadId) return;
    try {
      await tell(ctx.env.THREAD.getByName(threadId));
    } catch (error) {
      console.error(failure, error);
    }
  }).pipe(Effect.withSpan(span));

/**
 * Tells the Live thread that started a draft, if any, to show its card's draft as it stands now,
 * once it's renamed or ended. A Live thread that can't be reached shows it when next opened.
 */
export const showDraftOnLive = (
  ctx: Pick<ServiceContext, "env">,
  liveThreadId: string | null | undefined,
) =>
  tellThread(ctx, liveThreadId, {
    span: "showDraftOnLive",
    failure: "A Live thread didn't show where its card's draft stands",
    tell: (thread) => thread.showDrafts(),
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
 * draft's thread.
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

/** How a draft ends, and the id of the user who ends it, which the draft's record stores. */
export type DraftEnding = { outcome: "published" | "deleted"; byUserId: string };

/**
 * The note Camox adds at the end of the Live thread that started a draft once it ended, which
 * only the model reads: the draft's name, the name of who ended it, and for a publish, its Draft
 * Overview.
 */
function draftEndedNote(ended: {
  name: string | null;
  outcome: DraftEnding["outcome"];
  byName: string;
  overview?: { headline: string; bullets: readonly string[] };
}) {
  const draft = ended.name ? `the draft "${ended.name}"` : "a draft";
  const note = `Note from Camox: ${draft} you started was ${ended.outcome} by ${ended.byName}`;
  if (ended.outcome === "deleted") return `${note}, so none of its changes reached Live.`;
  const published = `${note}, so its changes are on Live now.`;
  if (!ended.overview) return published;
  const bullets = ended.overview.bullets.map((bullet) => `\n- ${bullet}`).join("");
  return `${published} Its Draft Overview:\n\n${ended.overview.headline}${bullets}`;
}

/**
 * A draft's threads, as a publish or delete ends the draft, read before it does. Once the batch
 * ending the draft applied, `end` deletes the draft's own thread,
 * which wipes what it stored and turns away whatever reaches it after. The Live thread that
 * started the draft, if any, is the editor's for good: `end` only adds Camox's note at its end,
 * saying how the draft ended, and shows the draft's card as ended (ADR 0025).
 *
 * The draft ended either way, so `end` never fails: a thread it couldn't reach is only reported.
 */
export const endingThread = Effect.fn("endingThread")(function* (
  ctx: Pick<ServiceContext, "db" | "env">,
  draftId: string,
  ending: DraftEnding,
) {
  const draft = yield* Effect.promise(() =>
    ctx.db
      .select({
        threadId: drafts.threadId,
        liveThreadId: drafts.liveThreadId,
        name: drafts.name,
        overviewHeadline: drafts.overviewHeadline,
        overviewBullets: drafts.overviewBullets,
      })
      .from(drafts)
      .where(eq(drafts.id, draftId))
      .get(),
  );
  const threadId = draft?.threadId ?? null;
  const liveThreadId = draft?.liveThreadId ?? null;
  const note =
    draft && liveThreadId
      ? draftEndedNote({
          name: draft.name,
          outcome: ending.outcome,
          byName: personOf(yield* peopleNamed(ctx.db, [ending.byUserId]), ending.byUserId).name,
          overview:
            ending.outcome === "published" && draft.overviewHeadline
              ? { headline: draft.overviewHeadline, bullets: draft.overviewBullets ?? [] }
              : undefined,
        })
      : undefined;
  const endThread = tellThread(ctx, threadId, {
    span: "endThread",
    failure: "A thread didn't end with its draft",
    tell: (thread) => thread.end(),
  });
  const tellLive = note
    ? tellThread(ctx, liveThreadId, {
        span: "noteDraftEnded",
        failure: "The Live thread that started a draft didn't hear it ended",
        tell: (thread) => thread.noteDraftEnded({ draftId, note }),
      })
    : Effect.void;
  return {
    end: endThread.pipe(
      Effect.andThen(tellLive),
      Effect.andThen(showDraftOnLive(ctx, liveThreadId)),
    ),
  };
});
