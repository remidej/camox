import type { ThreadSender, ThreadView } from "@camox/api-contract/threads";
import type { AgentEvent, EntryRecord } from "@earendil-works/pi-durable";

/**
 * How a turn ended, as a caller waiting on it from outside the studio learns: the agent's final
 * message, a failure, or an editor stopping it. A page the turn changed, if any, by its id and
 * the Locale it was changed in, for a link that opens it.
 */
export type TurnEnd = (
  | { turn: "answered"; message: string }
  | { turn: "failed" }
  | { turn: "stopped"; stoppedBy: ThreadSender }
) & { page?: TurnPage };

/** The page a turn changed last, as its writes touched it. */
export type TurnPage = { pageId: string; locale?: string };

/**
 * Where waiting on a turn got: it ended; it's still going when the wait gave up; or the thread
 * ended with its draft, published or deleted.
 */
export type TurnOutcome = TurnEnd | { turn: "working" } | { turn: "threadEnded" };

/** The operation id an entry was sent with, whoever sent it. */
export const operationIdOf = (entry: EntryRecord) => {
  const data = entry.data as { operationId?: unknown } | undefined;
  return typeof data?.operationId === "string" ? data.operationId : undefined;
};

/** The id of the entry recording the message sent with `operationId`, among `entries`. */
export const entryIdOf = (entries: readonly EntryRecord[], operationId: string) => {
  const entry = entries.find((candidate) => operationIdOf(candidate) === operationId);
  return entry && String(entry.id);
};

/** The entries a batch of Pi's agent events carries. */
export const entriesOfEvents = (events: readonly AgentEvent[]): EntryRecord[] =>
  events.flatMap((event) => {
    if (event.type === "snapshot") return event.entries;
    return "entry" in event && event.entry ? [event.entry] : [];
  });

/**
 * How the turn the message `messageId` started or joined ended in `view`, or undefined while it
 * goes on. While the run goes, an answer that's the view's last may not be the turn's: the end
 * of the turn can send the agent back to work. A message after it started another turn.
 */
export function turnEndIn(view: ThreadView, messageId: string): TurnEnd | undefined {
  const at = view.messages.findIndex((message) => message.id === messageId);
  if (at === -1) return undefined;
  const endAt = view.messages.findIndex(
    (message, index) =>
      index > at &&
      (message.from === "agent" || message.from === "failed" || message.from === "stopped"),
  );
  if (endAt === -1) return undefined;
  if (view.running && endAt === view.messages.length - 1) return undefined;
  const end = view.messages[endAt]!;
  if (end.from === "agent") return { turn: "answered", message: end.text };
  if (end.from === "stopped") return { turn: "stopped", stoppedBy: end.sender };
  return { turn: "failed" };
}
