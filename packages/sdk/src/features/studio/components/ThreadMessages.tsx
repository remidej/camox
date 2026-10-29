import type {
  AgentActivity,
  ThreadMessage,
  ThreadSender,
  ThreadView,
} from "@camox/api-contract/threads";
import { Avatar, AvatarFallback, AvatarImage } from "@camox/ui/avatar";
import { Bubble, BubbleContent } from "@camox/ui/bubble";
import { Message, MessageAvatar, MessageContent, MessageHeader } from "@camox/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@camox/ui/message-scroller";
import * as React from "react";

import { cn } from "../../../lib/utils";
import { Squareling, type SquarelingStatus } from "./Squareling";
import { ThreadMarkdown } from "./ThreadMarkdown";

/**
 * A thread's messages, and the agent's squareling, which always lives in it. An empty thread has
 * it greet the editor; when the first message arrives, it moves to the end of the thread, and
 * stays there after each message. While a run is going or a message is still `sending` (on its
 * way to the thread, which hasn't accepted it yet), its face and a line beside it say what the
 * agent does, never how: thinking, looking around, making changes, building, fixing the build,
 * or starting a draft. Each editor's message shows its
 * sender's avatar, without their name. A Live turn handed off to a draft ends on the draft's
 * card, which `onOpenDraft` opens.
 */
