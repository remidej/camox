import {
  EMPTY_THREAD_VIEW,
  reduceThreadEvents,
  type ThreadClientMessage,
  type ThreadServerMessage,
  type ThreadView,
} from "@camox/api-contract/threads";
import { useWebSocket } from "partysocket/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { getAuthCookieHeader } from "./auth";

/** `WebSocket.OPEN`, without reaching for a global the server doesn't have. */
const OPEN = 1;

/**
 * Follows the signed-in editor's Live thread in a project over its socket, folding Pi's events
 * into the thread's view. A message is resent with its operation id on every reconnect until the
 * thread accepts it, which records it once. Mount it once per project.
 */
export function useLiveThread(apiUrl: string, projectId: number) {
  const [view, setView] = useState<ThreadView>(EMPTY_THREAD_VIEW);
  const [unaccepted, setUnaccepted] = useState<ReadonlyMap<string, string>>(new Map());
  const unacceptedRef = useRef(unaccepted);
  useEffect(() => {
    unacceptedRef.current = unaccepted;
  }, [unaccepted]);

  const socket = useWebSocket(() => liveThreadUrl(apiUrl, projectId), undefined, {
    // Unaccepted messages are resent on every open instead, so nothing is buffered twice.
    maxEnqueuedMessages: 0,
    onOpen(event) {
      const opened = event.target as WebSocket;
      for (const [operationId, text] of unacceptedRef.current) {
        transmit(opened, { type: "send", operationId, text });
      }
    },
    onMessage(event) {
      if (typeof event.data !== "string") return;
      let frame: ThreadServerMessage;
      try {
        frame = JSON.parse(event.data);
      } catch {
        return;
      }
      if (frame.type === "events") {
        const { events } = frame;
        setView((current) => reduceThreadEvents(current, events));
      } else if (frame.type === "accepted") {
        const { operationId } = frame;
        setUnaccepted((current) => without(current, operationId));
      } else if (frame.type === "error") {
        console.error("[useLiveThread]", frame.message);
      }
    },
  });

  // A tab coming back may have missed events while the browser throttled it.
  useEffect(() => {
    const resync = () => {
      if (document.visibilityState === "visible") transmit(socket, { type: "resync" });
    };
    document.addEventListener("visibilitychange", resync);
    return () => document.removeEventListener("visibilitychange", resync);
  }, [socket]);

  const send = useCallback(
    (text: string) => {
      const operationId = crypto.randomUUID();
      setUnaccepted((current) => new Map(current).set(operationId, text));
      transmit(socket, { type: "send", operationId, text });
    },
    [socket],
  );

  return {
    view,
    /** Whether the agent is working, or a message is still on its way to the thread. */
    working: view.working || unaccepted.size > 0,
    send,
  };
}

function liveThreadUrl(apiUrl: string, projectId: number) {
  const url = new URL(`threads/live/${projectId}`, apiUrl.replace(/\/*$/, "/"));
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  // WebSocket upgrades can't carry custom headers, so the session is relayed in the query.
  url.searchParams.set("_authCookie", getAuthCookieHeader());
  return url.href;
}

function transmit(
  socket: { readyState: number; send: (data: string) => void },
  message: ThreadClientMessage,
) {
  if (socket.readyState === OPEN) socket.send(JSON.stringify(message));
}

const without = (map: ReadonlyMap<string, string>, key: string) => {
  const next = new Map(map);
  next.delete(key);
  return next;
};
