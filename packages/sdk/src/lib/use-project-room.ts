import { DEVELOPMENT_DRAFT, type EndedDraft } from "@camox/api-contract/drafts";
import { scopeOfKey, type ProjectRoomMessage, type QueryKey } from "@camox/api-contract/query-keys";
import { useQueryClient } from "@tanstack/react-query";
import { usePartySocket } from "partysocket/react";
import { useEffect, useRef } from "react";

import { getAuthCookieHeader } from "./auth";

const DEBOUNCE_MS = 300;

type PendingInvalidation = { draftId: string | null; queryKey: QueryKey };

/**
 * Follows the project's realtime room (ADR 0011). An invalidation from a draft refetches only
 * that draft's queries; one from Live refetches every draft's too, since drafts read Live
 * wherever they change nothing. Dev mode keys its queries `development` rather than by its
 * development draft's id, so `developmentDraftId` says which invalidations are that draft's.
 */
export function useProjectRoom(
  apiUrl: string,
  projectId: number | undefined,
  {
    onDraftEnded,
    developmentDraftId,
  }: { onDraftEnded?: (ended: EndedDraft) => void; developmentDraftId?: string } = {},
) {
  const queryClient = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingRef = useRef<PendingInvalidation[]>([]);
  const developmentDraftIdRef = useRef(developmentDraftId);
  useEffect(() => {
    developmentDraftIdRef.current = developmentDraftId;
  }, [developmentDraftId]);
  // The scope of the queries a draft's invalidation refetches.
  const scopeOf = (draftId: string) =>
    draftId === developmentDraftIdRef.current ? DEVELOPMENT_DRAFT : draftId;

  const host = apiUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");

  usePartySocket({
    host,
    // Match the API transport instead of PartySocket's hostname-based guess:
    // custom *.localhost names otherwise default to TLS against our HTTP server.
    protocol: new URL(apiUrl).protocol === "http:" ? "ws" : "wss",
    party: "project-room",
    room: String(projectId ?? ""),
    prefix: "parties",
    query: () => ({ _authCookie: getAuthCookieHeader() }),
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
      if (data.type !== "invalidate") return;

      for (const queryKey of data.targets) {
        pendingRef.current.push({ draftId: data.draftId ?? null, queryKey });
      }

      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const pending = pendingRef.current;
        pendingRef.current = [];

        for (const { draftId, queryKey } of pending) {
          void queryClient.invalidateQueries({
            queryKey,
            predicate:
              draftId === null
                ? undefined
                : (query) => scopeOfKey(query.queryKey) === scopeOf(draftId),
          });
        }
      }, DEBOUNCE_MS);
    },
  });
}
