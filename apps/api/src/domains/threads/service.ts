import { generateUuidv7 } from "@camox/api-contract/ids";
import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { InvalidInputError } from "../../lib/errors";
import type { ServiceContext } from "../_shared/service-context";
import { accessTo } from "../drafts/access";
import { drafts } from "../drafts/schema";
import { draftIn } from "../drafts/scope";
import { liveThreads } from "./schema";

/** The id of an editor's current Live thread in a project, starting one the first time. */
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
  return thread.threadId;
});

/**
 * The draft a member's request names, with its thread's id, starting the thread the first time
 * someone opens it: a draft has at most one thread. Content access checks the draft as for any
 * read, so only members reach a regular draft's thread, and only its developer a development
 * draft's.
 */
export const draftThread = Effect.fn("draftThread")(function* (
  ctx: ServiceContext,
  projectId: number,
) {
  const { scope } = yield* Effect.scoped(accessTo(ctx, { project: projectId }, "member"));
  const draft = draftIn(scope);
  if (!draft) return yield* new InvalidInputError({ message: "Live isn't a draft: name one" });
  yield* Effect.promise(() =>
    ctx.db
      .update(drafts)
      .set({ threadId: generateUuidv7() })
      .where(and(eq(drafts.id, draft.id), isNull(drafts.threadId))),
  );
  const row = yield* Effect.promise(() =>
    ctx.db.select({ threadId: drafts.threadId }).from(drafts).where(eq(drafts.id, draft.id)).get(),
  );
  if (!row?.threadId) {
    return yield* Effect.die(new Error("The draft vanished as its thread started"));
  }
  return { draft, threadId: row.threadId };
});
