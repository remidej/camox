import type { ThreadMessage, ThreadSender, ThreadView } from "@camox/api-contract/threads";
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

import { Squareling, type SquarelingStatus } from "./Squareling";
import { ThreadMarkdown } from "./ThreadMarkdown";

/**
 * A thread's messages, and the agent's squareling, which always lives in it. An empty thread has
 * it greet the editor; when the first message arrives, it moves to the end of the thread, and
 * stays there after each message. While a run is going or a message is still `sending` (on its
 * way to the thread, which hasn't accepted it yet), its face says whether the agent thinks or
 * acts (uses its tools, or builds its code). While the end of a turn builds the agent's code, or
 * the agent fixes a build error, it says so in words too. Each editor's message shows its
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
 * The squareling at the end of the thread: idle between turns, at work during one. Shown in the
 * last message, not after it: the scroller only brings a message the editor just sent into view
 * when it's appended last, and it arrives while the agent is already working.
 */
function AgentPresence({
  view: { status, usingTools },
  working,
  squareling,
}: {
  view: ThreadView;
  working: boolean;
  squareling: React.Ref<SVGSVGElement>;
}) {
  // The squareling alone says whether the agent thinks or acts, without the details of how it
  // works. Building and fixing also say so in words.
  return (
    <div role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
      <Squareling
        ref={squareling}
        status={working ? squarelingStatus(status, usingTools) : "idle"}
        className="size-6"
      />
      {working &&
        (status ? (
          <span className="shimmer">{STATUS_LINES[status]}</span>
        ) : (
          <span className="sr-only">Working…</span>
        ))}
    </div>
  );
}

function squarelingStatus(
  status: ThreadView["status"],
  usingTools: ThreadView["usingTools"],
): SquarelingStatus {
  if (status === "fixing") return "fixing";
  return status === "building" || usingTools ? "acting" : "thinking";
}

const STATUS_LINES: Record<NonNullable<ThreadView["status"]>, string> = {
  building: "Building…",
  fixing: "Fixing a build error…",
};

function ThreadMessageRow({
  message,
  onOpenDraft,
}: {
  message: ThreadMessage;
  onOpenDraft?: (draftId: string) => void;
}) {
  if (message.from === "draft") {
    // The agent on Live handed the request off to this draft, where its agent does the work.
    // Once the draft ended, there's nothing to open: the card says how it ended.
    if (message.ended) {
      return (
        <Message>
          <MessageContent>
            <div
              data-thread-draft-card
              className="bg-muted/50 flex w-full flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-sm"
            >
              <span className="text-muted-foreground text-xs">
                {message.ended === "published" ? "Published" : "Deleted"}
              </span>
              <span className="font-medium">{message.name}</span>
            </div>
          </MessageContent>
        </Message>
      );
    }
    return (
      <Message>
        <MessageContent>
          <button
            type="button"
            data-thread-draft-card
            onClick={() => onOpenDraft?.(message.draftId)}
            className="bg-muted/50 hover:bg-muted focus-visible:ring-ring flex w-full flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <span className="text-muted-foreground text-xs">Started a draft</span>
            <span className="font-medium">{message.name}</span>
          </button>
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
  if (message.from === "camox") {
    // Camox started the turn itself, as when Live's code doesn't merge into the draft's.
    return (
      <Message>
        <MessageContent>
          <MessageHeader className="text-muted-foreground text-xs">Camox</MessageHeader>
          <Bubble variant="muted" className="max-w-full">
            <BubbleContent className="whitespace-pre-wrap">{message.text}</BubbleContent>
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
          <BubbleContent className="whitespace-pre-wrap">{message.text}</BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

const initials = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

function SenderAvatar({ sender }: { sender: ThreadSender }) {
  return (
    <Avatar>
      {sender.image && <AvatarImage src={sender.image} alt={sender.name} />}
      <AvatarFallback>{initials(sender.name)}</AvatarFallback>
    </Avatar>
  );
}
