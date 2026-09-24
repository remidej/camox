import { queryKeys, type InvalidationMessage, type QueryKey } from "@camox/api-contract/query-keys";

import type { ProjectRoom } from "../durable-objects/project-room";

type ProjectRoomStub = DurableObjectStub & Pick<ProjectRoom, "broadcastInvalidation">;

type BroadcastInvalidationOptions = {
  waitUntil: (promise: Promise<unknown>) => void;
  projectRoomNamespace: DurableObjectNamespace;
  projectId: number;
  targets: QueryKey[];
};

export function broadcastInvalidation({
  waitUntil,
  projectRoomNamespace,
  projectId,
  targets,
}: BroadcastInvalidationOptions) {
  const id = projectRoomNamespace.idFromName(String(projectId));
  const stub = projectRoomNamespace.get(id) as ProjectRoomStub;
  // Comment availability depends on current objects and field definitions.
  // Refresh it for every content mutation, including deletions and checkpoint restores.
  const contentChanged = targets.some(([, domain]) =>
    ["pages", "blocks", "repeatableItems", "layouts", "blockDefinitions"].includes(String(domain)),
  );
  const alreadyIncludesComments = targets.some((key) => key.length === 2 && key[1] === "comments");
  const message: InvalidationMessage = {
    type: "invalidate",
    targets:
      contentChanged && !alreadyIncludesComments ? [...targets, queryKeys.comments.all] : targets,
  };
  waitUntil(stub.broadcastInvalidation(message));
}
