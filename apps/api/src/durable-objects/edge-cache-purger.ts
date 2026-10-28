import { DurableObject, exports } from "cloudflare:workers";

import { EDGE_CACHE_PURGE_URL } from "../lib/edge-cache-purges";
import type { Bindings } from "../types";

/**
 * Workers Caching purges always count against the Free plan's limits, whatever the plan: a burst
 * of 25, then 5 a minute, for the whole account. One purge every 12 seconds stays under them
 * however many projects publish.
 */
export const PURGE_SPACING_MS = 12_000;
/** The most tags one purge may name. */
export const MAX_TAGS_PER_PURGE = 100;

type PurgeResult = { success: boolean; errors?: { code: number; message: string }[] };

/**
 * The one place the API's edge cache is purged from (`edgeCachePurges`). It collects the tags to
 * purge and sends them together: at once when the last purge is old enough, otherwise once it
 * is. A purge that fails is retried with the next batch.
 */
export class EdgeCachePurger extends DurableObject<Bindings> {
  async purge(tags: string[]): Promise<void> {
    const pending = new Set(await this.pending());
    for (const tag of tags) pending.add(tag);
    await this.ctx.storage.put("pending", [...pending]);
    if ((await this.ctx.storage.getAlarm()) !== null) return;
    const last = (await this.ctx.storage.get<number>("lastPurgeAt")) ?? 0;
    await this.ctx.storage.setAlarm(Math.max(Date.now(), last + PURGE_SPACING_MS));
  }

  async alarm(): Promise<void> {
    const batch = (await this.pending()).slice(0, MAX_TAGS_PER_PURGE);
    if (batch.length === 0) return;
    await this.ctx.storage.put("lastPurgeAt", Date.now());
    const result = await purgeEdgeCache(batch).catch((error: unknown): PurgeResult => ({
      success: false,
      errors: [{ code: 0, message: String(error) }],
    }));
    // Tags may have been added while the purge was in flight: keep those.
    const pending = await this.pending();
    const left = result.success ? pending.filter((tag) => !batch.includes(tag)) : pending;
    if (!result.success) console.error("[edge-cache] purge failed, retrying", result.errors);
    await this.ctx.storage.put("pending", left);
    if (left.length > 0) await this.ctx.storage.setAlarm(Date.now() + PURGE_SPACING_MS);
  }

  private async pending(): Promise<string[]> {
    return (await this.ctx.storage.get<string[]>("pending")) ?? [];
  }
}

/** Purges are scoped to the entrypoint that sends them, so `EdgeCache` sends its own. */
async function purgeEdgeCache(tags: string[]): Promise<PurgeResult> {
  const edgeCache = exports.EdgeCache;
  const response = await edgeCache.fetch(EDGE_CACHE_PURGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tags }),
  });
  return (await response.json()) as PurgeResult;
}
