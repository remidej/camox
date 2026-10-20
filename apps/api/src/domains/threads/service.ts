import { generateUuidv7 } from "@camox/api-contract/ids";
import { and, eq } from "drizzle-orm";

import type { Database } from "../../db";
import { liveThreads } from "./schema";

/** The id of an editor's current Live thread in a project, starting one the first time. */
export async function currentLiveThread(db: Database, projectId: number, userId: string) {
  await db
    .insert(liveThreads)
    .values({ threadId: generateUuidv7(), projectId, userId, createdAt: Date.now() })
    .onConflictDoNothing();
  const thread = await db
    .select({ threadId: liveThreads.threadId })
    .from(liveThreads)
    .where(and(eq(liveThreads.projectId, projectId), eq(liveThreads.userId, userId)))
    .get();
  if (!thread) throw new Error("The Live thread vanished as it was started");
  return thread.threadId;
}
