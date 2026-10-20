import {
  EMPTY_THREAD_STATE,
  reduceThreadEvents,
  type ThreadClientMessage,
  type ThreadServerMessage,
  type ThreadState,
  threadViewOf,
} from "@camox/api-contract/threads";
import { usePartySocket } from "partysocket/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiSocketOptions } from "./api-socket";

/** `WebSocket.OPEN`, without reaching for a global the server doesn't have. */
const OPEN = 1;

/**
 * Follows the signed-in editor's Live thread in a project over its socket, folding Pi's events
 * into the thread's view. A message is resent with its operation id on every reconnect until the
 * thread accepts it, which records it once, or turns it down. Mount it once per project.
 */
export function useLiveThread(apiUrl: string, projectId: number) {
  const [state, setState] = useState<ThreadState>(EMPTY_THREAD_STATE);
  const view = useMemo(() => threadViewOf(state), [state]);
  const [unaccepted, setUnaccepted] = useState<ReadonlyMap<string, string>>(new Map());
  const [error, setError] = useState<string>();
  const unacceptedRef = useRef(unaccepted);
  useEffect(() => {
    unacceptedRef.current = unaccepted;
  }, [unaccepted]);

  const socket = usePartySocket({
    ...apiSocketOptions(apiUrl),
    basePath: `threads/live/${projectId}`,
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
        setState((current) => reduceThreadEvents(current, events));
      } else if (frame.type === "accepted") {
        const { operationId } = frame;
        setUnaccepted((current) => without(current, operationId));
      } else if (frame.type === "error") {
        console.error("[useLiveThread]", frame.message);
        setError(frame.message);
        // The thread turned the message down: it won't take it on a resend either.
        const { operationId } = frame;
        if (operationId) setUnaccepted((current) => without(current, operationId));
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
      setError(undefined);
      setUnaccepted((current) => new Map(current).set(operationId, text));
      transmit(socket, { type: "send", operationId, text });
    },
    [socket],
  );

  // A stop isn't resent on reconnecting: it could stop a run started since.
  const stop = useCallback(() => transmit(socket, { type: "stop" }), [socket]);

  return {
    view,
    /** Whether the agent is working, or a message is still on its way to the thread. */
    working: view.working || unaccepted.size > 0,
    /** Whether the agent is working on a run, which `stop` ends. */
    running: view.working,
    /** Sends a message, steering the run going if any. */
    send,
    stop,
    /** Why the thread last turned a message down, until the editor sends another. */
    error,
  };
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
