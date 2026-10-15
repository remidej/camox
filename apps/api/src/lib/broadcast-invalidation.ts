import type { EndedDraft } from "@camox/api-contract/drafts";
import {
  queryKeys,
  type InvalidationMessage,
  type ProjectRoomMessage,
  type QueryKey,
} from "@camox/api-contract/query-keys";

import type { ProjectRoom } from "../durable-objects/project-room";

type ProjectRoomStub = DurableObjectStub & Pick<ProjectRoom, "broadcastMessage">;

type ProjectRoomOptions = {
  waitUntil: (promise: Promise<unknown>) => void;
  projectRoomNamespace: DurableObjectNamespace;
  projectId: number;
};

type BroadcastInvalidationOptions = ProjectRoomOptions & {
  /** The draft the change was made in, or `null` for Live, whose changes reach every viewer. */
  draftId: string | null;
  targets: QueryKey[];
};

/** Sends a message to everyone viewing the project, in Live or in any draft (ADR 0011). */
function broadcast(
  { waitUntil, projectRoomNamespace, projectId }: ProjectRoomOptions,
  message: ProjectRoomMessage,
) {
  const id = projectRoomNamespace.idFromName(String(projectId));
  const stub = projectRoomNamespace.get(id) as ProjectRoomStub;
  waitUntil(stub.broadcastMessage(message));
}

export function broadcastInvalidation({ draftId, targets, ...room }: BroadcastInvalidationOptions) {
  // Comment availability depends on current objects and field definitions.
  // Refresh it for every content mutation, including deletions.
  const contentChanged = targets.some(([, domain]) =>
    ["pages", "blocks", "repeatableItems", "layouts", "blockDefinitions"].includes(String(domain)),
  );
  const alreadyIncludesComments = targets.some((key) => key.length === 2 && key[1] === "comments");
  const message: InvalidationMessage = {
    type: "invalidate",
    draftId,
    targets:
      contentChanged && !alreadyIncludesComments ? [...targets, queryKeys.comments.all] : targets,
  };
  broadcast(room, message);
}

/**
 * Tells the draft's viewers that it was published or discarded, and by whom. Publishing and
 * discarding call it once their batch has run.
 */
export function broadcastDraftEnded({
  ended,
  ...room
}: ProjectRoomOptions & { ended: EndedDraft }) {
  broadcast(room, { type: "draftEnded", ...ended });
}