export function ThreadMessages({
  view,
  sending = false,
  onOpenDraft,
}: {
  view: ThreadView;
  sending?: boolean;
  onOpenDraft?: (draftId: string) => void;
}) {
  const working = view.running || sending;
  const empty = view.messages.length === 0 && !working;
  const squareling = useSquarelingMorph(empty);
  if (empty) {
    return (
      // The agent's squareling greets the editor, in the middle of the empty thread.
      <div
        data-thread-empty
        className="text-muted-foreground flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-4 text-center text-sm"
      >
        <Squareling ref={squareling} status="idle" className="size-10" />
        <p>How can I help?</p>
      </div>
    );
  }

  return (
    <MessageScrollerProvider>
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport>
          <MessageScrollerContent className="flex flex-col gap-4 px-2 py-3">
            {view.messages.map((message, index) => (
              <MessageScrollerItem
                key={message.id}
                messageId={message.id}
                scrollAnchor={message.from === "editor"}
                className="flex flex-col gap-4"
              >
                <ThreadMessageRow message={message} onOpenDraft={onOpenDraft} />
                {index === view.messages.length - 1 && (
                  <AgentPresence view={view} working={working} squareling={squareling} />
                )}
              </MessageScrollerItem>
            ))}
            {view.messages.length === 0 && (
              <AgentPresence view={view} working={working} squareling={squareling} />
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

/** How long the greeting's squareling takes to reach the end of the thread, in ms. */
const MORPH_DURATION = 350;
/** A strong ease-in-out, for moving across the screen. */
const MORPH_EASING = "cubic-bezier(0.77, 0, 0.175, 1)";

/**
 * Moves the squareling from where the greeting showed it to the end of the thread, as the first
 * message arrives, so it reads as the same one. Without motion for editors who reduce it.
 */
function useSquarelingMorph(empty: boolean) {
  const node = React.useRef<SVGSVGElement>(null);
  /** Where the greeting showed it, as of the last render of the empty thread. */
  const greeting = React.useRef<DOMRect | null>(null);
  React.useLayoutEffect(() => {
    const element = node.current;
    if (!element) return;
    if (empty) {
      greeting.current = element.getBoundingClientRect();
      return;
    }
    const from = greeting.current;
    greeting.current = null;
    if (!from || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const to = element.getBoundingClientRect();
    if (to.width === 0) return;
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    element.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${from.width / to.width})` },
        { transform: "none" },
      ],
      { duration: MORPH_DURATION, easing: MORPH_EASING },
    );
  });
  return node;
}

/**
 * The squareling at the end of the thread: idle between turns, at work during one, saying what
 * the agent does. Shown in the last message, not after it: the scroller only brings a message the
 * editor just sent into view when it's appended last, and it arrives while the agent is already
 * working.
 */
function AgentPresence({
  view: { activity },
  working,
  squareling,
}: {
  view: ThreadView;
  working: boolean;
  squareling: React.Ref<SVGSVGElement>;
}) {
  // A message on its way to the thread starts a run: the agent thinks first.
  const shown = useSteadyActivity(working ? (activity ?? "thinking") : undefined);
  return (
    <div role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
      <Squareling
        ref={squareling}
        status={shown ? SQUARELING_STATUSES[shown] : "idle"}
        className="size-6"
      />
      {shown && <span className="shimmer">{ACTIVITY_LINES[shown]}</span>}
    </div>
  );
}

/**
 * How long a line saying what the agent does stays at least, in ms, so editors have time to read
 * it: a round of tool calls can take far less.
 */
export const ACTIVITY_MIN_DURATION = 2000;

/**
 * How long the agent must keep doing something before a line says so, in ms: thinking briefly
 * between two rounds of tool calls never shows.
 */
export const ACTIVITY_SETTLE_DURATION = 800;

/**
 * `activity` as a line shows it, steadied: a new activity shows once it lasted
 * `ACTIVITY_SETTLE_DURATION` and the line before held for `ACTIVITY_MIN_DURATION`, so a brief
 * one never shows. Only the line lags: a turn that starts or ends shows at once.
 */
function useSteadyActivity(activity: AgentActivity | undefined) {
  // Each change is a new object, so an activity that comes back waits again.
  const [latest, setLatest] = React.useState({ activity });
  const [lasted, setLasted] = React.useState<typeof latest>();
  const [held, setHeld] = React.useState({ activity });
  const [settled, setSettled] = React.useState<typeof held>();
  React.useEffect(() => {
    const timer = setTimeout(() => setLasted(latest), ACTIVITY_SETTLE_DURATION);
    return () => clearTimeout(timer);
  }, [latest]);
  React.useEffect(() => {
    const timer = setTimeout(() => setSettled(held), ACTIVITY_MIN_DURATION);
    return () => clearTimeout(timer);
  }, [held]);
  if (activity !== latest.activity) {
    setLatest({ activity });
  } else if (activity !== held.activity) {
    const startsOrEnds = !activity || !held.activity;
    if (startsOrEnds || (lasted === latest && settled === held)) setHeld({ activity });
  }
  return activity && (held.activity ?? activity);
}

const SQUARELING_STATUSES: Record<AgentActivity, SquarelingStatus> = {
  thinking: "thinking",
  exploring: "exploring",
  changing: "changing",
  building: "building",
  checking: "checking",
  fixing: "fixing",
  startingDraft: "changing",
};

const ACTIVITY_LINES: Record<AgentActivity, string> = {
  thinking: "Thinking…",
  exploring: "Looking around…",
  changing: "Making changes…",
  building: "Building…",
  checking: "Checking the design…",
  fixing: "Fixing the build…",
  startingDraft: "Starting a draft…",
};

/** How a member's pushed code built, as the thread says it. */
const PUSH_OUTCOMES: Record<Extract<ThreadMessage, { from: "push" }>["outcome"], string> = {
  built: "Built, and in the preview.",
  typeErrors: "Built, with type errors that block publishing.",
  notPreviewed: "Built, but the preview can’t show it.",
};

function ThreadMessageRow({
  message,
  onOpenDraft,
}: {
  message: ThreadMessage;
  onOpenDraft?: (draftId: string) => void;
}) {
  if (message.from === "draft") {
    return (
      <Message>
        <MessageContent>
          <DraftCard message={message} onOpenDraft={onOpenDraft} />
        </MessageContent>
      </Message>
    );
  }
  if (message.from === "stopped" || message.from === "failed") {
    return (
      <Message>
        <MessageContent>
          <p className="text-muted-foreground text-sm">
            {message.from === "stopped"
              ? `Stopped by ${message.sender.name}`
              : "Camox couldn’t finish this. Send your message again to retry."}
          </p>
        </MessageContent>
      </Message>
    );
  }
  if (message.from === "agent") {
    return (
      <Message>
        <MessageContent>
          <ThreadMarkdown text={message.text} />
        </MessageContent>
      </Message>
    );
  }
  if (message.from === "push") {
    // A member pushed code from their own checkout, between turns: no one answers it.
    const commits = message.subjects.length;
    return (
      <Message>
        <MessageAvatar>
          <SenderAvatar sender={message.sender} />
        </MessageAvatar>
        <MessageContent>
          <MessageHeader className="text-muted-foreground text-xs">
            {`${message.sender.name} pushed ${commits} ${commits === 1 ? "commit" : "commits"}`}
          </MessageHeader>
          <div data-thread-push className={DRAFT_CARD_CLASSES}>
            <ul className="flex flex-col gap-0.5">
              {message.subjects.map((subject, index) => (
                <li key={index} className="font-mono text-xs">
                  {subject}
                </li>
              ))}
            </ul>
            <span className="text-muted-foreground text-xs">{PUSH_OUTCOMES[message.outcome]}</span>
          </div>
        </MessageContent>
      </Message>
    );
  }
  if (message.from === "connectedAgent") {
    // The member's own AI wrote it, not the member. A client's name is only shown as verified
    // when Camox could check it; otherwise it's on hover, as what the client says it is.
    const { member, client } = message;
    return (
      <Message>
        <MessageContent>
          <MessageHeader
            className="text-muted-foreground text-xs"
            title={client.verified ? undefined : client.name}
          >
            {`${member.name}’s ${client.verified ? client.name : "agent"}`}
          </MessageHeader>
          <Bubble variant="muted" className="max-w-full">
            <BubbleContent>
              <CroppedText text={message.text} />
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    );
  }
  if (message.from === "camox") {
    // Camox started the turn itself, as when Live's code doesn't merge into the draft's.
    return (
      <Message>
        <MessageContent>
          <MessageHeader className="text-muted-foreground text-xs">Camox</MessageHeader>
          <Bubble variant="muted" className="max-w-full">
            <BubbleContent>
              <CroppedText text={message.text} />
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    );
  }
  return (
    <Message align="end">
      <MessageAvatar>
        <SenderAvatar sender={message.sender} />
      </MessageAvatar>
      <MessageContent>
        <Bubble align="end" variant="muted" className="max-w-full">
          <BubbleContent>
            <CroppedText text={message.text} />
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

/**
 * A message's text, cropped past its fourth line: the next ones fade out, above a button that
 * shows it all. A message that fits shows as is.
 */
function CroppedText({ text }: { text: string }) {
  const node = React.useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  React.useLayoutEffect(() => {
    const element = node.current;
    if (!element || expanded) return;
    const measure = () => setOverflows(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, expanded]);
  const cropped = !expanded && overflows;
  return (
    <>
      <div
        ref={node}
        data-thread-cropped={cropped || undefined}
        className={cn(
          "whitespace-pre-wrap",
          !expanded && "max-h-[5.5lh] overflow-hidden",
          cropped && "mask-[linear-gradient(to_bottom,black_4lh,transparent)]",
        )}
      >
        {text}
      </div>
      {cropped && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="focus-visible:ring-ring mt-1 rounded-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
        >
          Show full message
        </button>
      )}
    </>
  );
}

const initials = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

const DRAFT_CARD_CLASSES =
  "bg-muted/50 flex w-full flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left text-sm";

/**
 * The card of the draft the agent on Live handed the request off to, where its agent does the
 * work: it opens the draft. Once the draft ended, there's nothing to open: it says how it ended.
 */
function DraftCard({
  message,
  onOpenDraft,
}: {
  message: Extract<ThreadMessage, { from: "draft" }>;
  onOpenDraft?: (draftId: string) => void;
}) {
  const name = <span className="font-medium">{message.name}</span>;
  if (message.ended) {
    return (
      <div data-thread-draft-card className={DRAFT_CARD_CLASSES}>
        <span className="text-muted-foreground text-xs">
          {message.ended === "published" ? "Published" : "Deleted"}
        </span>
        {name}
      </div>
    );
  }
  return (
    <button
      type="button"
      data-thread-draft-card
      onClick={() => onOpenDraft?.(message.draftId)}
      className={cn(
        DRAFT_CARD_CLASSES,
        "hover:bg-muted focus-visible:ring-ring transition-colors focus-visible:ring-2 focus-visible:outline-none",
      )}
    >
      <span className="text-muted-foreground text-xs">Started a draft</span>
      {name}
    </button>
  );
}

function SenderAvatar({ sender }: { sender: ThreadSender }) {
  return (
    <Avatar>
      {sender.image && <AvatarImage src={sender.image} alt={sender.name} />}
      <AvatarFallback>{initials(sender.name)}</AvatarFallback>
    </Avatar>
  );
}
