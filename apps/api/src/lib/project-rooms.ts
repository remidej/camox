import type { ProjectRoomMessage } from "@camox/api-contract/query-keys";
import { env, waitUntil } from "cloudflare:workers";

import type { ProjectRoom } from "../durable-objects/project-room";

/**
 * The realtime rooms, one per project, that every viewer of the project follows, in Live or in
 * any draft (ADR 0011). Sending never fails and never delays the caller: delivery is
 * fire-and-forget. Tests swap in a recording adapter (`test/project-rooms.ts`).
 */
export interface ProjectRooms {
  send(projectId: number, message: ProjectRoomMessage): void;
}

type ProjectRoomStub = DurableObjectStub & Pick<ProjectRoom, "broadcastMessage">;

/** The rooms as Durable Objects, reached from wherever the current invocation runs. */
export const projectRooms: ProjectRooms = {
  send(projectId, message) {
    const namespace = env.ProjectRoom;
    const stub = namespace.get(namespace.idFromName(String(projectId))) as ProjectRoomStub;
    waitUntil(
      stub
        .broadcastMessage(message)
        .catch((error: unknown) => console.error("[ProjectRoom] broadcast failed", error)),
    );
  },
};
