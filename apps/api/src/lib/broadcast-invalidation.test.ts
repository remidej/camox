import type { EndedDraft } from "@camox/api-contract/drafts";
import { queryKeys, type ProjectRoomMessage, type QueryKey } from "@camox/api-contract/query-keys";
import { describe, expect, it, vi } from "vitest";

import { broadcastDraftEnded, broadcastInvalidation } from "./broadcast-invalidation";

function projectRoom() {
  const send = vi.fn(async (_message: ProjectRoomMessage) => {});
  const idFromName = vi.fn((name: string) => `room-${name}`);
  const namespace = {
    idFromName,
    get: vi.fn(() => ({ broadcastMessage: send })),
  } as unknown as DurableObjectNamespace;
  const pending: Promise<unknown>[] = [];
  const room = {
    projectId: 1,
    projectRoomNamespace: namespace,
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise);
    },
  };
  return { send, idFromName, room, settled: () => Promise.all(pending) };
}

describe("feedback invalidation dependencies", () => {
  it("refreshes feedback when content changes without duplicating or mutating targets", async () => {
    const { send, room, settled } = projectRoom();
    const targets: QueryKey[] = [queryKeys.blocks.get("3")];
    const broadcast = (keys: QueryKey[]) =>
      broadcastInvalidation({ ...room, draftId: null, targets: keys });
    broadcast(targets);
    expect(send).toHaveBeenLastCalledWith({
      type: "invalidate",
      draftId: null,
      targets: [...targets, queryKeys.comments.all],
    });
    expect(targets).toEqual([queryKeys.blocks.get("3")]);
    broadcast([...targets, queryKeys.comments.all]);
    expect(send).toHaveBeenLastCalledWith({
      type: "invalidate",
      draftId: null,
      targets: [...targets, queryKeys.comments.all],
    });
    broadcast([queryKeys.comments.list("2")]);
    expect(send).toHaveBeenLastCalledWith({
      type: "invalidate",
      draftId: null,
      targets: [queryKeys.comments.list("2")],
    });
    await settled();
  });
});

describe("the project room", () => {
  it("names the draft a change came from in its invalidation", async () => {
    const { send, room, settled } = projectRoom();

    broadcastInvalidation({ ...room, draftId: "draft-1", targets: [queryKeys.comments.all] });

    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ draftId: "draft-1" }));
    await settled();
  });

  it("tells the project's viewers that a draft ended, how and by whom", async () => {
    const { send, idFromName, room, settled } = projectRoom();
    const ended: EndedDraft = {
      draftId: "draft-1",
      outcome: "discarded",
      endedBy: { id: "user-1", name: "Rémi" },
      endedAt: 1_700_000_000_000,
    };

    broadcastDraftEnded({ ...room, projectId: 7, ended });

    expect(idFromName).toHaveBeenCalledWith("7");
    expect(send).toHaveBeenCalledWith({
      type: "draftEnded",
      draftId: "draft-1",
      outcome: "discarded",
      endedBy: { id: "user-1", name: "Rémi" },
      endedAt: 1_700_000_000_000,
    });
    await settled();
  });
});
