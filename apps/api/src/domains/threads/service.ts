import { generateUuidv7 } from "@camox/api-contract/ids";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
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
