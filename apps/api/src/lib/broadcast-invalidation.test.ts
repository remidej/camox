import { queryKeys, type InvalidationMessage, type QueryKey } from "@camox/api-contract/query-keys";
import { describe, expect, it, vi } from "vitest";

import { broadcastInvalidation } from "./broadcast-invalidation";

describe("feedback invalidation dependencies", () => {
  it("refreshes feedback when content changes without duplicating or mutating targets", async () => {
    const send = vi.fn(async (_message: InvalidationMessage) => {});
    const namespace = {
      idFromName: vi.fn(() => "project-room"),
      get: vi.fn(() => ({ broadcastInvalidation: send })),
    } as unknown as DurableObjectNamespace;
    const pending: Promise<unknown>[] = [];
    const targets: QueryKey[] = [queryKeys.blocks.get(3)];
    const broadcast = (keys: QueryKey[]) =>
      broadcastInvalidation({
        projectId: 1,
        projectRoomNamespace: namespace,
        targets: keys,
        waitUntil: (promise) => {
          pending.push(promise);
        },
      });
    broadcast(targets);
    expect(send).toHaveBeenLastCalledWith({
      type: "invalidate",
      targets: [...targets, queryKeys.comments.all],
    });
    expect(targets).toEqual([queryKeys.blocks.get(3)]);
    broadcast([...targets, queryKeys.comments.all]);
    expect(send).toHaveBeenLastCalledWith({
      type: "invalidate",
      targets: [...targets, queryKeys.comments.all],
    });
    broadcast([queryKeys.comments.list(2)]);
    expect(send).toHaveBeenLastCalledWith({
      type: "invalidate",
      targets: [queryKeys.comments.list(2)],
    });
    await Promise.all(pending);
  });
});
