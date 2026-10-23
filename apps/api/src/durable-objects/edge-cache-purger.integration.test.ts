import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vite-plus/test";

import type { Bindings } from "../types";
import { PURGE_SPACING_MS } from "./edge-cache-purger";

/** A purger of its own, as each test needs fresh storage. */
function purger() {
  const namespace = (env as unknown as Bindings).EDGE_CACHE_PURGER;
  return namespace.get(namespace.idFromName(crypto.randomUUID()));
}

type Purger = ReturnType<typeof purger>;

/**
 * Asks the purger to purge `tags`, and reads what it then holds, in one invocation: its alarm
 * can't fire in between.
 */
const purgeAndRead = (stub: Purger, tags: string[]) =>
  runInDurableObject(stub, async (instance, state) => {
    await instance.purge(tags);
    return {
      pending: (await state.storage.get<string[]>("pending")) ?? [],
      alarm: await state.storage.getAlarm(),
    };
  });

/** A purger that just purged, at the time it returns. */
async function purgedJustNow(): Promise<{ stub: Purger; purgedAt: number }> {
  const stub = purger();
  const purgedAt = Date.now();
  await runInDurableObject(stub, (_, state) => state.storage.put("lastPurgeAt", purgedAt));
  return { stub, purgedAt };
}

describe("the edge cache purger", () => {
  it("purges at once after a quiet spell", async () => {
    const stub = purger();

    const { alarm } = await purgeAndRead(stub, ["live:1"]);

    expect(alarm).not.toBeNull();
    expect(alarm!).toBeLessThanOrEqual(Date.now());
    await vi.waitFor(async () => {
      const pending = await runInDurableObject(stub, (_, state) => state.storage.get("pending"));
      expect(pending).toEqual([]);
    });
  });

  it("waits out the spacing after a purge, so the account's purge rate limit holds", async () => {
    const { stub, purgedAt } = await purgedJustNow();

    const { alarm } = await purgeAndRead(stub, ["live:1"]);

    expect(alarm).toBe(purgedAt + PURGE_SPACING_MS);
  });

  it("purges every tag asked for while it waits together, each once", async () => {
    const { stub, purgedAt } = await purgedJustNow();

    await purgeAndRead(stub, ["live:1"]);
    const { pending, alarm } = await purgeAndRead(stub, ["live:2", "live:1"]);

    expect(pending).toEqual(["live:1", "live:2"]);
    expect(alarm).toBe(purgedAt + PURGE_SPACING_MS);
  });
});
