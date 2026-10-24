import { eq } from "drizzle-orm";

import { createDb } from "../../db";
import type { MergeClash, MergeOutcome } from "../../durable-objects/draft-code";
import type { Bindings } from "../../types";
import { drafts } from "../drafts/schema";
import { DRAFT_MERGED_EVENT } from "../publishes/events";
import { buildRevision, retried } from "./build";

// Merging Live's code into a draft with code (ADR 0020's amendment, spec #560 section 11). The
// draft's thread runs it in its build queue (`Thread.mergeMain`), as its own builds run: when
// `main` moved under an idle draft, and after the last commit of a turn otherwise.

/** How a merge of `main` into a draft ended. */
export type MergeEnd =
  /** The draft holds the current `main`, or will once its changes are committed. */
  | "upToDate"
  /** A merge revision landed, built, and the draft previews it. */
  | "merged"
  /** The merge clashed: it's left for Camox's reconcile turn (`DraftCode.clash`). */
  | "clashed";

/**
 * Merges the current `main` into the draft `draftId`, which has code. A clean merge whose tree
 * builds becomes a merge revision, which the draft previews, silently: its definitions are synced
 * and its viewers' frames reload, as for any revision. A merge that conflicts, or whose tree
 * doesn't build or type check, is recorded as the draft's clash, and the draft keeps its last
 * revision: a tree that built but doesn't type check stays committed, as any revision would.
 *
 * A publish of the draft waiting for the merge hears that it ended.
 */
export async function mergeMainIntoDraft(env: Bindings, draftId: string): Promise<MergeEnd> {
  const code = env.DRAFT_CODE.getByName(draftId);
  // The RPC stub's type of a union loses the cases apart.
  const merge = (await retried(() => code.mergeMain() as Promise<unknown>)) as MergeOutcome;
  if (merge.outcome === "upToDate" || merge.outcome === "unsettled") return "upToDate";
  if (merge.outcome === "clashed") return "clashed";
  let clash: MergeClash | undefined;
  if (merge.outcome === "conflicts") {
    clash = { main: merge.main, conflicts: merge.conflicts };
  } else {
    const result = await buildRevision(env, draftId, { leftBy: "merge", prepared: merge.prepared });
    if (!result.ok) clash = { main: merge.main, result };
  }
  if (clash) await code.recordClash(clash);
  await tellPublish(env, draftId);
  return clash ? "clashed" : "merged";
}

/** Wakes the draft's publish, if one waits: it ships the merge revision, or goes back. */
async function tellPublish(env: Bindings, draftId: string) {
  const row = await createDb(env.DB)
    .select({ instanceId: drafts.publishInstanceId })
    .from(drafts)
    .where(eq(drafts.id, draftId))
    .get();
  if (!row?.instanceId) return;
  try {
    const instance = await env.PUBLISH_WORKFLOW.get(row.instanceId);
    await instance.sendEvent({ type: DRAFT_MERGED_EVENT, payload: {} });
  } catch (error) {
    // The publish checks again by itself, a while later.
    console.warn("A publish waiting for its draft's merge wasn't told it ended", error);
  }
}
