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
import type * as React from "react";

import { Squareling, type SquarelingStatus } from "./Squareling";
import { ThreadMarkdown } from "./ThreadMarkdown";

/** The draft the editor's previous Live thread continued in, as a link to it. */
export type ContinuedInLink = {
  label: string;
  href: string;
  onOpen?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
};

/**
 * A thread's messages, and the agent's squareling at work while a run is going or a message is
 * still `sending`: on its way to the thread, which hasn't accepted it yet. Its face says whether
 * the agent thinks or acts (uses its tools, or builds its code). While the end of a turn builds
 * the agent's code, or the agent fixes a build error, it says so in words too. Each editor's message shows its sender's
 * avatar, without their name. A fresh Live thread links to the draft the editor's previous one
 * continued in (`continuedIn`).
 */
export function ThreadMessages({
  view,
  sending = false,
  continuedIn,
}: {
  view: ThreadView;
  sending?: boolean;
  continuedIn?: ContinuedInLink;
}) {
  const working = view.running || sending;
  if (view.messages.length === 0 && !working) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {continuedIn && <ContinuedIn link={continuedIn} />}
        <p
          data-thread-empty
          className="text-muted-foreground flex min-h-0 flex-1 items-center justify-center p-4 text-center text-sm"
        >
          Ask Camox about your website’s content.
        </p>
      </div>
    );
  }

  return (
    <MessageScrollerProvider>
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport>
          <MessageScrollerContent className="flex flex-col gap-4 px-2 py-3">
            {continuedIn && <ContinuedIn link={continuedIn} />}
            {view.messages.map((message, index) => (
              <MessageScrollerItem
                key={message.id}
                messageId={message.id}
                scrollAnchor={message.from === "editor"}
                className="flex flex-col gap-4"
              >
                <ThreadMessageRow message={message} />
                {working && index === view.messages.length - 1 && <Working view={view} />}
              </MessageScrollerItem>
            ))}
            {working && view.messages.length === 0 && <Working view={view} />}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

/**
 * Shown in the last message, not after it: the scroller only brings a message the editor just
 * sent into view when it's appended last, and it arrives while the agent is already working.
 */
function Working({ view: { status, usingTools } }: { view: ThreadView }) {
  // The squareling alone says whether the agent thinks or acts, without the details of how it
  // works. Building and fixing also say so in words.
  return (
    <div role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
      <Squareling status={squarelingStatus(status, usingTools)} className="size-6" />
      {status ? (
        <span className="shimmer">{STATUS_LINES[status]}</span>
      ) : (
        <span className="sr-only">Working…</span>
      )}
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

function ThreadMessageRow({ message }: { message: ThreadMessage }) {
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

function ContinuedIn({ link }: { link: ContinuedInLink }) {
  return (
    <p className="text-muted-foreground px-2 pt-3 text-center text-sm">
      Continued in{" "}
      <a href={link.href} onClick={link.onOpen} className="text-foreground underline">
        {link.label}
      </a>
    </p>
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
