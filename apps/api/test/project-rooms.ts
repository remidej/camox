import type { ProjectRoomMessage } from "@camox/api-contract/query-keys";

import type { ProjectRooms } from "../src/lib/project-rooms";

// Test files can share an isolate, and with it module instances: keep one log for all of them.
const store = globalThis as { __projectRoomLog?: Map<number, ProjectRoomMessage[]> };
const log = (store.__projectRoomLog ??= new Map());

/** Stands in for the Durable Object rooms: records what each project's room was sent. */
export const recordingRooms: ProjectRooms = {
  send(projectId, message) {
    log.set(projectId, [...(log.get(projectId) ?? []), structuredClone(message)]);
  },
};

/** Everything a project's room was sent so far, in order. */
export const sentTo = (projectId: number): ProjectRoomMessage[] => log.get(projectId) ?? [];

/** Forgets what a project's room was sent, to look at the next request alone. */
export const forgetSent = (projectId: number) => log.delete(projectId);

/**
 * Whether the messages refresh a read: an invalidation from `draftId` (null for Live) naming the
 * read's key or a prefix of it, as the studio applies them.
 */
export const refreshes = (
  messages: readonly ProjectRoomMessage[],
  draftId: string | null,
  key: readonly unknown[],
) =>
  messages.some(
    (message) =>
      message.type === "invalidate" &&
      message.draftId === draftId &&
      message.targets.some((target) => target.every((part, index) => part === key[index])),
  );
