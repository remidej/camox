import type { EndedDraft } from "@camox/api-contract/drafts";
import type {
  InvalidationMessage,
  ProjectRoomMessage,
  RevisionAnnouncement,
} from "@camox/api-contract/query-keys";
import { usePartySocket } from "partysocket/react";
import { useRef } from "react";

import { apiSocketOptions } from "./api-socket";
import type { StudioCache } from "./studio-reads";

const DEBOUNCE_MS = 300;

/**
 * Follows the project's realtime room (ADR 0011). An invalidation from a draft refetches only
 * that draft's queries; one from Live refetches every draft's too, since drafts read Live
 * wherever they change nothing. The studio cache applies each one to the reads it reaches.
 */
export function useProjectRoom(
  apiUrl: string,
  projectId: number | undefined,
  studioCache: StudioCache,
  {
    onDraftEnded,
    onRevision,
  }: {
    onDraftEnded?: (ended: EndedDraft) => void;
    onRevision?: (revision: RevisionAnnouncement) => void;
  } = {},
) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingRef = useRef<InvalidationMessage[]>([]);

  usePartySocket({
    ...apiSocketOptions(apiUrl),
    party: "project-room",
    room: String(projectId ?? ""),
    prefix: "parties",
    enabled: !!projectId,
    onOpen() {
      if (process.env.NODE_ENV !== "production") {
        console.debug("[useProjectRoom] WebSocket connected");
      }
    },
    onClose(event) {
      console.warn(
        `[useProjectRoom] WebSocket closed (code=${event.code}, reason=${event.reason || "none"})`,
      );
    },
    onError(event) {
      console.error("[useProjectRoom] WebSocket error:", event);
    },
    onMessage(event) {
      let data: ProjectRoomMessage;
      try {
        data = JSON.parse(event.data);
      } catch {
        // Ignore non-JSON messages (e.g. partysocket pings)
        return;
      }

      if (data.type === "draftEnded") {
        const { type: _type, ...ended } = data;
        onDraftEnded?.(ended);
        return;
      }
      if (data.type === "revision") {
        const { type: _type, ...revision } = data;
        onRevision?.(revision);
        return;
      }
      if (data.type !== "invalidate") return;

      pendingRef.current.push(data);

      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const pending = pendingRef.current;
        pendingRef.current = [];
        for (const message of pending) void studioCache.receive(message, projectId!);
      }, DEBOUNCE_MS);
    },
  });
}
