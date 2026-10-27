import { DEVELOPMENT_DRAFT } from "@camox/api-contract/drafts";
import {
  EMPTY_THREAD_STATE,
  reduceThreadFrame,
  type StartedDraft,
  THREAD_ENDED_CLOSE_CODE,
  type ThreadClientMessage,
  type ThreadServerMessage,
  threadViewOf,
  type TouchedBatch,
} from "@camox/api-contract/threads";
import { usePartySocket } from "partysocket/react";
import * as React from "react";

import { apiSocketOptions } from "./api-socket";

/** `WebSocket.OPEN`, without reaching for a global the server doesn't have. */
const OPEN = 1;

/** Messages on their way to a thread, which hasn't accepted them yet, by operation id. */
export type Unaccepted = ReadonlyMap<string, string>;

/**
 * A script's touches the studio follows, numbered in the order they came: a new one, even with
 * the same touches, has a higher `sequence`.
 */
export type FollowedTouches = { sequence: number; batch: TouchedBatch };

export type UseThreadOptions = {
  /**
   * Hears that the agent on Live started a draft with `startDraft`, in a run one of this
   * studio's messages was part of, so the studio enters the draft if it still shows Live.
   */
  onEnterDraft?: (draftId: string) => void;
};

/**
 * Follows a thread in a project over its socket, folding Pi's events into the thread's view: the
 * signed-in editor's Live thread when `draftId` is null, or the draft's thread, which `draftId`
 * names as the draft header does (`development` in dev mode). A message is resent with its
 * operation id each time the thread shows itself after the socket opens, until it accepts it,
 * which records it once, or turns it down. A draft's thread that ended with its draft isn't
 * reconnected to, but for a development draft's, which moves on to a new thread. Mount it once
 * per project and draft.
 *
 * When the agent on Live hands a request off to a draft it started, the studio that sent a
 * message of that run hears it (`onEnterDraft`), to enter the draft. The editor's Live thread
 * stays as it is, ending that turn on the draft's card, which every studio on Live shows.
 *
 * It reports what each writing script touched (`touched`), for runs one of its messages was part
 * of only, so that the studio follows the agent; teammates' runs leave it where it is.
 */
export function useThread(
  apiUrl: string,
  projectId: number,
  draftId: string | null,
  { onEnterDraft }: UseThreadOptions = {},
) {
  const [state, setState] = React.useState(EMPTY_THREAD_STATE);
  const view = React.useMemo(() => threadViewOf(state), [state]);
  const [unaccepted, setUnaccepted] = React.useState<Unaccepted>(new Map());
  const [error, setError] = React.useState<string>();
  /** The operation ids of the messages this studio sent in the thread. */
  const sent = React.useRef(new Set<string>());
  /** Whether the thread showed itself since the socket last opened. */
  const shown = React.useRef(false);
  /** How many times the thread showed itself after the socket opened. */
  const [shows, setShows] = React.useState(0);
  /** What the last script of a run with one of this studio's messages touched. */
  const [touched, setTouched] = React.useState<FollowedTouches>();

  const socket = usePartySocket({
    ...apiSocketOptions(apiUrl),
    basePath: draftId ? `threads/draft/${projectId}/${draftId}` : `threads/live/${projectId}`,
    // Unaccepted messages are resent once the thread shows itself instead, so nothing is
    // buffered twice.
    maxEnqueuedMessages: 0,
    // A thread that ended with its draft is deleted: reconnecting would reach nothing.
    shouldReconnectOnClose: (event) => event.code !== THREAD_ENDED_CLOSE_CODE,
    onClose(event) {
      // A development draft stays open, and its new thread starts empty: move on to it at once.
      if (event.code === THREAD_ENDED_CLOSE_CODE && draftId === DEVELOPMENT_DRAFT) {
        socket.reconnect();
      }
    },
    onOpen() {
      shown.current = false;
    },
    onMessage(event) {
      if (typeof event.data !== "string") return;
      let frame: ThreadServerMessage;
      try {
        frame = JSON.parse(event.data);
      } catch {
        return;
      }
      onFrame(frame);
    },
  });

  /** Whether one of this studio's messages, on Live, was part of the run that started `started`. */
  const asked = (started: StartedDraft) =>
    draftId === null && started.operationIds.some((operationId) => sent.current.has(operationId));

  /** Whether one of this studio's messages was part of the run that touched `batch`. */
  const ours = (batch: TouchedBatch) =>
    batch.operationIds.some((operationId) => sent.current.has(operationId));

  const onFrame = React.useEffectEvent((frame: ThreadServerMessage) => {
    switch (frame.type) {
      case "started-draft":
        if (asked(frame.startedDraft)) onEnterDraft?.(frame.startedDraft.draftId);
        return;
      case "events":
        setState((current) => reduceThreadFrame(current, frame));
        // The thread shows itself with a snapshot first.
        if (!shown.current) {
          shown.current = true;
          setShows((count) => count + 1);
        }
        return;
      case "touched":
        if (ours(frame.touched)) {
          const batch = frame.touched;
          setTouched((last) => ({ sequence: (last?.sequence ?? 0) + 1, batch }));
        }
        return;
      case "accepted":
        setUnaccepted((current) => without(current, frame.operationId));
        return;
      case "error": {
        console.error("[useThread]", frame.message);
        setError(frame.message);
        // The thread turned the message down: it won't take it on a resend either.
        const { operationId } = frame;
        if (operationId) setUnaccepted((current) => without(current, operationId));
        return;
      }
    }
  });

  // Messages still on their way are resent once the thread showed itself.
  const resendUnaccepted = React.useEffectEvent(() => {
    for (const [operationId, text] of unaccepted) {
      transmit(socket, { type: "send", operationId, text });
    }
  });
  React.useEffect(() => {
    if (shows > 0) resendUnaccepted();
  }, [shows]);

  // A tab coming back may have missed events while the browser throttled it.
  React.useEffect(() => {
    const resync = () => {
      if (document.visibilityState === "visible") transmit(socket, { type: "resync" });
    };
    document.addEventListener("visibilitychange", resync);
    return () => document.removeEventListener("visibilitychange", resync);
  }, [socket]);

  const send = React.useCallback(
    (text: string) => {
      const operationId = crypto.randomUUID();
      sent.current.add(operationId);
      setError(undefined);
      setUnaccepted((current) => new Map(current).set(operationId, text));
      transmit(socket, { type: "send", operationId, text });
    },
    [socket],
  );

  // A stop isn't resent on reconnecting: it could stop a run started since.
  const stop = React.useCallback(() => transmit(socket, { type: "stop" }), [socket]);

  return {
    /** What the thread shows, with whether a run is going, which `stop` ends. */
    view,
    /** Whether a message is still on its way to the thread, which hasn't accepted it yet. */
    sending: unaccepted.size > 0,
    /** Sends a message, steering the run going if any. */
    send,
    stop,
    /** Why the thread last turned a message down, until the editor sends another. */
    error,
    /**
     * What the latest writing script of a run with one of this studio's messages touched, which
     * the studio follows; teammates' runs are left out. Live only: never a past script's.
     */
    touched,
  };
}

function transmit(
  socket: { readyState: number; send: (data: string) => void },
  message: ThreadClientMessage,
) {
  if (socket.readyState === OPEN) socket.send(JSON.stringify(message));
}

const without = (map: Unaccepted, key: string) => {
  const next = new Map(map);
  next.delete(key);
  return next;
};
